'use strict';

const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { calculate, Pokemon, Move, Field, Side } = require('@smogon/calc');
const { parseEVs, parseNatureFromEVStr }        = require('../utils/evParser');
const { getGen9Data, randomChoice, parseBoosts, randomBoosts } = require('../utils/pokeData');
const { buildResultEmbed, makeStatsRow, makeGuessRow }         = require('../utils/buildEmbed');
const { LANG_CHOICES, ui }                                     = require('../utils/i18n');

// Tracks active guess rounds.
const guessStates = new Map();

// ── HP-dependent moves ────────────────────────────────────────────────────────
const ATTACKER_HP_MOVES = new Set([
  'Reversal', 'Flail', 'Eruption', 'Water Spout', 'Dragon Energy',
]);
const DEFENDER_HP_MOVES = new Set([
  'Wring Out', 'Hard Press',
]);

// ── Crit-stage helpers ────────────────────────────────────────────────────────
const HIGH_CRIT_MOVES = new Set([
  'Blaze Kick', 'Crabhammer', 'Cross Chop', 'Cross Poison', 'Drill Run',
  'Karate Chop', 'Leaf Blade', 'Night Slash', 'Psycho Cut', 'Razor Leaf',
  'Razor Wind', 'Shadow Claw', 'Slash', 'Spacial Rend',
]);

const CRIT_ITEM_STAGE = {
  'Scope Lens':  1,
  'Razor Claw':  1,
  'Leek':        2,
  'Lucky Punch': 2,
};

const CRIT_ABILITY_STAGE = {
  'Super Luck': 1,
};

function getCritStage(moveName, itemName, abilityName) {
  let stage = HIGH_CRIT_MOVES.has(moveName) ? 1 : 0;
  stage += CRIT_ITEM_STAGE[itemName]       ?? 0;
  stage += CRIT_ABILITY_STAGE[abilityName] ?? 0;
  return stage;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TERA_TYPES = [
  'Normal','Fire','Water','Electric','Grass','Ice','Fighting','Poison',
  'Ground','Flying','Psychic','Bug','Rock','Ghost','Dragon','Dark',
  'Steel','Fairy','Stellar',
];

const NATURES = [
  'Hardy','Lonely','Brave','Adamant','Naughty','Bold','Docile','Relaxed',
  'Impish','Lax','Timid','Hasty','Serious','Jolly','Naive','Modest',
  'Mild','Quiet','Bashful','Rash','Calm','Gentle','Sassy','Careful','Quirky',
];

const RANDOM_WEATHERS = ['Sun', 'Rain', 'Sand', 'Snow'];
const RANDOM_TERRAINS = ['Electric', 'Grassy', 'Misty', 'Psychic'];

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

/**
 * Creates the Reroll button for /calc random with lang encoded.
 */
function makeCalcRerollButton(lang = 'en') {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`random_reroll|${lang}`)
      .setLabel(ui('reroll', lang))
      .setEmoji({ id: '1485642703298625596', name: 'dice' })
      .setStyle(ButtonStyle.Primary),
  );
}

// ── Command definition ────────────────────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName('calc')
    .setDescription('Gen 9 Pokémon damage calculator — no legality restrictions')

    // ── /calc battle ──────────────────────────────────────────────────────────
    .addSubcommand(sub => sub
      .setName('battle')
      .setDescription('Calculate damage for any attacker/move/defender combo')

      .addStringOption(o => o
        .setName('attacker').setDescription('Attacker species (e.g. Garchomp)').setRequired(true).setAutocomplete(true))
      .addStringOption(o => o
        .setName('defender').setDescription('Defender species (e.g. Blissey)').setRequired(true).setAutocomplete(true))
      .addStringOption(o => o
        .setName('move').setDescription('Move name (e.g. Earthquake)').setRequired(true).setAutocomplete(true))

      .addBooleanOption(o => o
        .setName('is_doubles').setDescription('Doubles format? (default: true)'))
      .addStringOption(o => o
        .setName('weather').setDescription('Active weather')
        .addChoices(
          { name: 'Sun',                            value: 'Sun' },
          { name: 'Rain',                           value: 'Rain' },
          { name: 'Sand',                           value: 'Sand' },
          { name: 'Snow',                           value: 'Snow' },
          { name: 'Harsh Sunshine (Desolate Land)', value: 'Harsh Sunshine' },
          { name: 'Heavy Rain (Primordial Sea)',     value: 'Heavy Rain' },
          { name: 'Strong Winds (Delta Stream)',     value: 'Strong Winds' },
        ))
      .addStringOption(o => o
        .setName('terrain').setDescription('Active terrain')
        .addChoices(
          { name: 'Electric Terrain', value: 'Electric' },
          { name: 'Grassy Terrain',   value: 'Grassy' },
          { name: 'Misty Terrain',    value: 'Misty' },
          { name: 'Psychic Terrain',  value: 'Psychic' },
        ))
      .addBooleanOption(o => o
        .setName('is_helping_hand').setDescription('Is the attacker boosted by Helping Hand?'))

      .addStringOption(o => o
        .setName('attacker_evs')
        .setDescription('Attacker EVs e.g. "252 SpA 252 Spe"; add +Stat/-Stat for nature (e.g. "+SpA/-Atk")'))
      .addStringOption(o => o
        .setName('attacker_item').setDescription('Attacker held item (e.g. Life Orb)').setAutocomplete(true))
      .addStringOption(o => o
        .setName('attacker_ability').setDescription('Attacker ability (e.g. Rough Skin)').setAutocomplete(true))
      .addStringOption(o => o
        .setName('attacker_tera').setDescription('Attacker Tera Type')
        .addChoices(...TERA_TYPES.map(t => ({ name: t, value: t }))))

      .addStringOption(o => o
        .setName('defender_evs')
        .setDescription('Defender EVs e.g. "252 HP 252 SpD"; add +Stat/-Stat for nature (e.g. "+Def/-Atk")'))
      .addStringOption(o => o
        .setName('defender_item').setDescription('Defender held item (e.g. Leftovers)').setAutocomplete(true))
      .addStringOption(o => o
        .setName('defender_ability').setDescription('Defender ability (e.g. Intimidate)').setAutocomplete(true))
      .addStringOption(o => o
        .setName('defender_tera').setDescription('Defender Tera Type')
        .addChoices(...TERA_TYPES.map(t => ({ name: t, value: t }))))

      .addIntegerOption(o => o
        .setName('attacker_hp')
        .setDescription('Attacker current HP % (1–100, default 100). Affects Reversal, Eruption, Flail, etc.')
        .setMinValue(1).setMaxValue(100))
      .addIntegerOption(o => o
        .setName('defender_hp')
        .setDescription('Defender current HP % (1–100, default 100). Affects Wring Out, Hard Press, Multiscale, etc.')
        .setMinValue(1).setMaxValue(100))

      .addStringOption(o => o
        .setName('attacker_boosts')
        .setDescription('Attacker stat boosts — e.g. "+2 Atk" or "+1 SpA -1 Spe"'))
      .addStringOption(o => o
        .setName('defender_boosts')
        .setDescription('Defender stat boosts — e.g. "-1 Def" or "+2 SpD"'))

      .addBooleanOption(o => o
        .setName('reflect').setDescription('Defender side has Reflect up'))
      .addBooleanOption(o => o
        .setName('light_screen').setDescription('Defender side has Light Screen up'))
      .addBooleanOption(o => o
        .setName('aurora_veil').setDescription('Defender side has Aurora Veil up'))
      .addBooleanOption(o => o
        .setName('friend_guard').setDescription('Defending ally has Friend Guard (25% damage reduction)'))
      .addBooleanOption(o => o
        .setName('is_crit').setDescription('Assume a critical hit (auto-applied for Surging Strikes, Frost Breath, Storm Throw, etc.)'))

      .addStringOption(o => o
        .setName('lang').setDescription('Display language (default: English)')
        .addChoices(...LANG_CHOICES))
    )

    // ── /calc random ──────────────────────────────────────────────────────────
    .addSubcommand(sub => sub
      .setName('random')
      .setDescription('Spin the wheel — a completely random chaotic battle scenario')
      .addBooleanOption(o => o
        .setName('stat_changes')
        .setDescription('Include random stat boosts/drops? (default: false)'))
      .addStringOption(o => o
        .setName('lang').setDescription('Display language (default: English)')
        .addChoices(...LANG_CHOICES)))

    // ── /calc guess ───────────────────────────────────────────────────────────
    .addSubcommand(sub => sub
      .setName('guess')
      .setDescription('Guess the damage — can you nail the roll?')
      .addBooleanOption(o => o
        .setName('stat_changes')
        .setDescription('Include random stat boosts/drops? (default: false)'))
      .addStringOption(o => o
        .setName('lang').setDescription('Display language (default: English)')
        .addChoices(...LANG_CHOICES))),

  // ── Dispatcher ──────────────────────────────────────────────────────────────
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'battle') return handleBattle(interaction);
    if (sub === 'random') return handleRandom(interaction);
    if (sub === 'guess')  return handleGuess(interaction);
  },

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    const query   = focused.value.toLowerCase();
    const { allSpecies, damageMoves, allAbilities, allItems } = getGen9Data();

    let pool;
    switch (focused.name) {
      case 'attacker':
      case 'defender':         pool = allSpecies;   break;
      case 'move':             pool = damageMoves;  break;
      case 'attacker_ability':
      case 'defender_ability': pool = allAbilities; break;
      case 'attacker_item':
      case 'defender_item':    pool = allItems;     break;
      default:                 pool = [];
    }

    const starts   = pool.filter(c => c.toLowerCase().startsWith(query));
    const contains = pool.filter(c => !c.toLowerCase().startsWith(query) && c.toLowerCase().includes(query));
    const results  = [...starts, ...contains].slice(0, 25).map(c => ({ name: c, value: c }));

    await interaction.respond(results);
  },

  generateRandomResult,
  makeCalcRerollButton,
  guessStates,
};

// ── /calc battle ──────────────────────────────────────────────────────────────

async function handleBattle(interaction) {
  await interaction.deferReply();

  const lang = interaction.options.getString('lang') ?? 'en';

  try {
    const attackerName = interaction.options.getString('attacker', true);
    const defenderName = interaction.options.getString('defender', true);
    const moveName     = interaction.options.getString('move', true);

    const isDoubles     = interaction.options.getBoolean('is_doubles')     ?? true;
    const isHelpingHand = interaction.options.getBoolean('is_helping_hand') ?? false;
    const weather       = interaction.options.getString('weather')  ?? undefined;
    const terrain       = interaction.options.getString('terrain')  ?? undefined;

    const attackerItem    = interaction.options.getString('attacker_item')    ?? undefined;
    const attackerAbility = interaction.options.getString('attacker_ability') ?? undefined;
    const attackerTera    = interaction.options.getString('attacker_tera')    ?? undefined;
    const attackerEVsStr  = interaction.options.getString('attacker_evs');

    const defenderItem    = interaction.options.getString('defender_item')    ?? undefined;
    const defenderAbility = interaction.options.getString('defender_ability') ?? undefined;
    const defenderTera    = interaction.options.getString('defender_tera')    ?? undefined;
    const defenderEVsStr  = interaction.options.getString('defender_evs');

    const attackerBoosts = parseBoosts(interaction.options.getString('attacker_boosts'));
    const defenderBoosts = parseBoosts(interaction.options.getString('defender_boosts'));

    const isReflect     = interaction.options.getBoolean('reflect')      ?? false;
    const isLightScreen = interaction.options.getBoolean('light_screen') ?? false;
    const isAuroraVeil  = interaction.options.getBoolean('aurora_veil')  ?? false;
    const isFriendGuard = interaction.options.getBoolean('friend_guard') ?? false;
    const isWonderRoom  = false;
    const isCritManual  = interaction.options.getBoolean('is_crit')      ?? false;
    const isCrit        = isCritManual || getCritStage(moveName, attackerItem, attackerAbility) >= 3;

    const attackerHPPct = interaction.options.getInteger('attacker_hp') ?? 100;
    const defenderHPPct = interaction.options.getInteger('defender_hp') ?? 100;

    const moveObj      = new Move(9, moveName, { isCrit });
    const moveCategory = moveObj.category;

    const { nature: attackerNatureParsed, cleaned: attackerEVsCleaned } = parseNatureFromEVStr(attackerEVsStr);
    const { nature: defenderNatureParsed, cleaned: defenderEVsCleaned } = parseNatureFromEVStr(defenderEVsStr);

    const attackerEVs = parseEVs(attackerEVsCleaned, 'attacker', moveCategory);
    const defenderEVs = parseEVs(defenderEVsCleaned, 'defender', moveCategory);

    const attackerNature = attackerNatureParsed ?? (attackerEVsStr ? 'Hardy' : (moveCategory === 'Special' ? 'Modest' : 'Adamant'));
    const defenderNature = defenderNatureParsed ?? 'Hardy';

    const QP_ABILITIES = ['Protosynthesis', 'Quark Drive'];

    const attacker = new Pokemon(9, attackerName, {
      level: 50,
      item: attackerItem, ability: attackerAbility,
      teraType: attackerTera, evs: attackerEVs, nature: attackerNature,
      boosts: attackerBoosts,
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      ...(QP_ABILITIES.includes(attackerAbility) && { boostedStat: 'auto' }),
    });
    if (attackerHPPct < 100)
      attacker.originalCurHP = Math.max(1, Math.floor(attacker.maxHP() * attackerHPPct / 100));

    const defender = new Pokemon(9, defenderName, {
      level: 50,
      item: defenderItem, ability: defenderAbility,
      teraType: defenderTera, evs: defenderEVs, nature: defenderNature,
      boosts: defenderBoosts,
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      ...(QP_ABILITIES.includes(defenderAbility) && { boostedStat: 'auto' }),
    });
    if (defenderHPPct < 100)
      defender.originalCurHP = Math.max(1, Math.floor(defender.maxHP() * defenderHPPct / 100));

    const bothAbilities   = [attackerAbility, defenderAbility].filter(Boolean);
    const isFairyAura     = bothAbilities.includes('Fairy Aura');
    const isDarkAura      = bothAbilities.includes('Dark Aura');
    const isBeadsOfRuin   = bothAbilities.includes('Beads of Ruin');
    const isSwordOfRuin   = bothAbilities.includes('Sword of Ruin');
    const isTabletsOfRuin = bothAbilities.includes('Tablets of Ruin');
    const isVesselOfRuin  = bothAbilities.includes('Vessel of Ruin');

    const { weather: resolvedWeather, terrain: resolvedTerrain } =
      resolveWeatherTerrain(bothAbilities, weather, terrain);

    const field = new Field({
      gameType: isDoubles ? 'Doubles' : 'Singles',
      weather: resolvedWeather, terrain: resolvedTerrain,
      isFairyAura, isDarkAura,
      isBeadsOfRuin, isSwordOfRuin, isTabletsOfRuin, isVesselOfRuin,
      isWonderRoom,
      attackerSide: new Side({ isHelpingHand }),
      defenderSide: new Side({ isReflect, isLightScreen, isAuroraVeil, isFriendGuard }),
    });

    const result = calculate(9, attacker, defender, moveObj, field);
    const { embed, files } = await buildResultEmbed(
      attacker, defender, moveObj, field, result, attackerEVs, defenderEVs, { lang });
    const statsRow = makeStatsRow(attacker.name, defender.name, moveObj.name, lang, false, attackerTera ?? '', defenderTera ?? '');

    await interaction.editReply({ embeds: [embed], files, components: [statsRow] });

  } catch (err) {
    console.error('[calc battle]', err);
    await interaction.editReply({
      content: [
        ui('errorCalc', lang),
        `> ${err.message}`,
        '',
        'Tips:',
        '• Pokémon, move, ability, and item names must be **exact Showdown names** (e.g. `Flutter Mane`, `Booster Energy`, `Quiver Dance`)',
        '• This calculator has no legality restrictions — any combo is valid',
      ].join('\n'),
    });
  }
}

// ── /calc random ──────────────────────────────────────────────────────────────

async function handleRandom(interaction) {
  await interaction.deferReply();
  const useStatChanges = interaction.options.getBoolean('stat_changes') ?? false;
  const lang           = interaction.options.getString('lang') ?? 'en';
  const data = generateRandomResult({ useStatChanges });
  if (!data) {
    await interaction.editReply(ui('errorRandom', lang));
    return;
  }
  const { attacker, defender, moveObj, field, result, attackerEVs, defenderEVs } = data;
  const { embed, files } = await buildResultEmbed(
    attacker, defender, moveObj, field, result, attackerEVs, defenderEVs, { isRandom: true, lang });
  const rerollRow = makeCalcRerollButton(lang);
  const statsRow  = makeStatsRow(attacker.name, defender.name, moveObj.name, lang);
  await interaction.editReply({ embeds: [embed], files, components: [rerollRow, statsRow] });
}

// ── /calc guess ───────────────────────────────────────────────────────────────

async function handleGuess(interaction) {
  await interaction.deferReply();
  const useStatChanges = interaction.options.getBoolean('stat_changes') ?? false;
  const lang           = interaction.options.getString('lang') ?? 'en';
  const data = generateRandomResult({ useStatChanges });
  if (!data) {
    await interaction.editReply(ui('errorGuess', lang));
    return;
  }
  const { attacker, defender, moveObj, field, result, attackerEVs, defenderEVs } = data;
  const { embed, files, minDmg, maxDmg, defHP, calcDesc } = await buildResultEmbed(
    attacker, defender, moveObj, field, result, attackerEVs, defenderEVs,
    { isRandom: true, hideRoll: true, lang },
  );

  const guessKey = interaction.id;
  const guessRow = makeGuessRow(minDmg, maxDmg, defHP, guessKey, `guess_reroll|${guessKey}|${lang}`, lang);
  const statsRow = makeStatsRow(attacker.name, defender.name, moveObj.name, lang, true);
  await interaction.editReply({ embeds: [embed], files, components: [guessRow, statsRow] });

  guessStates.set(guessKey, { startTime: Date.now(), wrongCount: 0, calcDesc, minDmg, maxDmg, defHP, useStatChanges, lang });

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

/**
 * Run the random scenario generator and return the result data, or null if all attempts fail.
 */
function generateRandomResult({ useStatChanges = false } = {}) {
  const { fullyEvolved, damageMoves, allAbilities, allItems } = getGen9Data();

  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      const attackerName    = randomChoice(fullyEvolved);
      const defenderName    = randomChoice(fullyEvolved);
      const moveName        = randomChoice(damageMoves);
      const attackerAbility = randomChoice(allAbilities);
      const defenderAbility = randomChoice(allAbilities);
      const attackerItem    = randomChoice(allItems);
      let defenderItem = randomChoice(allItems);
      while (defenderItem === 'Focus Sash') defenderItem = randomChoice(allItems);
      const attackerNature  = randomChoice(NATURES);
      const defenderNature  = randomChoice(NATURES);

      const isDoubles     = Math.random() > 0.20;
      const weather       = Math.random() < 0.25 ? randomChoice(RANDOM_WEATHERS) : undefined;
      const terrain       = Math.random() < 0.20 ? randomChoice(RANDOM_TERRAINS) : undefined;
      const isHelpingHand = Math.random() < 0.20;

      const isReflect          = Math.random() < 0.15;
      const isLightScreen      = Math.random() < 0.15;
      const isAuroraVeil       = Math.random() < 0.10;
      const isFriendGuard      = isDoubles && Math.random() < 0.15;
      const isWonderRoom       = Math.random() < 0.08;
      const isMagicRoom        = Math.random() < 0.08;
      const isAttackerTailwind = Math.random() < 0.15;
      const isDefenderTailwind = Math.random() < 0.15;

      const bothAbilities   = [attackerAbility, defenderAbility];
      const isFairyAura     = bothAbilities.includes('Fairy Aura');
      const isDarkAura      = bothAbilities.includes('Dark Aura');
      const isBeadsOfRuin   = bothAbilities.includes('Beads of Ruin');
      const isSwordOfRuin   = bothAbilities.includes('Sword of Ruin');
      const isTabletsOfRuin = bothAbilities.includes('Tablets of Ruin');
      const isVesselOfRuin  = bothAbilities.includes('Vessel of Ruin');

      const attackerEVs    = randomSpread();
      const defenderEVs    = randomSpread();
      const attackerBoosts = useStatChanges ? randomBoosts() : {};
      const defenderBoosts = useStatChanges ? randomBoosts() : {};

      const isCrit  = getCritStage(moveName, attackerItem, attackerAbility) >= 3 || Math.random() < 0.20;
      const moveObj  = new Move(9, moveName, { isCrit });

      if (defenderAbility === 'Weak Armor' && moveObj.hits > 1) continue;
      const attacker = new Pokemon(9, attackerName, {
        level: 50,
        item: attackerItem, ability: attackerAbility, nature: attackerNature,
        evs: attackerEVs, boosts: attackerBoosts,
        ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      });
      const defender = new Pokemon(9, defenderName, {
        level: 50,
        item: defenderItem, ability: defenderAbility, nature: defenderNature,
        evs: defenderEVs, boosts: defenderBoosts,
        ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      });

      if (ATTACKER_HP_MOVES.has(moveName)) {
        const pct = 5 + Math.floor(Math.random() * 91);
        attacker.originalCurHP = Math.max(1, Math.floor(attacker.maxHP() * pct / 100));
      }
      if (DEFENDER_HP_MOVES.has(moveName)) {
        const pct = 5 + Math.floor(Math.random() * 91);
        defender.originalCurHP = Math.max(1, Math.floor(defender.maxHP() * pct / 100));
      }

      const { weather: resolvedWeather, terrain: resolvedTerrain } =
        resolveWeatherTerrain(bothAbilities, weather, terrain);

      const field = new Field({
        gameType: isDoubles ? 'Doubles' : 'Singles',
        weather: resolvedWeather, terrain: resolvedTerrain,
        isFairyAura, isDarkAura,
        isBeadsOfRuin, isSwordOfRuin, isTabletsOfRuin, isVesselOfRuin,
        isWonderRoom, isMagicRoom,
        attackerSide: new Side({ isHelpingHand, isTailwind: isAttackerTailwind }),
        defenderSide: new Side({ isReflect, isLightScreen, isAuroraVeil, isFriendGuard, isTailwind: isDefenderTailwind }),
      });

      const result = calculate(9, attacker, defender, moveObj, field);

      const rolls = result.damage;
      const hasDamage = typeof rolls === 'number'
        ? rolls > 0
        : (Array.isArray(rolls) && rolls.flat(2).some(v => v > 0));

      if (hasDamage) return { attacker, defender, moveObj, field, result, attackerEVs, defenderEVs };

    } catch {
      // retry
    }
  }

  return null;
}

function randomSpread() {
  const keys    = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
  const evs     = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  const allocs  = [252, 252, 4];
  const shuffled = [...keys].sort(() => Math.random() - 0.5);
  allocs.forEach((v, i) => { evs[shuffled[i]] = v; });
  return evs;
}
