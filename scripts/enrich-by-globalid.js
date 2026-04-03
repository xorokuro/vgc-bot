'use strict';

/**
 * Enrich cards with missing names by matching global IDs across the database.
 *
 * Rules:
 *   PK_20_XXXXXX  → same Pokémon as PK_10_XXXXXX  (same name)
 *   TR_20_XXXXXX  → same trainer as TR_10_XXXXXX   (same name)
 *   TR_10_XXXXXX_01/02 → alternate art of TR_10_XXXXXX_00 (same name)
 *
 * Builds a (family, globalId) → names lookup from all cards that already
 * have names, then fills blanks.
 *
 * Run: node scripts/enrich-by-globalid.js
 */

const fs   = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/ptcgp_cards.json');

/** Parse filename into { family:'PK'|'TR', globalId:'XXXXXX' } */
function parseFile(imgPath) {
  const f = path.basename(imgPath ?? '');
  const m = f.match(/^(?:c?)?(PK|TR)_\d+_(\d{6})/);
  if (!m) return null;
  return { family: m[1], globalId: m[2] };
}

async function main() {
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  const db  = JSON.parse(raw);

  // Build lookup: `PK:XXXXXX` or `TR:XXXXXX` → merged names
  const byFamilyGid = new Map();

  for (const card of db.cards) {
    if (!card.names.zh && !card.names.ja && !card.names.en) continue;
    const parsed = parseFile(card.images?.zh_TW);
    if (!parsed) continue;
    const key = `${parsed.family}:${parsed.globalId}`;
    if (!byFamilyGid.has(key)) {
      byFamilyGid.set(key, { zh: '', ja: '', en: '' });
    }
    const entry = byFamilyGid.get(key);
    if (!entry.zh && card.names.zh) entry.zh = card.names.zh;
    if (!entry.ja && card.names.ja) entry.ja = card.names.ja;
    if (!entry.en && card.names.en) entry.en = card.names.en;
  }

  console.log(`Built family+globalId map: ${byFamilyGid.size} entries`);

  let updated = 0;
  const stats = {};

  for (const card of db.cards) {
    if (card.names.zh && card.names.ja && card.names.en) continue;
    const parsed = parseFile(card.images?.zh_TW);
    if (!parsed) continue;
    const key = `${parsed.family}:${parsed.globalId}`;
    const source = byFamilyGid.get(key);
    if (!source) continue;

    let changed = false;
    if (!card.names.zh && source.zh) { card.names.zh = source.zh; changed = true; }
    if (!card.names.ja && source.ja) { card.names.ja = source.ja; changed = true; }
    if (!card.names.en && source.en) { card.names.en = source.en; changed = true; }
    if (changed) {
      updated++;
      if (!stats[card.set]) stats[card.set] = 0;
      stats[card.set]++;
    }
  }

  console.log(`\nUpdated ${updated} cards:`);
  for (const [set, count] of Object.entries(stats)) {
    console.log(`  ${set}: +${count}`);
  }

  // Report remaining blanks per set
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
