'use strict';

const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { calculate, Pokemon, Move, Field, Side } = require('@smogon/calc');
const { getMetaPool, weightedChoice, inferEVSpread } = require('../utils/metaData');
const { buildResultEmbed, makeStatsRow, makeGuessRow }  = require('../utils/buildEmbed');
const { LANG_CHOICES, ui, translate }                   = require('../utils/i18n');
const { randomBoosts }                                  = require('../utils/pokeData');

// ── Guess state ────────────────────────────────────────────────────────────────
const guessStates = new Map();

// ── Move-select scenario state ────────────────────────────────────────────────
// Keyed by interaction.id; stores everything needed to recalc with a new move.
const scenarioStates = new Map();

// ── Weather / terrain auto-detection ─────────────────────────────────────────
const ABILITY_WEATHER = {
  'Drought':          'Sun',
  'Orichalcum Pulse': 'Sun',
  'Drizzle':          'Rain',
  'Primordial Sea':   'Heavy Rain',
  'Sand Stream':      'Sand',
  'Snow Warning':     'Snow',
  'Desolate Land':    'Harsh Sunshine',
  'Delta Stream':     'Strong Winds',
};
const ABILITY_TERRAIN = {
  'Electric Surge': 'Electric',
  'Hadron Engine':  'Electric',
  'Grassy Surge':   'Grassy',
  'Seed Sower':     'Grassy',
  'Misty Surge':    'Misty',
  'Psychic Surge':  'Psychic',
};

function resolveWeatherTerrain(abilities, weather, terrain) {
  let w = weather;
  let t = terrain;
  for (const ab of abilities) {
    if (!ab) continue;
    if (!w && ABILITY_WEATHER[ab]) w = ABILITY_WEATHER[ab];
    if (!t && ABILITY_TERRAIN[ab]) t = ABILITY_TERRAIN[ab];
  }
  return { weather: w, terrain: t };
}

// ── Crit helpers ──────────────────────────────────────────────────────────────
const HIGH_CRIT_MOVES = new Set([
  'Blaze Kick', 'Crabhammer', 'Cross Chop', 'Cross Poison', 'Drill Run',
  'Karate Chop', 'Leaf Blade', 'Night Slash', 'Psycho Cut', 'Razor Leaf',
  'Razor Wind', 'Shadow Claw', 'Slash', 'Spacial Rend',
]);
const CRIT_ITEM_STAGE    = { 'Scope Lens': 1, 'Razor Claw': 1, 'Leek': 2, 'Lucky Punch': 2 };
const CRIT_ABILITY_STAGE = { 'Super Luck': 1 };

function getCritStage(moveName, itemName, abilityName) {
  let stage = HIGH_CRIT_MOVES.has(moveName) ? 1 : 0;
  stage += CRIT_ITEM_STAGE[itemName]       ?? 0;
  stage += CRIT_ABILITY_STAGE[abilityName] ?? 0;
  return stage;
}

const NATURE_CHOICES = [
  { name: 'Neutral',      value: 'Hardy'   },
  { name: '+Atk / -Def',  value: 'Lonely'  },
  { name: '+Atk / -SpA',  value: 'Adamant' },
  { name: '+Atk / -SpD',  value: 'Naughty' },
  { name: '+Atk / -Spe',  value: 'Brave'   },
  { name: '+Def / -Atk',  value: 'Bold'    },
  { name: '+Def / -SpA',  value: 'Impish'  },
  { name: '+Def / -SpD',  value: 'Lax'     },
  { name: '+Def / -Spe',  value: 'Relaxed' },
  { name: '+SpA / -Atk',  value: 'Modest'  },
  { name: '+SpA / -Def',  value: 'Mild'    },
  { name: '+SpA / -SpD',  value: 'Rash'    },
  { name: '+SpA / -Spe',  value: 'Quiet'   },
  { name: '+SpD / -Atk',  value: 'Calm'    },
  { name: '+SpD / -Def',  value: 'Gentle'  },
  { name: '+SpD / -SpA',  value: 'Careful' },
  { name: '+SpD / -Spe',  value: 'Sassy'   },
  { name: '+Spe / -Atk',  value: 'Timid'   },
  { name: '+Spe / -Def',  value: 'Hasty'   },
  { name: '+Spe / -SpA',  value: 'Jolly'   },
  { name: '+Spe / -SpD',  value: 'Naive'   },
];

const META_FOOTER_SUFFIX = ' · Meta: HOME Doubles Seasons 1–40';

/** Build the move-select dropdown row for /meta random. */
function makeMetaMoveSelectRow(damageMoves, currentMove, stateKey, lang) {
  const options = damageMoves.map(move => ({
    label: translate(move, 'move', lang) || move,
    value: move,
    default: move === currentMove,
  }));
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`meta_move_select|${stateKey}`)
      .setPlaceholder(translate(currentMove, 'move', lang) || currentMove)
      .addOptions(options),
  );
}

/**
 * Rebuild Pokemon/Move/Field objects from a stored scenario state,
 * optionally overriding the move. Returns { attacker, defender, moveObj, field }.
 */
function buildScenarioFromState(state, overrideMove = null) {
  const moveName = overrideMove ?? state.currentMove;
  const isCrit   = getCritStage(moveName, state.attackerItem, state.attackerAbility) >= 3;
  const moveObj  = new Move(9, moveName, { isCrit });

  const attacker = new Pokemon(9, state.attackerName, {
    level: 50, ability: state.attackerAbility, item: state.attackerItem,
    nature: state.attackerNature, evs: state.attackerEVs, boosts: state.attackerBoosts,
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  });
  const defender = new Pokemon(9, state.defenderName, {
    level: 50, ability: state.defenderAbility, item: state.defenderItem,
    nature: state.defenderNature, evs: state.defenderEVs, boosts: state.defenderBoosts,
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  });
  const field = new Field({
    gameType: state.isDoubles ? 'Doubles' : 'Singles',
    weather: state.weather, terrain: state.terrain,
    isFairyAura: state.isFairyAura, isDarkAura: state.isDarkAura,
    isBeadsOfRuin: state.isBeadsOfRuin, isSwordOfRuin: state.isSwordOfRuin,
    isTabletsOfRuin: state.isTabletsOfRuin, isVesselOfRuin: state.isVesselOfRuin,
    attackerSide: new Side({ isHelpingHand: state.isHelpingHand }),
    defenderSide: new Side({ isFriendGuard: state.isFriendGuard }),
  });
  return { attacker, defender, moveObj, field };
}

/**
 * Creates the Reroll button for /meta random.
 * isDoubles, lang, and useStatChanges are encoded in the customId.
 * If revealKey is provided, a "Reveal" button is added to the same row.
 */
function makeMetaRerollButton(isDoubles = true, lang = 'en', useStatChanges = false, revealKey = null) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`meta_reroll|${isDoubles ? '1' : '0'}|${lang}|${useStatChanges ? '1' : '0'}`)
      .setLabel(ui('reroll', lang))
      .setEmoji({ id: '1485642703298625596', name: 'dice' })
      .setStyle(ButtonStyle.Primary),
  );
  if (revealKey) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`see_answer|${revealKey}`)
        .setLabel(ui('seeAnswer', lang))
        .setEmoji('🔍')
        .setStyle(ButtonStyle.Secondary),
    );
  }
  return row;
}

// ── Command definition ────────────────────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName('meta')
    .setDescription('Generate damage calc scenarios using real VGC usage data (Pokémon HOME doubles)')

    // /meta random
    .addSubcommand(sub => sub
      .setName('random')
      .setDescription('Random meta matchup — real sets from HOME doubles usage data')
      .addStringOption(o => o
        .setName('format')
        .setDescription('Battle format (default: doubles)')
        .addChoices(
          { name: 'Doubles', value: 'doubles' },
          { name: 'Singles', value: 'singles' },
        ))
      .addBooleanOption(o => o
        .setName('stat_changes')
        .setDescription('Include random stat boosts/drops? (default: false)'))
      .addStringOption(o => o
        .setName('attacker_nature')
        .setDescription('Override attacker nature (default: random from meta data)')
        .addChoices(...NATURE_CHOICES))
      .addStringOption(o => o
        .setName('defender_nature')
        .setDescription('Override defender nature (default: random from meta data)')
        .addChoices(...NATURE_CHOICES))
      .addStringOption(o => o
        .setName('lang').setDescription('Display language (default: English)')
        .addChoices(...LANG_CHOICES)))

    // /meta guess
    .addSubcommand(sub => sub
      .setName('guess')
      .setDescription('Guess the damage — real meta sets from HOME doubles usage data')
      .addStringOption(o => o
        .setName('format')
        .setDescription('Battle format (default: doubles)')
        .addChoices(
          { name: 'Doubles', value: 'doubles' },
          { name: 'Singles', value: 'singles' },
        ))
      .addBooleanOption(o => o
        .setName('stat_changes')
        .setDescription('Include random stat boosts/drops? (default: false)'))
      .addStringOption(o => o
        .setName('attacker_nature')
        .setDescription('Override attacker nature (default: random from meta data)')
        .addChoices(...NATURE_CHOICES))
      .addStringOption(o => o
        .setName('defender_nature')
        .setDescription('Override defender nature (default: random from meta data)')
        .addChoices(...NATURE_CHOICES))
      .addStringOption(o => o
        .setName('lang').setDescription('Display language (default: English)')
        .addChoices(...LANG_CHOICES))),

  // ── Dispatcher ──────────────────────────────────────────────────────────────
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'random') return handleMetaRandom(interaction);
    if (sub === 'guess')  return handleMetaGuess(interaction);
  },

  async autocomplete() {},

  generateMetaResult,
  makeMetaRerollButton,
  makeMetaMoveSelectRow,
  buildScenarioFromState,
  guessStates,
  scenarioStates,
};

// ── /meta random ──────────────────────────────────────────────────────────────

async function handleMetaRandom(interaction) {
  await interaction.deferReply();
  const isDoubles             = (interaction.options.getString('format') ?? 'doubles') !== 'singles';
  const useStatChanges        = interaction.options.getBoolean('stat_changes') ?? false;
  const lang                  = interaction.options.getString('lang') ?? 'en';
  const attackerNatureOverride = interaction.options.getString('attacker_nature') ?? null;
  const defenderNatureOverride = interaction.options.getString('defender_nature') ?? null;
  const data = generateMetaResult({ isDoubles, useStatChanges, attackerNatureOverride, defenderNatureOverride });
  if (!data) {
    await interaction.editReply(ui('errorMeta', lang));
    return;
  }
  const { attacker, defender, moveObj, field, result, attackerEVs, defenderEVs,
          attackerDamageMoves, attackerNature, defenderNature } = data;

  const stateKey = interaction.id;
  scenarioStates.set(stateKey, {
    attackerName: attacker.name, attackerAbility: attacker.ability,
    attackerItem: attacker.item, attackerNature, attackerEVs, attackerBoosts: attacker.boosts ?? {},
    defenderName: defender.name, defenderAbility: defender.ability,
    defenderItem: defender.item, defenderNature, defenderEVs, defenderBoosts: defender.boosts ?? {},
    weather: field.weather, terrain: field.terrain, isDoubles,
    isHelpingHand: !!field.attackerSide?.isHelpingHand,
    isFriendGuard: !!field.defenderSide?.isFriendGuard,
    isFairyAura: !!field.isFairyAura, isDarkAura: !!field.isDarkAura,
    isBeadsOfRuin: !!field.isBeadsOfRuin, isSwordOfRuin: !!field.isSwordOfRuin,
    isTabletsOfRuin: !!field.isTabletsOfRuin, isVesselOfRuin: !!field.isVesselOfRuin,
    damageMoves: attackerDamageMoves, currentMove: moveObj.name,
    lang, isDoubles, useStatChanges,
  });
  // Auto-clean after 30 minutes
  setTimeout(() => scenarioStates.delete(stateKey), 30 * 60 * 1000);

  const { embed, files } = await buildResultEmbed(
    attacker, defender, moveObj, field, result, attackerEVs, defenderEVs,
    { isRandom: true, footerSuffix: META_FOOTER_SUFFIX, lang },
  );
  const rerollRow    = makeMetaRerollButton(isDoubles, lang, useStatChanges);
  const moveRow      = makeMetaMoveSelectRow(attackerDamageMoves, moveObj.name, stateKey, lang);
  const statsRow     = makeStatsRow(attacker.name, defender.name, moveObj.name, lang);
  await interaction.editReply({ embeds: [embed], files, components: [rerollRow, moveRow, statsRow] });
}

// ── /meta guess ───────────────────────────────────────────────────────────────

async function handleMetaGuess(interaction) {
  await interaction.deferReply();
  const isDoubles             = (interaction.options.getString('format') ?? 'doubles') !== 'singles';
  const useStatChanges        = interaction.options.getBoolean('stat_changes') ?? false;
  const lang                  = interaction.options.getString('lang') ?? 'en';
  const attackerNatureOverride = interaction.options.getString('attacker_nature') ?? null;
  const defenderNatureOverride = interaction.options.getString('defender_nature') ?? null;
  const data = generateMetaResult({ isDoubles, useStatChanges, attackerNatureOverride, defenderNatureOverride });
  if (!data) {
    await interaction.editReply(ui('errorGuess', lang));
    return;
  }
  const { attacker, defender, moveObj, field, result, attackerEVs, defenderEVs } = data;
  const { embed, files, minDmg, maxDmg, defHP, calcDesc } = await buildResultEmbed(
    attacker, defender, moveObj, field, result, attackerEVs, defenderEVs,
    { isRandom: true, hideRoll: true, footerSuffix: META_FOOTER_SUFFIX, lang },
  );

  const guessKey = interaction.id;
  const guessRow = makeGuessRow(minDmg, maxDmg, defHP, guessKey, `meta_guess_reroll|${guessKey}|${lang}`, lang);
  const statsRow = makeStatsRow(attacker.name, defender.name, moveObj.name, lang, true);
  await interaction.editReply({ embeds: [embed], files, components: [guessRow, statsRow] });

  guessStates.set(guessKey, { startTime: Date.now(), wrongCount: 0, calcDesc, minDmg, maxDmg, defHP, isDoubles, useStatChanges, lang });

  setTimeout(async () => {
    if (!guessStates.has(guessKey)) return;
    guessStates.delete(guessKey);
    const minPct  = (minDmg / defHP * 100).toFixed(1);
    const maxPct  = (maxDmg / defHP * 100).toFixed(1);
    const descLine = calcDesc ? `\n-# ${calcDesc}` : '';
    try {
      await interaction.editReply({
        content: ui('timeUp', lang, { min: minDmg, max: maxDmg, minPct, maxPct, hp: defHP, desc: descLine }),
        components: [],
      });
    } catch { /* interaction token expired */ }
  }, 180_000);
}

// ── Core generator ────────────────────────────────────────────────────────────

function generateMetaResult({ isDoubles = true, useStatChanges = false, attackerNatureOverride = null, defenderNatureOverride = null } = {}) {
  const pool = getMetaPool();
  if (!pool || pool.length < 2) return null;

  const weightedPool = pool.map(p => ({ name: p.name, weight: p.score }));

  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      const attackerEntry = pool[weightedPool.findIndex(x => x.name === weightedChoice(weightedPool))];
      let defenderEntry;
      do {
        defenderEntry = pool[pool.findIndex(x => x.name === weightedChoice(weightedPool))];
      } while (!defenderEntry || defenderEntry.name === attackerEntry.name);

      if (!attackerEntry || !defenderEntry) continue;

      const pick = arr => arr[Math.floor(Math.random() * arr.length)];

      const attackerAbility = pick(attackerEntry.abilities) || undefined;
      const attackerItem    = pick(attackerEntry.items)     || undefined;
      const attackerNature  = attackerNatureOverride ?? pick(attackerEntry.natures) ?? 'Hardy';
      const defenderAbility = pick(defenderEntry.abilities) || undefined;
      const defenderNature  = defenderNatureOverride ?? pick(defenderEntry.natures) ?? 'Hardy';
      const defenderItemPool = defenderEntry.items.length > 1
        ? defenderEntry.items.filter(i => i !== 'Focus Sash')
        : defenderEntry.items;
      const defenderItem    = pick(defenderItemPool) || undefined;

      const attackerEVs     = inferEVSpread(attackerNature, attackerItem);
      const defenderEVs     = inferEVSpread(defenderNature, defenderItem);
      const attackerBoosts  = useStatChanges ? randomBoosts() : {};
      const defenderBoosts  = useStatChanges ? randomBoosts() : {};

      const moveName = pick(attackerEntry.damageMoves);
      if (!moveName) continue;

      const isCrit  = getCritStage(moveName, attackerItem, attackerAbility) >= 3;
      const moveObj = new Move(9, moveName, { isCrit });

      const bothAbilities = [attackerAbility, defenderAbility].filter(Boolean);
      const { weather, terrain } = resolveWeatherTerrain(bothAbilities, undefined, undefined);

      const isFairyAura     = bothAbilities.includes('Fairy Aura');
      const isDarkAura      = bothAbilities.includes('Dark Aura');
      const isBeadsOfRuin   = bothAbilities.includes('Beads of Ruin');
      const isSwordOfRuin   = bothAbilities.includes('Sword of Ruin');
      const isTabletsOfRuin = bothAbilities.includes('Tablets of Ruin');
      const isVesselOfRuin  = bothAbilities.includes('Vessel of Ruin');

      const isHelpingHand = Math.random() < 0.30;
      const isFriendGuard = isDoubles && Math.random() < 0.20;

      const attacker = new Pokemon(9, attackerEntry.name, {
        level: 50, ability: attackerAbility, item: attackerItem,
        nature: attackerNature, evs: attackerEVs, boosts: attackerBoosts,
        ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      });
      const defender = new Pokemon(9, defenderEntry.name, {
        level: 50, ability: defenderAbility, item: defenderItem,
        nature: defenderNature, evs: defenderEVs, boosts: defenderBoosts,
        ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      });

      const field = new Field({
        gameType: isDoubles ? 'Doubles' : 'Singles',
        weather, terrain,
        isFairyAura, isDarkAura,
        isBeadsOfRuin, isSwordOfRuin, isTabletsOfRuin, isVesselOfRuin,
        attackerSide: new Side({ isHelpingHand }),
        defenderSide: new Side({ isFriendGuard }),
      });

      const result = calculate(9, attacker, defender, moveObj, field);

      const rolls = result.damage;
      const hasDamage = typeof rolls === 'number'
        ? rolls > 0
        : (Array.isArray(rolls) && rolls.flat(2).some(v => v > 0));

      if (hasDamage) return { attacker, defender, moveObj, field, result, attackerEVs, defenderEVs,
        attackerDamageMoves: attackerEntry.allMoves, attackerNature, defenderNature };

    } catch {
      // retry
    }
  }

  return null;
}
