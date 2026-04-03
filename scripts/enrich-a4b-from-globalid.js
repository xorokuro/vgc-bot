'use strict';

/**
 * Enrich A4b card names by matching (type+globalId) from local image filenames.
 *
 * A4b is a reprint set — every card uses the same file-type prefix (PK_10_, PK_20_,
 * TR_10_, TR_20_) and 6-digit global ID as the original set card.
 * We match EXACTLY on (prefix, globalId) to avoid conflating different card types.
 *
 * Run: node scripts/enrich-a4b-from-globalid.js
 */

const fs   = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/ptcgp_cards.json');

/**
 * Parse image path → { key: 'PK_10:XXXXXX', globalId: 'XXXXXX' }
 * Keeps the full prefix so PK_10_ and PK_20_ are separate namespaces.
 */
function parseFile(imgPath) {
  const filename = path.basename(imgPath ?? '');
  // Matches both old-format (PK_10_) and new-format (cPK_10_)
  const m = filename.match(/^c?(PK|TR)_(\d+)_(\d{6})/);
  if (!m) return null;
  return { key: `${m[1]}_${m[2]}:${m[3]}`, globalId: m[3] };
}

async function main() {
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  const db  = JSON.parse(raw);

  // Build (type+globalId) → names map from all non-A4b cards with at least one name
  const byKey = new Map();
  for (const card of db.cards) {
    if (card.set === 'A4b') continue;
    const imgPath = card.images?.zh_TW ?? card.images?.en_US ?? Object.values(card.images ?? {})[0];
    if (!imgPath) continue;
    const parsed = parseFile(imgPath);
    if (!parsed) continue;
    if (!byKey.has(parsed.key)) {
      byKey.set(parsed.key, { zh: card.names.zh, ja: card.names.ja, en: card.names.en });
    } else {
      const existing = byKey.get(parsed.key);
      if (!existing.zh && card.names.zh) existing.zh = card.names.zh;
      if (!existing.ja && card.names.ja) existing.ja = card.names.ja;
      if (!existing.en && card.names.en) existing.en = card.names.en;
    }
  }
  console.log(`Built type+globalId map with ${byKey.size} entries`);

  // Update A4b cards
  const a4bCards = db.cards.filter(c => c.set === 'A4b');
  let updated = 0, missing = 0;

  for (const card of a4bCards) {
    const imgPath = card.images?.zh_TW ?? card.images?.en_US ?? Object.values(card.images ?? {})[0];
    const parsed = parseFile(imgPath);
    if (!parsed) { missing++; continue; }

    const names = byKey.get(parsed.key);
    if (!names) {
      missing++;
      continue;
    }

    let changed = false;
    // For zh/en: only fill missing (wiki data is trustworthy for these)
    if (names.zh && !card.names.zh) { card.names.zh = names.zh; changed = true; }
    if (names.en && !card.names.en) { card.names.en = names.en; changed = true; }
    // For ja: always sync from original set (wiki extraction for A4b ex cards is unreliable)
    const correctJa = names.ja || '';
    if (card.names.ja !== correctJa) { card.names.ja = correctJa; changed = true; }
    if (changed) updated++;
  }

  console.log(`\nA4b: ${a4bCards.length} cards total`);
  console.log(`  Updated: ${updated}`);
  console.log(`  No match: ${missing}`);

  const stillBlank = a4bCards.filter(c => !c.names.zh && !c.names.en);
  if (stillBlank.length) {
    console.log(`\nStill no names (${stillBlank.length} cards):`);
    for (const c of stillBlank.slice(0, 10)) {
      const imgPath = c.images?.zh_TW ?? Object.values(c.images ?? {})[0];
      const p = parseFile(imgPath);
      console.log(`  #${c.num} key=${p?.key} img=${path.basename(imgPath ?? '')}`);
    }
  }

  db.generated = new Date().toISOString();
  fs.writeFileSync(DB_PATH, JSON.stringify(db));
  console.log('\n✅  Saved.');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
