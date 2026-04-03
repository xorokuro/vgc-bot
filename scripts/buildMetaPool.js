'use strict';

/**
 * scripts/buildMetaPool.js
 *
 * Reads all season doubles.json files from the provided source data directory,
 * translates Chinese names to English using trilingual.json, validates against
 * @smogon/calc Gen 9 data, aggregates usage across seasons, and writes
 * data/metaPool.json to the bot directory.
 *
 * Usage: node scripts/buildMetaPool.js <path-to-data-dir>
 */

const fs   = require('fs');
const path = require('path');
const { Generations, toID } = require('@smogon/calc');

// ── CLI arg ───────────────────────────────────────────────────────────────────
const dataDir = process.argv[2];
if (!dataDir) {
  console.error('Usage: node scripts/buildMetaPool.js <path-to-data-dir>');
  process.exit(1);
}

// ── Load Gen 9 data for validation ───────────────────────────────────────────
const gen9 = Generations.get(9);

const GEN9_SPECIES   = new Set([...gen9.species].map(s => toID(s.name)));
const GEN9_MOVES     = new Map([...gen9.moves].map(m => [toID(m.name), m]));
const GEN9_ABILITIES = new Set([...gen9.abilities].map(a => toID(a.name)));
const GEN9_ITEMS     = new Set([...gen9.items].map(i => toID(i.name)));

const NATURES = new Set([
  'Hardy','Lonely','Brave','Adamant','Naughty','Bold','Docile','Relaxed',
  'Impish','Lax','Timid','Hasty','Serious','Jolly','Naive','Modest',
  'Mild','Quiet','Bashful','Rash','Calm','Gentle','Sassy','Careful','Quirky',
]);

// ── Tera type zh → en map ─────────────────────────────────────────────────────
const ZH_TYPE_EN = {
  '蟲': 'Bug', '水': 'Water', '幽靈': 'Ghost', '草': 'Grass', '火': 'Fire',
  '妖精': 'Fairy', '飛行': 'Flying', '龍': 'Dragon', '毒': 'Poison', '惡': 'Dark',
  '一般': 'Normal', '地面': 'Ground', '格鬥': 'Fighting', '星晶': 'Stellar',
  '超能力': 'Psychic', '電': 'Electric', '鋼': 'Steel', '冰': 'Ice', '岩石': 'Rock',
};

// ── Form overrides (pid_form → Smogon name) ───────────────────────────────────
const FORM_OVERRIDE = {
  '26_1': 'Raichu-Alola',
  '38_1': 'Ninetales-Alola',
  '59_1': 'Arcanine-Hisui',
  '76_1': 'Golem-Alola',
  '89_1': 'Muk-Alola',
  '101_1': 'Electrode-Hisui',
  '110_1': 'Weezing-Galar',
  '128_2': 'Tauros-Paldea-Combat',
  '128_3': 'Tauros-Paldea-Blaze',
  '144_1': 'Articuno-Galar',
  '145_1': 'Zapdos-Galar',
  '146_1': 'Moltres-Galar',
  '157_1': 'Typhlosion-Hisui',
  '199_1': 'Slowking-Galar',
  '386_1': 'Deoxys-Attack', '386_2': 'Deoxys-Defense', '386_3': 'Deoxys-Speed',
  '479_1': 'Rotom-Heat', '479_2': 'Rotom-Wash', '479_3': 'Rotom-Frost', '479_4': 'Rotom-Fan', '479_5': 'Rotom-Mow',
  '483_1': 'Dialga-Origin',
  '484_1': 'Palkia-Origin',
  '487_1': 'Giratina-Origin',
  '492_1': 'Shaymin-Sky',
  '493_1': 'Arceus-Fighting', '493_2': 'Arceus-Flying', '493_3': 'Arceus-Poison',
  '493_4': 'Arceus-Ground', '493_5': 'Arceus-Rock', '493_6': 'Arceus-Bug',
  '493_7': 'Arceus-Ghost', '493_8': 'Arceus-Steel', '493_9': 'Arceus-Fire',
  '493_10': 'Arceus-Water', '493_11': 'Arceus-Grass', '493_12': 'Arceus-Electric',
  '493_13': 'Arceus-Psychic', '493_14': 'Arceus-Ice', '493_15': 'Arceus-Dragon',
  '493_16': 'Arceus-Dark', '493_17': 'Arceus-Fairy',
  '503_1': 'Samurott-Hisui',
  '549_1': 'Lilligant-Hisui',
  '571_1': 'Zoroark-Hisui',
  '628_1': 'Braviary-Hisui',
  '641_1': 'Tornadus-Therian',
  '642_1': 'Thundurus-Therian',
  '645_1': 'Landorus-Therian',
  '646_1': 'Kyurem-White', '646_2': 'Kyurem-Black',
  '706_1': 'Goodra-Hisui',
  '720_1': 'Hoopa-Unbound',
  '724_1': 'Decidueye-Hisui',
  '741_1': 'Oricorio-Pom-Pom', '741_3': 'Oricorio-Sensu',
  '745_1': 'Lycanroc-Midnight', '745_2': 'Lycanroc-Dusk',
  '800_1': 'Necrozma-Dusk-Mane', '800_2': 'Necrozma-Dawn-Wings',
  '849_1': 'Toxtricity-Low-Key',
  '876_1': 'Indeedee-F',
  '892_1': 'Urshifu-Rapid-Strike',
  '898_1': 'Calyrex-Shadow', '898_2': 'Calyrex-Ice',
  '901_1': 'Ursaluna-Bloodmoon',
  '902_1': 'Basculegion-F',
  '905_1': 'Enamorus-Therian',
  '978_1': 'Dudunsparce-Three-Segment', '978_2': 'Dudunsparce-Three-Segment',
};

// ── Load trilingual.json ──────────────────────────────────────────────────────
const trilingualPath = path.join(dataDir, 'trilingual.json');
if (!fs.existsSync(trilingualPath)) {
  console.error(`trilingual.json not found at: ${trilingualPath}`);
  process.exit(1);
}
const trilingual = JSON.parse(fs.readFileSync(trilingualPath, 'utf8'));

// Build zh → en maps (trilingual is indexed by numeric ID, with zh and en fields)
/** @type {Map<string, string>} zh → en */
function buildZhEnMap(section) {
  const map = new Map();
  for (const entry of Object.values(section)) {
    if (entry.zh && entry.en) map.set(entry.zh, entry.en);
  }
  return map;
}

const ZH_POKEMON  = buildZhEnMap(trilingual.pokemon);
const ZH_MOVE     = buildZhEnMap(trilingual.move);
const ZH_ITEM     = buildZhEnMap(trilingual.item);
const ZH_ABILITY  = buildZhEnMap(trilingual.ability);
const ZH_NATURE   = buildZhEnMap(trilingual.nature);

// Also build pid → en for form=0 base species lookup
/** @type {Map<number, string>} pid → en name */
const PID_EN = new Map();
for (const [id, entry] of Object.entries(trilingual.pokemon)) {
  if (entry.en) PID_EN.set(parseInt(id, 10), entry.en);
}

// ── Resolve Smogon species name from a HOME entry ─────────────────────────────
function resolveSmogonName(entry) {
  const key = `${entry.pid}_${entry.form}`;

  // Non-zero forms: check FORM_OVERRIDE first
  if (entry.form !== 0) {
    if (FORM_OVERRIDE[key]) return FORM_OVERRIDE[key];
    // Unmapped non-zero form — skip
    return null;
  }

  // Form 0: use trilingual pid lookup
  const fromPid = PID_EN.get(entry.pid);
  if (fromPid) return fromPid;

  // Fallback: try zh name translation
  const fromZh = ZH_POKEMON.get(entry.full_name);
  return fromZh || null;
}

// ── Validate a Smogon species name exists in gen9 ────────────────────────────
function validateSpecies(name) {
  return GEN9_SPECIES.has(toID(name));
}

// ── Aggregation map: name → { score, moves, abilities, items, natures, teraTypes } ──
// Each sub-map is { zhName → weightedUsage }
/** @type {Map<string, { score: number, moves: Map<string, number>, abilities: Map<string, number>, items: Map<string, number>, natures: Map<string, number>, teraTypes: Map<string, number> }>} */
const pool = new Map();

let seasonsProcessed = 0;
let entriesProcessed = 0;
let entriesSkipped   = 0;

// ── Discover season folders ───────────────────────────────────────────────────
const seasonDirs = fs.readdirSync(dataDir)
  .filter(d => /^season_\d+$/.test(d))
  .sort((a, b) => {
    const na = parseInt(a.replace('season_', ''), 10);
    const nb = parseInt(b.replace('season_', ''), 10);
    return na - nb;
  });

console.log(`Found ${seasonDirs.length} season folders in: ${dataDir}`);

// ── Process each season ───────────────────────────────────────────────────────
for (const seasonDir of seasonDirs) {
  const doublesPath = path.join(dataDir, seasonDir, 'doubles.json');
  if (!fs.existsSync(doublesPath)) continue;

  let seasonData;
  try {
    seasonData = JSON.parse(fs.readFileSync(doublesPath, 'utf8'));
  } catch (err) {
    console.warn(`  [WARN] Failed to parse ${doublesPath}: ${err.message}`);
    continue;
  }

  seasonsProcessed++;

  for (const entry of Object.values(seasonData)) {
    const smogonName = resolveSmogonName(entry);
    if (!smogonName) {
      entriesSkipped++;
      continue;
    }
    if (!validateSpecies(smogonName)) {
      entriesSkipped++;
      continue;
    }

    const score = Math.max(0, 151 - entry.rank);
    if (score === 0) continue;

    entriesProcessed++;

    if (!pool.has(smogonName)) {
      pool.set(smogonName, {
        score:     0,
        moves:     new Map(),
        abilities: new Map(),
        items:     new Map(),
        natures:   new Map(),
        teraTypes: new Map(),
      });
    }

    const acc = pool.get(smogonName);
    acc.score += score;

    // Accumulate moves
    for (const m of (entry.moves || [])) {
      const enName = ZH_MOVE.get(m.name);
      if (!enName) continue;
      const moveData = GEN9_MOVES.get(toID(enName));
      if (!moveData || moveData.category === 'Status' || moveData.isZ || moveData.isMax) continue;
      const w = parseFloat(m.usage_percent) || 0;
      acc.moves.set(enName, (acc.moves.get(enName) || 0) + score * w);
    }

    // Accumulate abilities
    for (const a of (entry.abilities || [])) {
      const enName = ZH_ABILITY.get(a.name);
      if (!enName) continue;
      if (!GEN9_ABILITIES.has(toID(enName))) continue;
      const w = parseFloat(a.usage_percent) || 0;
      acc.abilities.set(enName, (acc.abilities.get(enName) || 0) + score * w);
    }

    // Accumulate items
    for (const it of (entry.held_items || [])) {
      const enName = ZH_ITEM.get(it.name);
      if (!enName) continue;
      if (!GEN9_ITEMS.has(toID(enName))) continue;
      const w = parseFloat(it.usage_percent) || 0;
      acc.items.set(enName, (acc.items.get(enName) || 0) + score * w);
    }

    // Accumulate natures
    for (const n of (entry.natures || [])) {
      const enName = ZH_NATURE.get(n.name);
      if (!enName) continue;
      if (!NATURES.has(enName)) continue;
      const w = parseFloat(n.usage_percent) || 0;
      acc.natures.set(enName, (acc.natures.get(enName) || 0) + score * w);
    }

    // Accumulate tera types
    for (const t of (entry.tera_types || [])) {
      const enName = ZH_TYPE_EN[t.name];
      if (!enName) continue;
      const w = parseFloat(t.usage_percent) || 0;
      acc.teraTypes.set(enName, (acc.teraTypes.get(enName) || 0) + score * w);
    }
  }
}

console.log(`Processed ${seasonsProcessed} seasons, ${entriesProcessed} entries, ${entriesSkipped} skipped`);

// ── Sort pool by score, keep top 80 ──────────────────────────────────────────
function topN(map, n) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name]) => name);
}

const sorted = [...pool.entries()]
  .sort((a, b) => b[1].score - a[1].score)
  .slice(0, 80);

const metaPool = sorted.map(([name, acc]) => {
  const allMovesSorted  = topN(acc.moves, 8);
  const damageMovesSorted = allMovesSorted; // already filtered to damage-only above
  return {
    name,
    score:       acc.score,
    damageMoves: damageMovesSorted.slice(0, 4),
    allMoves:    allMovesSorted,
    abilities:   topN(acc.abilities, 4),
    items:       topN(acc.items, 4),
    natures:     topN(acc.natures, 4),
    teraTypes:   topN(acc.teraTypes, 4),
  };
});

// ── Write output ──────────────────────────────────────────────────────────────
const outPath = path.join(__dirname, '..', 'data', 'metaPool.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(metaPool, null, 2), 'utf8');

console.log(`\nWrote ${metaPool.length} Pokémon to ${outPath}`);
console.log('\nTop 10:');
for (const p of metaPool.slice(0, 10)) {
  console.log(`  #${metaPool.indexOf(p) + 1} ${p.name.padEnd(22)} score=${p.score}  moves=${p.damageMoves.join(', ')}`);
}
