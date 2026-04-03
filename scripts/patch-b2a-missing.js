'use strict';

/**
 * Fix B2a (Shining Revelry / Paldean Sweets) missing card names.
 *
 * 17 cards with empty names identified by reading en_US card images:
 *
 * PK_10_ Pokémon (#86-90) — gids 015900-015940:
 *   #86 Tandemaus, #87 Maushold, #88 Squawkabilly, #89 Cyclizar, #90 Flamigo
 *
 * TR_10_ Trainer cards (#93-98) — gids TR_10_001170-001220:
 *   #93 Electric Generator, #94 Beach Ball, #95 Team Star Grunt,
 *   #96 Nemona, #97 Arven, #98 Mesagoza (Stadium)
 *
 * PK_20_ Special art Pokémon (#129):
 *   #129 Maushold (illustration rare)
 *
 * TR_20_ Full-art Trainer cards (#132-136):
 *   #132 Electric Generator, #133 Team Star Grunt, #134 Nemona,
 *   #135 Arven, #136 Arven (alternate full art)
 *
 * No ordering fix needed — PK_10_ gids 015100-015940 are all ascending.
 *
 * zh names: from zh_TW card images + Pokémon S/V Traditional Chinese game
 * ja names: from ja_JP card images
 *
 * Run: node scripts/patch-b2a-missing.js
 * Then: node scripts/enrich-ptcgp-db.js
 *        node scripts/enrich-ptcgp-zh-trainer.js
 *        node scripts/enrich-sameset-specialart.js
 */

const fs   = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/ptcgp_cards.json');

// uid → { en, zh, ja }
const FIXES = {
  // Pokémon — zh/ja from existing DB entries for same species
  'B2a-86':  { en: 'Tandemaus',         zh: '一對鼠',          ja: 'ワッカネズミ'          },
  'B2a-87':  { en: 'Maushold',          zh: '一家鼠',          ja: 'イッカネズミ'          },
  'B2a-88':  { en: 'Squawkabilly',      zh: '怒鸚哥',          ja: 'イキリンコ'            },
  'B2a-89':  { en: 'Cyclizar',          zh: '摩托蜥',          ja: 'モトトカゲ'            },
  'B2a-90':  { en: 'Flamigo',           zh: '纏紅鶴',          ja: 'カラミンゴ'            },

  // Trainer items — zh from zh_TW card images, ja from ja_JP card images
  'B2a-93':  { en: 'Electric Generator', zh: '電氣發生器',     ja: 'エレキジェネレーター'  },
  'B2a-94':  { en: 'Beach Ball',         zh: '大氣球',         ja: '大きなふうせん'        },
  'B2a-95':  { en: 'Team Star Grunt',    zh: '天星手下',        ja: 'スター団のしたっぱ'    },

  // Trainer supporters — zh from S/V Traditional Chinese, ja from ja_JP card images
  'B2a-96':  { en: 'Nemona',            zh: '娜慕',            ja: 'ネモ'                 },
  'B2a-97':  { en: 'Arven',             zh: '路路科',          ja: 'ペパー'               },
  'B2a-98':  { en: 'Mesagoza',          zh: '桌子城',          ja: 'テーブルシティ'        },

  // Special art — same species names as regular
  'B2a-129': { en: 'Maushold',          zh: '一家鼠',          ja: 'イッカネズミ'          },

  // Full-art trainers — same names as regular art versions
  'B2a-132': { en: 'Electric Generator', zh: '電氣發生器',     ja: 'エレキジェネレーター'  },
  'B2a-133': { en: 'Team Star Grunt',    zh: '天星手下',        ja: 'スター団のしたっぱ'    },
  'B2a-134': { en: 'Nemona',            zh: '娜慕',            ja: 'ネモ'                 },
  'B2a-135': { en: 'Arven',             zh: '路路科',          ja: 'ペパー'               },
  'B2a-136': { en: 'Arven',             zh: '路路科',          ja: 'ペパー'               },
};

async function main() {
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  const db  = JSON.parse(raw);

  let updated = 0;
  for (const card of db.cards) {
    if (card.set !== 'B2a') continue;
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

  console.log(`\nUpdated ${updated} B2a cards.`);
  db.generated = new Date().toISOString();
  fs.writeFileSync(DB_PATH, JSON.stringify(db));
  console.log('✅  Saved.');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
