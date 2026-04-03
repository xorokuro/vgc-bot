'use strict';

// Maps every reasonable abbreviation a user might type to a canonical stat key.
// Single-letter HABCDS shorthand: H=HP A=Atk B=Def C=SpA D=SpD S=Spe
const STAT_ALIASES = {
  // single-letter HABCDS
  h:              'hp',
  a:              'atk',
  b:              'def',
  c:              'spa',
  d:              'spd',
  s:              'spe',
  // full / abbreviated names
  hp:             'hp',
  atk:            'atk',  attack:       'atk',
  def:            'def',  defense:      'def',  defence:      'def',
  spa:            'spa',  spatk:        'spa',  speatk:       'spa',
  specialattack:  'spa',  spattack:     'spa',  sattk:        'spa',
  spd:            'spd',  spdef:        'spd',  spedef:       'spd',
  specialdefense: 'spd',  spdefense:    'spd',  sdef:         'spd',
  spe:            'spe',  speed:        'spe',
};

// Maps (boostedKey/reducedKey) → nature name
const BOOST_REDUCE_TO_NATURE = {
  'atk/def': 'Lonely',  'atk/spa': 'Adamant', 'atk/spd': 'Naughty', 'atk/spe': 'Brave',
  'def/atk': 'Bold',    'def/spa': 'Impish',  'def/spd': 'Lax',     'def/spe': 'Relaxed',
  'spa/atk': 'Modest',  'spa/def': 'Mild',    'spa/spd': 'Rash',    'spa/spe': 'Quiet',
  'spd/atk': 'Calm',    'spd/def': 'Gentle',  'spd/spa': 'Careful', 'spd/spe': 'Sassy',
  'spe/atk': 'Timid',   'spe/def': 'Hasty',   'spe/spa': 'Jolly',   'spe/spd': 'Naive',
};

// Representative nature when only the boosted stat is given
const BOOST_ONLY_TO_NATURE = {
  atk: 'Adamant', def: 'Bold', spa: 'Modest', spd: 'Calm', spe: 'Timid',
};

/**
 * Extract a nature modifier from an EV string.
 * Supported: "+SpA/-Atk", "+SpA", "+C/-A", etc. (HABCDS or full names)
 * Returns { nature: string|null, cleaned: string } where cleaned has the modifier stripped.
 */
function parseNatureFromEVStr(input) {
  if (!input) return { nature: null, cleaned: input };

  const boostMatch  = /\+([a-zA-Z]+)/.exec(input);
  const reduceMatch = /-([a-zA-Z]+)/.exec(input);

  const boostKey  = boostMatch  ? STAT_ALIASES[boostMatch[1].toLowerCase()]  : null;
  const reduceKey = reduceMatch ? STAT_ALIASES[reduceMatch[1].toLowerCase()] : null;

  let nature  = null;
  let cleaned = input;

  if (boostKey && reduceKey && boostKey !== reduceKey) {
    nature  = BOOST_REDUCE_TO_NATURE[`${boostKey}/${reduceKey}`] ?? null;
    cleaned = input.replace(/[+-][a-zA-Z]+/g, '').trim();
  } else if (boostKey) {
    nature  = BOOST_ONLY_TO_NATURE[boostKey] ?? null;
    cleaned = input.replace(/\+[a-zA-Z]+/g, '').trim();
  }

  return { nature, cleaned };
}

/**
 * Parse an EV string from a Discord option into a stats object.
 *
 * Supported formats:
 *   "252 HP 252 Atk 4 Spe"  →  exact numbers
 *   "HP Atk"                 →  252 to each named stat, 0 to rest
 *   null / ""                →  smart defaults based on role + move category
 *
 * @param {string|null} input
 * @param {'attacker'|'defender'} role
 * @param {'Physical'|'Special'|'Status'} moveCategory
 * @returns {{ hp:number, atk:number, def:number, spa:number, spd:number, spe:number }}
 */
function parseEVs(input, role = 'attacker', moveCategory = 'Physical') {
  const evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

  if (!input || !input.trim()) {
    // Smart defaults
    if (role === 'attacker') {
      evs[moveCategory === 'Special' ? 'spa' : 'atk'] = 252;
      evs.spe = 252;
    }
    return evs;
  }

  const str = input.trim();

  if (/\d/.test(str)) {
    // Accepts both orderings and optional colon/comma separators:
    //   value-first:  "252 Atk"  "252atk"  "252 SpA"
    //   stat-first:   "H:252"    "A:252"   "SpA:252"
    const re = /([a-zA-Z]+)\s*:\s*(\d+)|(\d+)\s*[+\-]?\s*([a-zA-Z]+)/g;
    let m;
    while ((m = re.exec(str)) !== null) {
      const [statRaw, numRaw] = m[1] != null
        ? [m[1], m[2]]   // stat:value form
        : [m[4], m[3]];  // value stat form
      const val = Math.min(252, Math.max(0, parseInt(numRaw, 10)));
      const key = STAT_ALIASES[statRaw.toLowerCase()];
      if (key) evs[key] = val;
    }
  } else {
    // Shorthand: "HP Atk Spe" or "H A S" → 252 each
    for (const token of str.split(/[\s,]+/)) {
      const key = STAT_ALIASES[token.toLowerCase()];
      if (key) evs[key] = 252;
    }
  }

  return evs;
}

/**
 * Format an EVs object into a human-readable string.
 * Only stats > 0 are shown.  Returns "0 EVs" if all are zero.
 *
 * @param {{ hp:number, atk:number, def:number, spa:number, spd:number, spe:number }} evs
 * @returns {string}
 */
function formatEVs(evs) {
  const LABELS = { hp: 'H', atk: 'A', def: 'B', spa: 'C', spd: 'D', spe: 'S' };
  const parts = [];
  for (const [stat, label] of Object.entries(LABELS)) {
    if (evs[stat] > 0) parts.push(`${evs[stat]}${label}`);
  }
  return parts.length ? parts.join(' / ') : '0';
}

module.exports = { parseEVs, formatEVs, parseNatureFromEVStr };
