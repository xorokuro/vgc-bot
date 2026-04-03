'use strict';

/**
 * Fix B2b (Mega Shine) Mega ex and Paldean Tauros zh/ja names.
 *
 * After patch-b2b-pk10.js corrected English names and card numbers, the
 * zh/ja for the 5 Mega ex cards and Paldean Tauros were wrong because
 * trilingual.json does not have Mega-form entries.
 *
 * zh sources: higher-numbered B2b cards (illustration rares / special arts)
 *             already had correct zh from the wiki scraper.
 * ja sources: Japanese game names for Mega evolutions (standard PTCGP format).
 *
 * Run: node scripts/patch-b2b-mega-names.js
 */

const fs   = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/ptcgp_cards.json');

// uid → { en, zh, ja }
const FIXES = {
  // PK_10_ Mega ex cards — zh/ja were left over from wrong card names before patch
  'B2b-9':  { en: 'Mega Charizard X ex', zh: '超級噴火龍Xex',   ja: 'メガリザードンXex' },
  'B2b-16': { en: 'Mega Slowbro ex',     zh: '超級呆殼獸ex',    ja: 'メガヤドランex'    },
  'B2b-27': { en: 'Mega Manectric ex',   zh: '超級雷電獸ex',    ja: 'メガライボルトex'  },
  'B2b-39': { en: 'Mega Gengar ex',      zh: '超級耿鬼ex',      ja: 'メガゲンガーex'    },
  'B2b-47': { en: 'Mega Scizor ex',      zh: '超級巨鉗螳螂ex',  ja: 'メガハッサムex'    },

  // PK_10_ Paldean Tauros — zh/ja were left over from wrong card name before patch
  'B2b-14': { en: 'Paldean Tauros',      zh: '帕底亞 肯泰羅',  ja: 'パルデア ケンタロス' },

  // Illustration rare / special art Mega ex — zh already correct, ja was empty
  'B2b-83':  { en: 'Mega Slowbro ex',    zh: '超級呆殼獸ex',    ja: 'メガヤドランex'    },
  'B2b-90':  { en: 'Mega Manectric ex',  zh: '超級雷電獸ex',    ja: 'メガライボルトex'  },
  'B2b-97':  { en: 'Mega Gengar ex',     zh: '超級耿鬼ex',      ja: 'メガゲンガーex'    },
  'B2b-103': { en: 'Mega Scizor ex',     zh: '超級巨鉗螳螂ex',  ja: 'メガハッサムex'    },
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
      console.log(`  Fixed ${card.uid}: "${fix.en}" zh="${fix.zh}" ja="${fix.ja}"`);
      updated++;
    }
  }

  console.log(`\nUpdated ${updated} cards.`);
  db.generated = new Date().toISOString();
  fs.writeFileSync(DB_PATH, JSON.stringify(db));
  console.log('✅  Saved.');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
