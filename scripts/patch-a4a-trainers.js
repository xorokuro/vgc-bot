'use strict';

/**
 * Fix A4a (Secluded Springs) trainer card zh/ja names and
 * three PK_20_ illustration rares that were given wrong English names.
 *
 * Issues found by reading card images:
 *
 * Trainer cards (TR_10_) — missing or wrong zh/ja:
 *   #68  Memory Light  (TR_10_000830) — zh/ja were empty
 *   #71  Morty         (TR_10_000860) — zh/ja were wrong (had Mantyke names)
 *
 * PK_20_ illustration rares — wrong English names:
 *   #83  en was "Whitney"          → actually Paldean Wooper   (PK_20_005620)
 *   #84  en was "Traveling Merchant" → actually Paldean Clodsire ex (PK_20_005630_02)
 *   #85  en was "Morty"            → actually Pyukumuku        (PK_20_006350_01)
 *        (zh/ja for #85 were already correct for Pyukumuku)
 *
 * A4b Professor's Research (#376):
 *   en was empty, ja was wrongly set to フシギバナ (Venusaur)
 *   Image: TR_20_000040 → confirmed "Professor's Research"
 *
 * Run: node scripts/patch-a4a-trainers.js
 * Then: node scripts/enrich-ptcgp-db.js
 *        node scripts/enrich-ptcgp-zh-trainer.js
 *        node scripts/enrich-sameset-specialart.js
 */

const fs   = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/ptcgp_cards.json');

// uid → { en, zh, ja }
const FIXES = {
  // A4a trainer cards
  'A4a-68': { en: 'Memory Light',        zh: '記憶燈光',       ja: 'メモリーライト'    },
  'A4a-71': { en: 'Morty',               zh: '松葉',           ja: 'マツバ'           },

  // A4a PK_20_ illustration rares — wrong en names corrected
  // zh/ja sourced from existing correct entries in same DB (A4a-100, B2a-64 for Paldean Wooper)
  'A4a-83': { en: 'Paldean Wooper',      zh: '帕底亞 烏波',    ja: 'パルデア ウパー'  },
  'A4a-84': { en: 'Paldean Clodsire ex', zh: '帕底亞 土王ex',  ja: 'パルデア ドオーex' },
  'A4a-85': { en: 'Pyukumuku',           zh: '拳海參',         ja: 'ナマコブシ'       },

  // A4b Professor's Research full art
  'A4b-376': { en: "Professor's Research", zh: '博士的研究',   ja: '博士の研究'       },
};

async function main() {
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  const db  = JSON.parse(raw);

  let updated = 0;
  for (const card of db.cards) {
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

  console.log(`\nUpdated ${updated} cards.`);
  db.generated = new Date().toISOString();
  fs.writeFileSync(DB_PATH, JSON.stringify(db));
  console.log('✅  Saved.');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
