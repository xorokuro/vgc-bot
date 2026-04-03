'use strict';

/**
 * Enrich the PTCGP card database with:
 *  1. zh (Traditional Chinese) and ja (Japanese) names from trilingual.json
 *  2. Rarity symbols from the tcgdex rarity string (fetched per set in bulk)
 *
 * Reads:  data/ptcgp_cards.json  (built by build-ptcgp-db.js)
 * Writes: data/ptcgp_cards.json  (in-place enrichment)
 *
 * Run: node scripts/enrich-ptcgp-db.js
 */

const fs   = require('fs');
const path = require('path');

const DB_PATH  = path.join(__dirname, '../data/ptcgp_cards.json');
const TRI_PATH = path.join(__dirname, '../data/trilingual.json');

// ── Rarity normalization ───────────────────────────────────────────────────────

const RARITY_MAP = {
  'One Diamond':    '◇',
  'Two Diamond':    '◇◇',
  'Three Diamond':  '◇◇◇',
  'Four Diamond':   '◇◇◇◇',
  'One Star':       '☆',
  'Two Star':       '☆☆',
  'Three Star':     '☆☆☆',
  'Crown':          '♛',
  'Promo':          '✦',
  // Already-normalized codes (from new-format filenames)
  'C':  '◇',
  'U':  '◇◇',
  'R':  '◇◇◇',
  'RR': '◇◇◇◇',
  'AR': '☆',
  'SR': '☆☆',
  'SAR':'☆☆',
  'IM': '♛',
  'PR': '✦',
};

function normalizeRarity(raw) {
  if (!raw) return '';
  return RARITY_MAP[raw] ?? raw;
}

// ── Name suffix stripping ─────────────────────────────────────────────────────

// PTCGP appends " ex", " EX", " V", " VMAX", " VSTAR", " GX", " &" to card names
const STRIP_RE = /\s+(ex|EX|V|VMAX|VSTAR|GX|GMAX|mega|Mega|&\s+.+)$/i;

function baseName(name) {
  return name.replace(STRIP_RE, '').trim();
}

// ── Build lookup from trilingual.json ─────────────────────────────────────────

function buildTrilingualLookup(triPath) {
  const raw  = fs.readFileSync(triPath, 'utf8');
  const data = JSON.parse(raw);
  const pokemons = data.pokemon ?? {};

  // en → { zh, ja }  (case-insensitive key)
  const lookup = new Map();
  for (const entry of Object.values(pokemons)) {
    const en = (entry.en ?? '').trim();
    if (!en) continue;
    const key = en.toLowerCase();
    lookup.set(key, { zh: entry.zh ?? '', ja: entry.ja ?? '' });
  }
  return lookup;
}

// ── Rarity fetching from tcgdex ────────────────────────────────────────────────

const DELAY_MS = 300;
const sleep    = ms => new Promise(r => setTimeout(r, ms));

// Get all unique set IDs that need rarity from tcgdex (cards without rarity in filename)
async function fetchRaritiesForSet(setId) {
  try {
    // tcgdex set endpoint doesn't have rarity; we need to do a card-by-card approach
    // Use the series/cards endpoint if available, otherwise skip
    const url = `https://api.tcgdex.net/v2/en/sets/${setId}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const data = await res.json();

    // Build localId → rarity map by fetching in parallel batches of 10
    const cards   = data.cards ?? [];
    const rarMap  = new Map();
    const BATCH   = 10;

    for (let i = 0; i < cards.length; i += BATCH) {
      const batch = cards.slice(i, i + BATCH);
      await Promise.all(batch.map(async card => {
        try {
          const cr  = await fetch(`https://api.tcgdex.net/v2/en/cards/${card.id}`, { signal: AbortSignal.timeout(8_000) });
          if (!cr.ok) return;
          const cd  = await cr.json();
          rarMap.set(String(parseInt(card.localId, 10)), normalizeRarity(cd.rarity ?? ''));
        } catch { /* skip */ }
      }));
      await sleep(DELAY_MS);
      process.stdout.write(`  Rarity: ${Math.min(i + BATCH, cards.length)}/${cards.length}\r`);
    }
    return rarMap;
  } catch {
    return null;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Load database
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  const db  = JSON.parse(raw);
  console.log(`Loaded ${db.total} cards from database`);

  // Build trilingual lookup
  const lookup = buildTrilingualLookup(TRI_PATH);
  console.log(`Loaded ${lookup.size} Pokémon names from trilingual.json`);

  // Enrich names
  let nameHits = 0;
  for (const card of db.cards) {
    const en = card.names.en ?? '';
    if (!en) continue;

    // Try exact match first, then base name (strip ex/V/etc.)
    const candidates = [en.toLowerCase(), baseName(en).toLowerCase()];
    let found = null;
    for (const key of candidates) {
      if (lookup.has(key)) { found = lookup.get(key); break; }
    }
    if (found) {
      card.names.zh = found.zh;
      card.names.ja = found.ja;
      nameHits++;
    }
  }
  console.log(`Enriched ${nameHits} cards with zh/ja names`);

  // Fetch rarities per set (only sets that have empty rarities)
  const setsNeedingRarity = [...new Set(
    db.cards.filter(c => !c.rarity).map(c => c.set)
  )];

  if (setsNeedingRarity.length > 0) {
    console.log(`\nFetching rarities for ${setsNeedingRarity.length} sets…`);

    for (const setId of setsNeedingRarity) {
      process.stdout.write(`\n📦 ${setId}… `);
      const rarMap = await fetchRaritiesForSet(setId);

      if (!rarMap) {
        console.log(`skipped (API unavailable)`);
        continue;
      }

      const setCards = db.cards.filter(c => c.set === setId);
      let assigned = 0;
      for (const card of setCards) {
        const posKey = String(card.num);
        const r = rarMap.get(posKey);
        if (r) { card.rarity = r; assigned++; }
      }
      console.log(`assigned ${assigned}/${setCards.length} rarities`);
    }
  }

  // Save back
  db.generated = new Date().toISOString();
  fs.writeFileSync(DB_PATH, JSON.stringify(db));
  console.log(`\n✅  Saved enriched database to ${DB_PATH}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
