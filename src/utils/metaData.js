'use strict';

const path = require('path');
const fs   = require('fs');

// ── Load metaPool.json ────────────────────────────────────────────────────────
const META_POOL_PATH = path.join(__dirname, '..', '..', 'data', 'metaPool.json');

let _metaPool = null;

/**
 * Returns the array of meta Pokémon, loaded lazily on first call.
 * @returns {Array<{name:string, score:number, damageMoves:string[], allMoves:string[], abilities:string[], items:string[], natures:string[], teraTypes:string[]}>}
 */
function getMetaPool() {
  if (!_metaPool) {
    _metaPool = JSON.parse(fs.readFileSync(META_POOL_PATH, 'utf8'));
    console.log(`[metaData] Loaded ${_metaPool.length} meta Pokémon from metaPool.json`);
  }
  return _metaPool;
}

/**
 * Weighted random pick from an array of { name, weight } objects.
 * @param {Array<{name:string, weight:number}>} arr
 * @returns {string}
 */
function weightedChoice(arr) {
  const total  = arr.reduce((s, x) => s + x.weight, 0);
  let rand     = Math.random() * total;
  for (const x of arr) {
    rand -= x.weight;
    if (rand <= 0) return x.name;
  }
  return arr[arr.length - 1].name;
}

// ── Nature categories ─────────────────────────────────────────────────────────
const ATK_BOOSTING = new Set(['Adamant', 'Lonely', 'Brave', 'Naughty']);
const SPA_BOOSTING = new Set(['Modest', 'Mild', 'Quiet', 'Rash']);
const DEF_BOOSTING = new Set(['Bold', 'Impish', 'Relaxed', 'Lax']);
const SPD_BOOSTING = new Set(['Calm', 'Careful', 'Sassy', 'Gentle']);
const SPE_BOOSTING = new Set(['Timid', 'Jolly', 'Hasty', 'Naive']);

/**
 * Infer a plausible EV spread from a nature and item.
 * Returns { hp, atk, def, spa, spd, spe }.
 * @param {string|undefined} nature
 * @param {string|undefined} item
 * @returns {{hp:number, atk:number, def:number, spa:number, spd:number, spe:number}}
 */
function inferEVSpread(nature, item) {
  // Assault Vest override — bulky AV spread regardless of nature
  if (item === 'Assault Vest') {
    return { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 };
  }

  if (!nature) return { hp: 4, atk: 252, def: 0, spa: 0, spd: 0, spe: 252 };

  if (ATK_BOOSTING.has(nature)) return { hp: 4,   atk: 252, def: 0,   spa: 0,   spd: 0,   spe: 252 };
  if (SPA_BOOSTING.has(nature)) return { hp: 4,   atk: 0,   def: 0,   spa: 252, spd: 0,   spe: 252 };
  if (DEF_BOOSTING.has(nature)) return { hp: 252, atk: 0,   def: 252, spa: 0,   spd: 4,   spe: 0   };
  if (SPD_BOOSTING.has(nature)) return { hp: 252, atk: 0,   def: 4,   spa: 0,   spd: 252, spe: 0   };
  if (SPE_BOOSTING.has(nature)) return { hp: 4,   atk: 252, def: 0,   spa: 0,   spd: 0,   spe: 252 };

  // Neutral natures (Hardy, Docile, Serious, Bashful, Quirky)
  return { hp: 252, atk: 252, def: 4, spa: 0, spd: 0, spe: 0 };
}

module.exports = { getMetaPool, weightedChoice, inferEVSpread };
