'use strict';

/**
 * For old-format sets: copy names from PK_10_/TR_10_ cards to their
 * same-set, same-global-ID PK_20_/TR_20_ counterparts — but ONLY when:
 *   1. The target has NO names at all (prevents overwriting correct data)
 *   2. The source has names
 *   3. They are in the same set
 *
 * This handles B2b/B2a special art cards that share a global ID with their
 * base-version Pokémon in the same set.
 *
 * Run: node scripts/enrich-sameset-specialart.js
 */

const fs   = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/ptcgp_cards.json');

function parseFile(imgPath) {
  const f = path.basename(imgPath ?? '');
  const m = f.match(/^(PK|TR)_(\d+)_(\d{6})/); // old-format only
  if (!m) return null;
  return { type: m[1], series: m[2], globalId: m[3] };
}

async function main() {
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  const db  = JSON.parse(raw);

  let updated = 0;
  const stats = {};

  // Group cards by set
  const bySet = new Map();
  for (const card of db.cards) {
    if (!bySet.has(card.set)) bySet.set(card.set, []);
    bySet.get(card.set).push(card);
  }

  for (const [setId, cards] of bySet) {
    // Build per-set lookup: (type, globalId) → card (for _10_ series only)
    const base = new Map(); // 'PK:XXXXXX' or 'TR:XXXXXX' → card from _10_ series
    for (const card of cards) {
      const p = parseFile(card.images?.zh_TW);
      if (!p || p.series !== '10') continue;
      if (!card.names.zh && !card.names.en) continue; // source must have names
      base.set(`${p.type}:${p.globalId}`, card);
    }

    // Find _20_ cards in same set with NO names
    for (const card of cards) {
      if (card.names.zh || card.names.en || card.names.ja) continue; // skip if already has any name
      const p = parseFile(card.images?.zh_TW);
      if (!p || p.series !== '20') continue;
      const source = base.get(`${p.type}:${p.globalId}`);
      if (!source) continue;

      card.names.zh = source.names.zh || '';
      card.names.ja = source.names.ja || '';
      card.names.en = source.names.en || '';
      updated++;
      if (!stats[setId]) stats[setId] = 0;
      stats[setId]++;
    }
  }

  console.log(`Updated ${updated} special art cards:`);
  for (const [set, count] of Object.entries(stats)) {
    console.log(`  ${set}: +${count}`);
  }

  // Report remaining no-name cards
  const blank = {};
  for (const card of db.cards) {
    if (!card.names.zh && !card.names.en) {
      if (!blank[card.set]) blank[card.set] = 0;
      blank[card.set]++;
    }
  }
  if (Object.keys(blank).length) {
    console.log('\nStill missing names:');
    for (const [set, count] of Object.entries(blank)) {
      console.log(`  ${set}: ${count}`);
    }
  }

  db.generated = new Date().toISOString();
  fs.writeFileSync(DB_PATH, JSON.stringify(db));
  console.log('\n✅  Saved.');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
