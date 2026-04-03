'use strict';

/**
 * Manual zh/ja name overrides — always run LAST in the pipeline.
 *
 * Use this for trainer/item cards whose zh or ja names:
 *   - are missing after enrich-ptcgp-db.js + enrich-ptcgp-zh-trainer.js
 *   - were incorrectly set (e.g. machine translation)
 *
 * HOW TO ADD A FIX:
 *   1. Read the zh_TW image file (ask Claude to OCR it)
 *   2. Copy the card title text exactly as shown in the image
 *   3. Add an entry to OVERRIDES below with the uid and the correct text
 *   4. Run: node scripts/manual-name-overrides.js
 *
 * RULE: Never translate or guess. Only use text read directly from the image.
 *
 * Run: node scripts/manual-name-overrides.js
 */

const fs   = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/ptcgp_cards.json');

// ---------------------------------------------------------------------------
// OVERRIDES — add entries here
// Each entry: { uid, zh?, ja? }
// Only include fields you are sure about (read from image).
// ---------------------------------------------------------------------------
const OVERRIDES = [
  // B2b trainer cards — zh read from zh_TW images
  { uid: 'B2b-65', zh: '惡棍信' },      // en: Nasty Notice  (was: 惡意信函 — wrong)
  // { uid: 'B2b-66', zh: '維修' },      // en: Maintenance   — visually confirmed, likely correct already
  // { uid: 'B2b-69', zh: '徒行步道' },  // en: Hiking Trail  — read from zh_TW image (verify first)

  // Add more overrides here as discovered:
  // { uid: 'A3-XXX', zh: '正確名稱', ja: '正しい名前' },
];

// ---------------------------------------------------------------------------

function main() {
  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  let updated = 0;

  for (const override of OVERRIDES) {
    const card = db.cards.find(c => c.uid === override.uid);
    if (!card) {
      console.warn(`  ⚠️  Card not found: ${override.uid}`);
      continue;
    }

    let changed = false;
    if (override.zh !== undefined && card.names.zh !== override.zh) {
      console.log(`  ${override.uid}: zh "${card.names.zh}" → "${override.zh}"`);
      card.names.zh = override.zh;
      changed = true;
    }
    if (override.ja !== undefined && card.names.ja !== override.ja) {
      console.log(`  ${override.uid}: ja "${card.names.ja}" → "${override.ja}"`);
      card.names.ja = override.ja;
      changed = true;
    }
    if (changed) updated++;
  }

  db.generated = new Date().toISOString();
  fs.writeFileSync(DB_PATH, JSON.stringify(db));
  console.log(`\nUpdated ${updated} cards.`);
  console.log('✅  Saved.');
}

main();
