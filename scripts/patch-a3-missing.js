'use strict';

/**
 * Fix A3 (Triumphant Light) missing card names at positions 246-250.
 *
 * Root cause: Five PK_90_ special-art cards had no names assigned.
 * Names confirmed by reading en_US card images:
 *   #246 PK_90_007230 → Alolan Grimer
 *   #247 PK_90_007240 → Toucannon
 *   #248 PK_90_010810 → Rayquaza
 *   #249 PK_90_010820_00 → Rayquaza ex
 *   #250 PK_90_010820_01 → Rayquaza ex (full art)
 *
 * No ordering fix needed — PK_10_ gids 005820-007220 are perfectly sequential.
 *
 * Run: node scripts/patch-a3-missing.js
 * Then re-run: node scripts/enrich-ptcgp-db.js
 *              node scripts/enrich-ptcgp-zh-trainer.js
 */

const fs   = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/ptcgp_cards.json');

// uid → { en, zh, ja } from image OCR + DB cross-reference
const FIXES = {
  'A3-246': { en: 'Alolan Grimer',  zh: '阿羅拉 臭泥',        ja: 'アローラ ベトベター' },
  'A3-247': { en: 'Toucannon',      zh: '銃嘴大鳥',           ja: 'ドデカバシ'          },
  'A3-248': { en: 'Rayquaza',       zh: '烈空坐',             ja: 'レックウザ'          },
  'A3-249': { en: 'Rayquaza ex',    zh: '烈空坐',             ja: 'レックウザ'          },
  'A3-250': { en: 'Rayquaza ex',    zh: '烈空坐',             ja: 'レックウザ'          },
};

async function main() {
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  const db  = JSON.parse(raw);

  let updated = 0;
  for (const card of db.cards) {
    if (card.set !== 'A3') continue;
    const fix = FIXES[card.uid];
    if (!fix) continue;

    let changed = false;
    if (card.names.en !== fix.en) { card.names.en = fix.en; changed = true; }
    if (card.names.zh !== fix.zh) { card.names.zh = fix.zh; changed = true; }
    if (card.names.ja !== fix.ja) { card.names.ja = fix.ja; changed = true; }

    if (changed) {
      console.log(`  Fixed ${card.uid}: "${fix.en}"`);
      updated++;
    }
  }

  console.log(`\nUpdated ${updated} A3 cards.`);
  db.generated = new Date().toISOString();
  fs.writeFileSync(DB_PATH, JSON.stringify(db));
  console.log('✅  Saved.');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
