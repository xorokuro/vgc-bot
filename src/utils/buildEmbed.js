'use strict';

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { toID } = require('@smogon/calc');
const { formatEVs } = require('./evParser');
const { compositeSprites } = require('./spriteComposite');
const { translate, ui, translateType, translateCategory, translateStat, translateNatureMod, translateKOText } = require('./i18n');

// Nature → [boosted stat, reduced stat] (neutral natures omitted)
const NATURE_MODS = {
  Lonely:  ['+Atk', '-Def'],  Brave:   ['+Atk', '-Spe'],
  Adamant: ['+Atk', '-SpA'],  Naughty: ['+Atk', '-SpD'],
  Bold:    ['+Def', '-Atk'],  Relaxed: ['+Def', '-Spe'],
  Impish:  ['+Def', '-SpA'],  Lax:     ['+Def', '-SpD'],
  Timid:   ['+Spe', '-Atk'],  Hasty:   ['+Spe', '-Def'],
  Jolly:   ['+Spe', '-SpA'],  Naive:   ['+Spe', '-SpD'],
  Modest:  ['+SpA', '-Atk'],  Mild:    ['+SpA', '-Def'],
  Quiet:   ['+SpA', '-Spe'],  Rash:    ['+SpA', '-SpD'],
  Calm:    ['+SpD', '-Atk'],  Gentle:  ['+SpD', '-Def'],
  Sassy:   ['+SpD', '-Spe'],  Careful: ['+SpD', '-SpA'],
};

// Moves that automatically grant a stat boost as part of their mechanic
const MOVE_INHERENT_BOOSTS = {
  'Electro Shot': { spa: 1 },
  'Meteor Beam':  { spa: 1 },
  'Skull Bash':   { def: 1 },
};

// Moves whose power scales with the user's current HP — always show attacker HP
const HP_SCALING_MOVES = new Set(['Eruption', 'Water Spout', 'Reversal', 'Flail', 'Wring Out', 'Crush Grip']);

// Application emojis — type icons
const TYPE_EMOJI = {
  Normal:   '<:normal:1485645329276866590>',
  Fire:     '<:fire:1485645341406531624>',
  Water:    '<:water:1485645317410914374>',
  Electric: '<:electric:1485645346829893753>',
  Grass:    '<:grass:1485645334884520097>',
  Ice:      '<:ice:1485645330962972753>',
  Fighting: '<:fighting:1485645343231185057>',
  Poison:   '<:poison:1485645327007486075>',
  Ground:   '<:ground:1485645332867186699>',
  Flying:   '<:flying:1485645338940276776>',
  Psychic:  '<:psychic:1485645325451661432>',
  Bug:      '<:bug:1485644797862613155>',
  Rock:     '<:rock:1485645323325149365>',
  Ghost:    '<:ghost:1485645336725950646>',
  Dragon:   '<:dragon:1485645349589618808>',
  Dark:     '<:dark:1485645351351484657>',
  Steel:    '<:steel:1485645319747407943>',
  Fairy:    '<:fairy:1485645345143914536>',
  Stellar:  '<:stellar:1485645315418755243>',
};

// Application emojis — move category icons
const CATEGORY_EMOJI = {
  Physical: '<:physical:1485645307654967526>',
  Special:  '<:special:1485645309538467931>',
};

// Item emojis — fill in emoji IDs after uploading sprites to the dev portal
// Emoji name must match what you name them when uploading (no spaces, no special chars)
const ITEM_EMOJI = {
  'Assault Vest':    '1485974276174774282',
  'Black Glasses':   '1485974274333347910',
  'Black Sludge':    '1485975131741225102',
  'Charcoal':        '1485975133372940469',
  'Choice Band':     '1485974272470941726',
  'Choice Scarf':    '1485975135285416048',
  'Choice Specs':    '1485974270692561047',
  'Damp Rock':       '1485975136975716403',
  'Dragon Fang':     '1485974269144993793',
  'Eject Button':    '1485974267534512218',
  'Eviolite':        '1485974265659658280',
  'Flame Orb':       '1485974263901978804',
  'Focus Sash':      '1485974262094233720',
  'Heat Rock':       '1485974260370509964',
  'Lagging Tail':    '1485974258545852536',
  'Leftovers':       '1485974256901816350',
  'Life Orb':        '1485974254964052058',
  'Light Clay':      '1485974253135204503',
  'Lum Berry':       '1485974251491037204',
  'Magnet':          '1485974249905717288',
  'Mental Herb':     '1485974247301189683',
  'Miracle Seed':    '1485974244981739663',
  'Mystic Water':    '1485974243240837140',
  'Never-Melt Ice':  '1485974241630359673',
  'Normal Gem':      '1485974239558238349',
  'Pixie Plate':     '1485974237788246096',
  'Power Herb':      '1485974236039348227',
  'Razor Claw':      '1485974234311164005',
  'Rocky Helmet':    '1485974232637771938',
  'Roseli Berry':    '1485974231014703154',
  'Safety Goggles':  '1485974229072478321',
  'Scope Lens':      '1485974227185041528',
  'Sharp Beak':      '1485974225385820332',
  'Silk Scarf':      '1485974222881685595',
  'Sitrus Berry':    '1485974220797378600',
  'Spell Tag':       '1485974218796695652',
  'Twisted Spoon':   '1485974216678314236',
  'Weakness Policy': '1485974215004913765',
  'White Herb':      '1485974213373333515',
  'Wide Lens':       '1485642605164494890',
};

// Application emojis — UI icons
const E = {
  attacker: '<:attacker:1485642832936177745>',
  defender: '<:defender:1485643276609392711>',
  field:    '<:field:1485642784995147816>',
  single:   '<:single:1485979505515298887>',
  double:   '<:double:1485979507000217642>',
};

// Embed border colours keyed by move type
const TYPE_COLORS = {
  Normal:   0xA8A878, Fire:     0xF08030, Water:    0x6890F0,
  Electric: 0xF8D030, Grass:    0x78C850, Ice:      0x98D8D8,
  Fighting: 0xC03028, Poison:   0xA040A0, Ground:   0xE0C068,
  Flying:   0xA890F0, Psychic:  0xF85888, Bug:      0xA8B820,
  Rock:     0xB8A038, Ghost:    0x705898, Dragon:   0x7038F8,
  Dark:     0x705848, Steel:    0xB8B8D0, Fairy:    0xEE99AC,
  Stellar:  0x9EDDF5,
};

// Weather-label key map (field.weather value → UI key)
const WEATHER_UI_KEY = {
  'Sun':             'wSun',
  'Rain':            'wRain',
  'Sand':            'wSand',
  'Snow':            'wSnow',
  'Harsh Sunshine':  'wHarsh',
  'Heavy Rain':      'wHeavy',
  'Strong Winds':    'wStrong',
};

// Terrain-label key map (field.terrain value → UI key)
const TERRAIN_UI_KEY = {
  'Grassy':   'tGrassy',
  'Electric': 'tElectric',
  'Psychic':  'tPsychic',
  'Misty':    'tMisty',
};

const WEATHER_EMOJI = {
  Rain:             TYPE_EMOJI.Water,
  Snow:             TYPE_EMOJI.Ice,
  Sand:             '<:sandstorm:1485643494419595264>',
  Sun:              TYPE_EMOJI.Fire,
  'Harsh Sunshine': TYPE_EMOJI.Fire,
  'Heavy Rain':     TYPE_EMOJI.Water,
  'Strong Winds':   TYPE_EMOJI.Flying,
};

const TERRAIN_EMOJI = {
  Grassy:   TYPE_EMOJI.Grass,
  Electric: TYPE_EMOJI.Electric,
  Psychic:  TYPE_EMOJI.Psychic,
  Misty:    TYPE_EMOJI.Fairy,
};

/** Upgrade plain ♀/♂ text characters to emoji presentation in Discord. */
const genderEmoji = s => s.replace(/♀/g, '♀️').replace(/♂/g, '♂️');

/** Returns the item emoji string if an ID is configured, otherwise empty string. */
function itemEmoji(name) {
  const id = ITEM_EMOJI[name];
  return id ? `<:${toID(name)}:${id}> ` : '';
}

// Alternate forms whose PS HOME sprite is missing or wrong.
// Maps smogon toID → PokeAPI HOME sprite ID (the numeric file in /sprites/pokemon/other/home/).
const POKEAPI_FORM_ID = {
  'indeedeef':          10186,
  'urshifurapidstrike': 10191,
  'ursalunabloodmoon':  10272,
  'landorustherian':    10021,
  'weezinggalar':       10167,
  'calyrexshadow':      10194,
  'calyrexice':         10193,
  'lilliganthisui':     10237,
};

/**
 * Returns an ordered list of sprite URLs to try for a given Pokémon name.
 * For known alternate forms: PokeAPI form sprite first, then PS as fallback.
 * For everything else: PS HOME sprite only.
 */
function getHomeSpriteUrls(name) {
  const id    = toID(name);
  const psUrl = `https://play.pokemonshowdown.com/sprites/home/${id}.png`;

  const formId = POKEAPI_FORM_ID[id];
  if (formId) {
    return [
      `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home/${formId}.png`,
      psUrl,
    ];
  }
  return [psUrl];
}

function getRolls(damage) {
  if (typeof damage === 'number') return [damage];
  if (!Array.isArray(damage) || damage.length === 0) return [0];
  if (Array.isArray(damage[0])) {
    const numRolls = damage[0].length;
    const totals = [];
    for (let i = 0; i < numRolls; i++) {
      totals.push(damage.reduce((sum, hitRolls) => sum + (hitRolls[i] ?? 0), 0));
    }
    return totals;
  }
  return damage;
}

/**
 * Build a Discord EmbedBuilder from a completed @smogon/calc Result.
 * Returns { embed, files } — files may be empty if sprite compositing fails.
 *
 * opts:
 *   lang         - 'en' | 'ja' | 'zh'  (default 'en')
 *   hideRoll     - hide the damage roll (guess mode)
 *   isRandom     - adjust footer text for random/meta scenarios
 *   footerSuffix - extra text appended to footer
 */
async function buildResultEmbed(attacker, defender, move, field, result, attackerEVs, defenderEVs, opts = {}) {
  const lang = opts.lang ?? 'en';

  const rolls            = getRolls(result.damage);
  const [minDmg, maxDmg] = result.range();
  const defHP            = defender.maxHP();
  const minPct           = (minDmg / defHP * 100).toFixed(1);
  const maxPct           = (maxDmg / defHP * 100).toFixed(1);
  let ko = null;
  try { ko = result.kochance(); } catch { /* move deals 0 damage (e.g. Metal Burst) */ }
  const koLine = ko?.text ? `**${translateKOText(ko.text, lang)}**` : ui('noKO', lang);

  let calcDesc = '';
  try { calcDesc = result.fullDesc('%'); } catch { /* ignore */ }

  const color = TYPE_COLORS[move.type] ?? 0x5865F2;

  // Translated display names (still use English for @smogon/calc internally)
  const attackerDisplay = genderEmoji(translate(attacker.name, 'pokemon', lang));
  const defenderDisplay = genderEmoji(translate(defender.name, 'pokemon', lang));
  const moveDisplay     = translate(move.name, 'move', lang);
  const moveTypeDisplay = translateType(move.type, lang);

  // ── Field conditions ────────────────────────────────────────────────────────
  const conds = [];
  conds.push(field.gameType === 'Doubles'
    ? `${E.double} ${ui('doubles', lang)}`
    : `${E.single} ${ui('singles', lang)}`);
  if (move.isCrit)                              conds.push(`⚡ ${ui('critHit', lang)}`);
  if (field.weather) {
    const wKey = WEATHER_UI_KEY[field.weather];
    conds.push(`${WEATHER_EMOJI[field.weather] ?? '☁️'} ${wKey ? ui(wKey, lang) : field.weather}`);
  }
  if (field.terrain) {
    const tKey = TERRAIN_UI_KEY[field.terrain];
    conds.push(`${TERRAIN_EMOJI[field.terrain] ?? '🌿'} ${tKey ? ui(tKey, lang) : field.terrain}`);
  }
  if (field.attackerSide?.isHelpingHand)  conds.push(`🤝 ${ui('helpingHand', lang)}`);
  if (field.attackerSide?.isTailwind)     conds.push(`${TYPE_EMOJI.Flying} ${ui('tailwindAtk', lang)}`);
  if (field.defenderSide?.isTailwind)     conds.push(`${TYPE_EMOJI.Flying} ${ui('tailwindDef', lang)}`);
  if (field.isFairyAura)                  conds.push(`✨ ${ui('fairyAura', lang)}`);
  if (field.isDarkAura)                   conds.push(`🌑 ${ui('darkAura', lang)}`);
  if (field.isBeadsOfRuin)                conds.push(`📿 ${ui('beadsOfRuin', lang)}`);
  if (field.isSwordOfRuin)                conds.push(`⚔️ ${ui('swordOfRuin', lang)}`);
  if (field.isTabletsOfRuin)              conds.push(`📜 ${ui('tabletsOfRuin', lang)}`);
  if (field.isVesselOfRuin)               conds.push(`🏺 ${ui('vesselOfRuin', lang)}`);
  if (field.defenderSide?.isReflect)      conds.push(`<:reflect:1485642462004510873> ${ui('reflect', lang)}`);
  if (field.defenderSide?.isLightScreen)  conds.push(`<:lightscreen:1485642515548868844> ${ui('lightScreen', lang)}`);
  if (field.defenderSide?.isAuroraVeil)   conds.push(`<:auroraveil:1485642549359153293> ${ui('auroraVeil', lang)}`);
  if (field.defenderSide?.isFriendGuard)  conds.push(`🤝 ${ui('friendGuard', lang)}`);
  if (field.isWonderRoom)                 conds.push(`<:wonderroom:1485643742634311732> ${ui('wonderRoom', lang)}`);
  if (field.isMagicRoom)                  conds.push(`<:magicroom:1485642890301538334> ${ui('magicRoom', lang)}`);

  // ── Pokémon info panels ─────────────────────────────────────────────────────
  function pokeInfo(poke, evs, bonusBoosts = {}, alwaysShowHP = false) {
    const natureName = poke.nature;
    const natureDisplay = natureName ? translate(natureName, 'nature', lang) : null;

    const lines = [`**${ui('evs', lang)}:** ${formatEVs(evs)}  |  **${ui('ivs', lang)}:** ${ui('ivsValue', lang)}`];

    if (natureDisplay) {
      const mod = NATURE_MODS[natureName];
      const natureSuffix = mod
        ? ` (${translateNatureMod(mod[0], lang)} / ${translateNatureMod(mod[1], lang)})`
        : '';
      lines.push(`**${ui('nature', lang)}:** ${natureDisplay}${natureSuffix}`);
    }
    if (poke.ability) lines.push(`**${ui('ability', lang)}:** ${translate(poke.ability, 'ability', lang)}`);
    if (poke.item)    lines.push(`**${ui('item', lang)}:** ${itemEmoji(poke.item)}${translate(poke.item, 'item', lang)}`);
    if (poke.status)  lines.push(`**${ui('status', lang)}:** ${poke.status.toUpperCase()}`);
    if (poke.teraType) {
      const tEmoji = TYPE_EMOJI[poke.teraType] ?? '';
      lines.push(`**${ui('teraType', lang)}:** ${tEmoji} ${translateType(poke.teraType, lang)}`);
    }
    const maxHP = poke.maxHP();
    const curHP = poke.curHP();
    if (curHP < maxHP || alwaysShowHP) {
      const pct = Math.round(curHP / maxHP * 100);
      lines.push(`**${ui('hp', lang)}:** ${curHP}/${maxHP} (${pct}%)`);
    }
    // Merge boosts
    const b = { ...(poke.boosts ?? {}) };
    for (const [k, v] of Object.entries(bonusBoosts)) b[k] = (b[k] ?? 0) + v;
    const boostParts = ['atk', 'def', 'spa', 'spd', 'spe']
      .filter(k => b[k])
      .map(k => `${b[k] > 0 ? '+' : ''}${b[k]} ${translateStat(k, lang)}`);
    if (boostParts.length) lines.push(`**${ui('boosts', lang)}:** ${boostParts.join(' / ')}`);
    return lines.join('\n');
  }

  const minRem = Math.max(0, defHP - maxDmg);
  const maxRem = Math.max(0, defHP - minDmg);
  const damageText = [
    `**${minPct}% – ${maxPct}%**  (${ui('outOf', lang, { hp: defHP })})`,
    koLine,
  ].join('\n');

  // Composite sprites + HP bar
  let spriteAttachment = null;
  try {
    spriteAttachment = await compositeSprites(
      getHomeSpriteUrls(attacker.name),
      getHomeSpriteUrls(defender.name),
      opts.hideRoll ? null : { minRem, maxRem, defHP },
    );
  } catch { /* no image */ }

  // Footer — rolls appended so they're accessible without taking embed height
  let footerText = opts.isRandom
    ? `${ui('randomScenario', lang)}  ·  ${ui('lv50', lang)}  ·  ${ui('allIVs', lang)}`
    : `${ui('lv50', lang)}  ·  ${ui('allIVs', lang)}  ·  ${ui('gen9', lang)}`;
  if (opts.footerSuffix) footerText += opts.footerSuffix;
  if (!opts.hideRoll) footerText += `  ·  [${rolls.join(', ')}]`;

  // BP display — prefer the effective BP from calcDesc (e.g. Knock Off gets 97.5 BP when target holds item)
  const effectiveBPMatch = calcDesc.match(/\(([\d.]+)\s*BP\)/);
  const effectiveBP = effectiveBPMatch ? Number(effectiveBPMatch[1]) : move.bp;
  const bpDisplay = move.bp === 0
    ? `${ui('bpVariable', lang)} BP`
    : move.hits > 1
      ? `${effectiveBP} BP × ${move.hits} ${ui('hitsLabel', lang)}`
      : effectiveBP !== move.bp
        ? `${effectiveBP} BP *(${move.bp})*`
        : `${move.bp} BP`;

  const embed = new EmbedBuilder()
    .setTitle(`${attackerDisplay}  ${ui('vs', lang)}  ${defenderDisplay}`)
    .setColor(color)
    .setAuthor({ name: `${attackerDisplay}  ·  ${moveDisplay}  [${moveTypeDisplay}]  ·  ${bpDisplay}` })
    .setThumbnail(null)
    .setImage(spriteAttachment ? 'attachment://sprites.png' : null)
    .setDescription(!opts.hideRoll && calcDesc ? `> ${translateCalcDesc(calcDesc, attacker, defender, move, field, lang)}` : null)
    .addFields(
      {
        name:   `${E.field} ${ui('fieldConds', lang)}`,
        value:  conds.join('  ·  ') || 'None',
        inline: false,
      },
      {
        name:   `⚔️ ${ui('attacker', lang)} — ${attackerDisplay}`,
        value:  pokeInfo(attacker, attackerEVs, MOVE_INHERENT_BOOSTS[move.name] ?? {}, HP_SCALING_MOVES.has(move.name)),
        inline: true,
      },
      {
        name:   `🛡️ ${ui('defender', lang)} — ${defenderDisplay}`,
        value:  pokeInfo(defender, defenderEVs),
        inline: true,
      },
      opts.hideRoll
        ? { name: `<:target:1485642656859164932> ${ui('yourChallenge', lang)}`, value: ui('challengeDesc', lang, { hp: defHP }), inline: false }
        : { name: `<:dice:1485642703298625596> ${ui('damageRoll', lang)}`, value: damageText, inline: false },
    )
    .setFooter({ text: footerText });

  return {
    embed,
    files: spriteAttachment ? [spriteAttachment] : [],
    minDmg,
    maxDmg,
    defHP,
    minPct,
    maxPct,
    calcDesc: calcDesc ? translateCalcDesc(calcDesc, attacker, defender, move, field, lang) : calcDesc,
  };
}

/**
 * Build the "Base Stats & Move" button row.
 * lang is encoded in the customId so it survives to the button handler.
 */
function makeStatsRow(attackerName, defenderName, moveName = '', lang = 'en', showCalc = false, attackerTera = '', defenderTera = '') {
  const { ui: _ui } = require('./i18n');
  const buttons = [
    new ButtonBuilder()
      .setCustomId(`stats|${attackerName}|${defenderName}|${moveName}|${lang}`)
      .setLabel(_ui('baseStats', lang))
      .setEmoji({ id: '1485642605164494890', name: 'widelens' })
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`types|${attackerName}|${defenderName}|${attackerTera}|${defenderTera}|${lang}`)
      .setLabel('Types & Matchup')
      .setEmoji('🏷️')
      .setStyle(ButtonStyle.Secondary),
  ];
  if (showCalc) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId('calc_open')
        .setLabel('Calculator')
        .setEmoji('🧮')
        .setStyle(ButtonStyle.Secondary),
    );
  }
  return new ActionRowBuilder().addComponents(...buttons);
}

/**
 * Build the guess action row (Guess + See Answer + optional Reroll).
 */
function makeGuessRow(minDmg, maxDmg, defHP, guessKey, rerollCustomId = null, lang = 'en') {
  const { ui: _ui } = require('./i18n');
  const buttons = [
    new ButtonBuilder()
      .setCustomId(`guess_btn|${minDmg}|${maxDmg}|${defHP}|${guessKey}`)
      .setLabel(_ui('makeGuess', lang))
      .setEmoji({ id: '1485642656859164932', name: 'target' })
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`see_answer|${guessKey}`)
      .setLabel(_ui('seeAnswer', lang))
      .setEmoji('🔍')
      .setStyle(ButtonStyle.Secondary),
  ];
  if (rerollCustomId) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(rerollCustomId)
        .setLabel(_ui('reroll', lang))
        .setEmoji({ id: '1485642703298625596', name: 'dice' })
        .setStyle(ButtonStyle.Primary),
    );
  }
  return new ActionRowBuilder().addComponents(...buttons);
}

/**
 * Translate the key parts of a @smogon/calc fullDesc() string for JA/ZH display.
 * Replaces Pokémon/move/item names, weather/terrain conditions, and KO text.
 * Stat abbreviations (SpA, SpD …) are kept in English — universally understood
 * in competitive Pokémon communities.
 */
function translateCalcDesc(desc, attacker, defender, move, field, lang) {
  if (!desc || lang === 'en') return desc;
  let t = desc;

  // 1. Conditions and weather FIRST — must run before name/ability translations
  //    so that "with an ally's Friend Guard" is still intact in the string.
  const condMap = lang === 'ja'
    ? {
        "with an ally's Friend Guard": `${ui('friendGuard', lang)}あり`,
        'with Helping Hand':           `${ui('helpingHand', lang)}あり`,
        'on a critical hit':           '急所に当たった場合',
        'in Grassy Terrain':           `${ui('tGrassy', lang)}で`,
        'in Electric Terrain':         `${ui('tElectric', lang)}で`,
        'in Psychic Terrain':          `${ui('tPsychic', lang)}で`,
        'in Misty Terrain':            `${ui('tMisty', lang)}で`,
      }
    : {
        "with an ally's Friend Guard": `${ui('friendGuard', lang)}下`,
        'with Helping Hand':           `${ui('helpingHand', lang)}下`,
        'on a critical hit':           '擊中要害',
        'in Grassy Terrain':           `在${ui('tGrassy', lang)}下`,
        'in Electric Terrain':         `在${ui('tElectric', lang)}下`,
        'in Psychic Terrain':          `在${ui('tPsychic', lang)}下`,
        'in Misty Terrain':            `在${ui('tMisty', lang)}下`,
      };
  for (const [en, tr] of Object.entries(condMap)) t = t.replace(en, tr);

  const WEATHER_EN = {
    'Harsh Sunshine': ui('wHarsh', lang),
    'Heavy Rain':     ui('wHeavy', lang),
    'Strong Winds':   ui('wStrong', lang),
    'Rain':           ui('wRain', lang),
    'Sun':            ui('wSun', lang),
    'Sand':           ui('wSand', lang),
    'Snow':           ui('wSnow', lang),
  };
  for (const [en, tr] of Object.entries(WEATHER_EN)) {
    t = t.replace(
      new RegExp(`\\bin ${en}\\b`, 'g'),
      lang === 'ja' ? `${tr}の下` : `在${tr}下`,
    );
  }

  // 2. Pokémon, move, item, ability names
  const atkTr  = genderEmoji(translate(attacker.name, 'pokemon', lang));
  const defTr  = genderEmoji(translate(defender.name, 'pokemon', lang));
  const moveTr = translate(move.name, 'move', lang);
  if (atkTr  !== attacker.name) t = t.replace(attacker.name, atkTr);
  if (defTr  !== defender.name) t = t.replace(defender.name, defTr);
  if (moveTr !== move.name)     t = t.replace(move.name, moveTr);
  if (attacker.item) {
    const itemTr = translate(attacker.item, 'item', lang);
    if (itemTr !== attacker.item) t = t.replace(attacker.item, itemTr);
  }
  if (attacker.ability) {
    const abilityTr = translate(attacker.ability, 'ability', lang);
    if (abilityTr !== attacker.ability) t = t.replace(attacker.ability, abilityTr);
  }
  if (defender.item) {
    const defItemTr = translate(defender.item, 'item', lang);
    if (defItemTr !== defender.item) t = t.replace(defender.item, defItemTr);
  }
  if (defender.ability) {
    const defAbilityTr = translate(defender.ability, 'ability', lang);
    if (defAbilityTr !== defender.ability) t = t.replace(defender.ability, defAbilityTr);
  }

  // 3. "Helping Hand" between attacker name and move name in calcDesc
  const hhTr = lang === 'ja' ? ' てだすけ ' : ' 幫助 ';
  t = t.replace(' Helping Hand ', hhTr);

  // "(N hits)" from multi-hit moves
  t = t.replace(/\((\d+) hits\)/gi, (_, n) => lang === 'ja' ? `(${n}回)` : `(${n}下)`);

  // 4. Stat abbreviations: "252 Atk", "0 SpD", "252+ SpA" etc.
  const STAT_TR = lang === 'ja'
    ? { SpA: 'とくこう', SpD: 'とくぼう', Atk: 'こうげき', Def: 'ぼうぎょ', Spe: 'すばやさ' }
    : { SpA: '特攻',     SpD: '特防',     Atk: '攻擊',     Def: '防禦',     Spe: '速度'   };
  for (const [en, tr] of Object.entries(STAT_TR)) {
    t = t.replace(new RegExp(`\\b${en}\\b`, 'g'), tr);
  }

  // 4. KO text at end: "-- guaranteed OHKO" / "-- X% chance to NHKO"
  const koM = t.match(/--\s+(.+)$/);
  if (koM) {
    const koTr = translateKOText(koM[1].trim(), lang);
    if (koTr !== koM[1].trim()) t = t.replace(koM[0], `-- ${koTr}`);
  }

  return t;
}

module.exports = { buildResultEmbed, makeStatsRow, makeGuessRow, TYPE_EMOJI, CATEGORY_EMOJI };
