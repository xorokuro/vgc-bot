'use strict';

const { Generations, toID } = require('@smogon/calc');

// Lazily initialized caches — populated on first call to getGen9Data()
let _fullyEvolved = null;
let _allSpecies   = null;
let _damageMoves  = null;
let _allAbilities = null;
let _allItems     = null;

/**
 * Returns lazily-built Gen 9 data arrays for the random command.
 * @returns {{ fullyEvolved: string[], damageMoves: string[], allAbilities: string[], allItems: string[] }}
 */
function getGen9Data() {
  if (_fullyEvolved) {
    return {
      fullyEvolved: _fullyEvolved,
      allSpecies:   _allSpecies,
      damageMoves:  _damageMoves,
      allAbilities: _allAbilities,
      allItems:     _allItems,
    };
  }

  const gen9 = Generations.get(9);

  _fullyEvolved = [...gen9.species]
    .filter(s => !s.nfe)
    .map(s => s.name);

  _allSpecies = [...gen9.species].map(s => s.name);

  // Include all damage-dealing moves except Z-moves, Max/G-Max moves, and Struggle
  _damageMoves = [...gen9.moves]
    .filter(m => m.category !== 'Status' && m.name !== 'Struggle' && !m.isZ && !m.isMax)
    .map(m => m.name);

  _allAbilities = [...gen9.abilities]
    .map(a => a.name);

  _allItems = [...gen9.items]
    .map(i => i.name);

  console.log(
    `[pokeData] Loaded Gen 9: ${_fullyEvolved.length} fully-evolved species, ` +
    `${_damageMoves.length} damage moves, ${_allAbilities.length} abilities, ` +
    `${_allItems.length} items`
  );

  return {
    fullyEvolved: _fullyEvolved,
    allSpecies:   _allSpecies,
    damageMoves:  _damageMoves,
    allAbilities: _allAbilities,
    allItems:     _allItems,
  };
}

/**
 * Look up base stats for a species by name.
 * Returns { hp, atk, def, spa, spd, spe } or null if not found.
 */
function getBaseStats(name) {
  const gen9    = Generations.get(9);
  const species = gen9.species.get(toID(name));
  return species ? species.baseStats : null;
}

/**
 * Parse a boost string like "+2 Atk -1 SpD" into a boosts object.
 * Accepted stat names: Atk, Def, SpA, SpD, Spe (case-insensitive).
 */
function parseBoosts(str) {
  if (!str) return {};
  const map = { atk: 'atk', def: 'def', spa: 'spa', spd: 'spd', spe: 'spe' };
  const boosts = {};
  const regex = /([+-]?\d+)\s*(atk|def|spa|spd|spe)/gi;
  let m;
  while ((m = regex.exec(str)) !== null) {
    const key = map[m[2].toLowerCase()];
    const val = Math.max(-6, Math.min(6, parseInt(m[1], 10)));
    if (key && val !== 0) boosts[key] = val;
  }
  return boosts;
}

/**
 * Generate a random set of stat boosts for use in random/guess scenarios.
 * Gives 1–2 stats a boost between -2 and +2.
 */
function randomBoosts() {
  const stats   = ['atk', 'def', 'spa', 'spd', 'spe'];
  const boosts  = {};
  const count   = Math.random() < 0.5 ? 1 : 2;
  const shuffled = [...stats].sort(() => Math.random() - 0.5);
  for (let i = 0; i < count; i++) {
    const val = Math.floor(Math.random() * 5) - 2; // -2 to +2
    if (val !== 0) boosts[shuffled[i]] = val;
  }
  return boosts;
}

/**
 * Pick a random element from an array.
 * @template T
 * @param {T[]} arr
 * @returns {T}
 */
function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── Type chart ────────────────────────────────────────────────────────────────
// CHART[attackingType][defendingType] = multiplier (only non-1 values listed)
const TYPE_CHART = {
  Normal:   { Rock: 0.5, Ghost: 0, Steel: 0.5 },
  Fire:     { Fire: 0.5, Water: 0.5, Grass: 2, Ice: 2, Bug: 2, Rock: 0.5, Dragon: 0.5, Steel: 2 },
  Water:    { Fire: 2, Water: 0.5, Grass: 0.5, Ground: 2, Rock: 2, Dragon: 0.5 },
  Electric: { Water: 2, Electric: 0.5, Grass: 0.5, Ground: 0, Flying: 2, Dragon: 0.5 },
  Grass:    { Fire: 0.5, Water: 2, Grass: 0.5, Poison: 0.5, Ground: 2, Flying: 0.5, Bug: 0.5, Rock: 2, Dragon: 0.5, Steel: 0.5 },
  Ice:      { Water: 0.5, Grass: 2, Ice: 0.5, Ground: 2, Flying: 2, Dragon: 2, Steel: 0.5 },
  Fighting: { Normal: 2, Ice: 2, Poison: 0.5, Flying: 0.5, Psychic: 0.5, Bug: 0.5, Rock: 2, Ghost: 0, Dark: 2, Steel: 2, Fairy: 0.5 },
  Poison:   { Grass: 2, Poison: 0.5, Ground: 0.5, Rock: 0.5, Ghost: 0.5, Steel: 0, Fairy: 2 },
  Ground:   { Fire: 2, Electric: 2, Grass: 0.5, Poison: 2, Flying: 0, Bug: 0.5, Rock: 2, Steel: 2 },
  Flying:   { Electric: 0.5, Grass: 2, Fighting: 2, Bug: 2, Rock: 0.5, Steel: 0.5 },
  Psychic:  { Fighting: 2, Poison: 2, Psychic: 0.5, Dark: 0, Steel: 0.5 },
  Bug:      { Fire: 0.5, Grass: 2, Fighting: 0.5, Flying: 0.5, Psychic: 2, Ghost: 0.5, Dark: 2, Steel: 0.5, Fairy: 0.5 },
  Rock:     { Fire: 2, Ice: 2, Fighting: 0.5, Ground: 0.5, Flying: 2, Bug: 2, Steel: 0.5 },
  Ghost:    { Normal: 0, Psychic: 2, Ghost: 2, Dark: 0.5 },
  Dragon:   { Dragon: 2, Steel: 0.5, Fairy: 0 },
  Dark:     { Fighting: 0.5, Psychic: 2, Ghost: 2, Dark: 0.5, Fairy: 0.5 },
  Steel:    { Fire: 0.5, Water: 0.5, Electric: 0.5, Ice: 2, Rock: 2, Steel: 0.5, Fairy: 2 },
  Fairy:    { Fire: 0.5, Fighting: 2, Poison: 0.5, Dragon: 2, Dark: 2, Steel: 0.5 },
};

const ALL_TYPES = [
  'Normal','Fire','Water','Electric','Grass','Ice','Fighting','Poison',
  'Ground','Flying','Psychic','Bug','Rock','Ghost','Dragon','Dark','Steel','Fairy',
];

/**
 * Calculate type weaknesses/resistances for a Pokémon.
 * If teraType is provided (and not 'Stellar'), the tera type is used as the sole defensive type.
 * Returns { types, '4': [], '2': [], '0.5': [], '0.25': [], '0': [] }
 */
function getTypeWeaknesses(pokemonName, teraType = null) {
  const gen9    = Generations.get(9);
  const species = gen9.species.get(toID(pokemonName));
  if (!species) return null;

  const defTypes = (teraType && teraType !== 'Stellar')
    ? [teraType]
    : [...species.types];

  const result = { types: defTypes, '4': [], '2': [], '0.5': [], '0.25': [], '0': [] };

  for (const atkType of ALL_TYPES) {
    const atkChart = TYPE_CHART[atkType] ?? {};
    let mult = 1;
    for (const defType of defTypes) {
      mult *= atkChart[defType] ?? 1;
    }
    if      (mult === 0)    result['0'].push(atkType);
    else if (mult === 0.25) result['0.25'].push(atkType);
    else if (mult === 0.5)  result['0.5'].push(atkType);
    else if (mult === 2)    result['2'].push(atkType);
    else if (mult === 4)    result['4'].push(atkType);
    // mult === 1: neutral, omit
  }

  return result;
}

module.exports = { getGen9Data, randomChoice, getBaseStats, parseBoosts, randomBoosts, getTypeWeaknesses };
