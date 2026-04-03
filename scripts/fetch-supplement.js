/**
 * fetch-supplement.js
 *
 * One-time script to fetch JA + ZH names for Gen 9+ abilities, moves, and items
 * that are missing from the trilingual.json base dataset.
 *
 * Run once: node scripts/fetch-supplement.js
 * Output:   data/supplement.json
 *
 * Uses PokeAPI (free, no key required).
 * JA = official Hiragana/Katakana from the game.
 * ZH = Simplified Chinese from PokeAPI (best available for Gen 9; trilingual.json
 *      covers Traditional Chinese for Gen 1–8 entries).
 */
'use strict';

const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const { Generations } = require('@smogon/calc');

// ── Helpers ───────────────────────────────────────────────────────────────────

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 10000 }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse failed for ${url}: ${e.message}`)); }
      });
    }).on('error', reject).on('timeout', () => reject(new Error(`Timeout: ${url}`)));
  });
}

/** Throttled fetch — stay polite to PokeAPI (max 1 req/100ms). */
let _lastFetch = 0;
async function politeGet(url) {
  const now  = Date.now();
  const wait = Math.max(0, _lastFetch + 100 - now);
  if (wait) await new Promise(r => setTimeout(r, wait));
  _lastFetch = Date.now();
  return get(url);
}

/**
 * Convert a @smogon/calc display name to a PokeAPI slug.
 * e.g. "Quark Drive" → "quark-drive", "Good as Gold" → "good-as-gold"
 */
function toSlug(name) {
  return name
    .toLowerCase()
    .replace(/['\u2019]/g, '')          // apostrophes
    .replace(/\s*\(.*?\)\s*/g, '')      // remove parenthetical suffixes
    .replace(/[^a-z0-9]+/g, '-')        // spaces / punctuation → hyphen
    .replace(/^-|-$/g, '');             // trim leading/trailing hyphens
}

function extractNames(data) {
  const ja = data.names?.find(n => n.language.name === 'ja')?.name   ?? null;
  const zh = data.names?.find(n => n.language.name === 'zh-hant')?.name ?? null;
  return { ja, zh };
}

// ── Figure out what's missing ─────────────────────────────────────────────────

const tri = JSON.parse(fs.readFileSync(
  path.join(__dirname, '../data/trilingual.json'), 'utf8'));

function buildTriSet(category) {
  return new Set(Object.values(tri[category]).map(e => e.en.toLowerCase()));
}

const triAbilities = buildTriSet('ability');
const triMoves     = buildTriSet('move');
const triItems     = buildTriSet('item');

const gen9 = Generations.get(9);

const missingAbilities = [...gen9.abilities]
  .filter(a => !triAbilities.has(a.name.toLowerCase()))
  .map(a => a.name);

const missingMoves = [...gen9.moves]
  .filter(m => m.category !== 'Status' && !triMoves.has(m.name.toLowerCase()))
  .map(m => m.name);

const missingItems = [...gen9.items]
  .filter(i => !triItems.has(i.name.toLowerCase()))
  .map(i => i.name);

console.log(`Missing: ${missingAbilities.length} abilities, ` +
            `${missingMoves.length} moves, ${missingItems.length} items`);

// ── Fetch from PokeAPI ────────────────────────────────────────────────────────

async function fetchCategory(names, endpoint) {
  const results = {};
  let ok = 0, skip = 0;

  for (const name of names) {
    const slug = toSlug(name);
    const url  = `https://pokeapi.co/api/v2/${endpoint}/${slug}`;
    try {
      const data   = await politeGet(url);
      const { ja, zh } = extractNames(data);
      if (ja || zh) {
        results[name.toLowerCase()] = {
          en: name,
          ja: ja ?? name,
          zh: zh ?? ja ?? name,   // ZH fallback: JA → EN
        };
        ok++;
        if (ok % 10 === 0) process.stdout.write(`  ${ok} fetched...\r`);
      }
    } catch {
      skip++;  // PokeAPI doesn't have this slug — leave as English
    }
  }
  console.log(`  ${ok} fetched, ${skip} skipped (no PokeAPI entry)`);
  return results;
}

async function main() {
  const supplement = { ability: {}, move: {}, item: {} };

  console.log('Fetching abilities...');
  supplement.ability = await fetchCategory(missingAbilities, 'ability');

  console.log('Fetching damage moves...');
  supplement.move = await fetchCategory(missingMoves, 'move');

  console.log('Fetching items...');
  supplement.item = await fetchCategory(missingItems, 'item');

  const outPath = path.join(__dirname, '../data/supplement.json');
  fs.writeFileSync(outPath, JSON.stringify(supplement, null, 2), 'utf8');

  const total = Object.values(supplement).reduce((s, c) => s + Object.keys(c).length, 0);
  console.log(`\n✅  Saved ${total} entries to data/supplement.json`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
