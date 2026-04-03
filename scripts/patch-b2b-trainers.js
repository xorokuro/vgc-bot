'use strict';

/**
 * Patch B2b trainer cards that have no names (old-format filenames, no name codes).
 * Card data sourced from Bulbapedia + Serebii.
 *
 * Run: node scripts/patch-b2b-trainers.js
 * Then re-run: node scripts/enrich-ptcgp-zh-trainer.js (fills zh for Iris/Calem from wiki)
 *              node scripts/enrich-sameset-specialart.js (propagates to #116-117 SR arts)
 */

const fs   = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/ptcgp_cards.json');

// Known B2b trainer cards indexed by their zh_TW image filename
const PATCHES = {
  'TR_10_001230_00.png': { en: 'Nasty Notice',  ja: 'いじわるレター', zh: '' },
  'TR_10_001240_00.png': { en: 'Maintenance',   ja: 'メンテナンス',   zh: '' },
  'TR_10_001250_00.png': { en: 'Iris',           ja: 'アイリス',       zh: '艾莉絲' },
  'TR_10_001260_00.png': { en: 'Calem',          ja: 'カルム',         zh: '卡魯穆' },
  'TR_10_001270_00.png': { en: 'Hiking Trail',   ja: 'ハイキングコース', zh: '' },
};

async function main() {
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  const db  = JSON.parse(raw);

  let updated = 0;
  for (const card of db.cards) {
    if (card.set !== 'B2b') continue;
    const file = path.basename(card.images?.zh_TW ?? '');
    const patch = PATCHES[file];
    if (!patch) continue;

    let changed = false;
    if (card.names.en !== patch.en) { card.names.en = patch.en; changed = true; }
    if (patch.ja && card.names.ja !== patch.ja) { card.names.ja = patch.ja; changed = true; }
    if (patch.zh && card.names.zh !== patch.zh) { card.names.zh = patch.zh; changed = true; }
    if (changed) {
      updated++;
      console.log(`  #${card.num}: ${patch.en}`);
    }
  }

  console.log(`\nPatched ${updated} B2b trainer cards.`);
  db.generated = new Date().toISOString();
  fs.writeFileSync(DB_PATH, JSON.stringify(db));
  console.log('✅  Saved. Now re-run:');
  console.log('  node scripts/enrich-ptcgp-zh-trainer.js');
  console.log('  node scripts/enrich-sameset-specialart.js');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
