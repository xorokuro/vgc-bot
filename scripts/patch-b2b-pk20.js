'use strict';

/**
 * Fix B2b (Mega Shine) PK_20_ illustration rare card names and numbers.
 *
 * Root cause: same gid-sort-order mismatch as PK_10_. The build script sorted
 * PK_20_ files by gid ascending and matched positionally to the tcgdex IL rare
 * list — but the gids are not in official card order, so every IL rare got the
 * wrong name.
 *
 * Additionally, card #70 was labelled "Brambleghast" but the image (gid 015180)
 * is actually Arboliva.
 *
 * Fix derived by:
 *  1. Listing all PK_20_ files on disk (ls) — 45 files
 *  2. Applying the confirmed PK_10_ GID_TO_POS mapping (same gid = same Pokémon)
 *  3. Sorting by PK_10_ position (standard PTCGP IL rare ordering convention)
 *  4. Assigning card numbers #71-#114 accordingly
 *
 * OCR spot-checks confirmed:
 *   PK_20_016000 = Slowpoke, PK_20_016050 = Gastly, PK_20_016070 = Scyther
 *   PK_20_016150_01 = Mega Charizard X ex, PK_20_016210_01 = Mega Slowbro ex
 *   PK_20_016320_01 = Mega Manectric ex, PK_20_015180 = Arboliva
 *
 * Run: node scripts/patch-b2b-pk20.js
 * Then re-run: node scripts/enrich-ptcgp-db.js
 *              node scripts/enrich-ptcgp-zh-trainer.js
 *              node scripts/enrich-sameset-specialart.js
 */

const fs   = require('fs');
const path = require('path');

const DB_PATH  = path.join(__dirname, '../data/ptcgp_cards.json');
const TRI_PATH = path.join(__dirname, '../data/trilingual.json');

// image file key (gid_variant) → { num, en }
// Derived from GID_TO_POS (PK_10_) + PK_10_-position sort order for IL rares
const FILE_KEY_TO_CARD = {
  '015180_00': { num:  70, en: 'Arboliva'            },
  '016070_00': { num:  71, en: 'Scyther'             },
  '016080_00': { num:  72, en: 'Pineco'              },
  '016110_00': { num:  73, en: 'Phantump'            },
  '016120_00': { num:  74, en: 'Trevenant'           },
  '016130_00': { num:  75, en: 'Charmander'          },
  '016140_00': { num:  76, en: 'Charmeleon'          },
  '016150_00': { num:  77, en: 'Mega Charizard X ex' },
  '016150_01': { num:  78, en: 'Mega Charizard X ex' },
  '016160_00': { num:  79, en: 'Ponyta'              },
  '016170_00': { num:  80, en: 'Rapidash'            },
  '016000_00': { num:  81, en: 'Slowpoke'            },
  '016210_00': { num:  82, en: 'Mega Slowbro ex'     },
  '016210_01': { num:  83, en: 'Mega Slowbro ex'     },
  '016210_02': { num:  84, en: 'Mega Slowbro ex'     },
  '016220_00': { num:  85, en: 'Lapras'              },
  '016250_00': { num:  86, en: 'Empoleon'            },
  '016270_00': { num:  87, en: 'Pikachu'             },
  '016280_00': { num:  88, en: 'Raichu'              },
  '016310_00': { num:  89, en: 'Electrike'           },
  '016320_00': { num:  90, en: 'Mega Manectric ex'   },
  '016320_01': { num:  91, en: 'Mega Manectric ex'   },
  '016320_02': { num:  92, en: 'Mega Manectric ex'   },
  '016350_00': { num:  93, en: 'Mew'                 },
  '016350_01': { num:  94, en: 'Mew'                 },
  '016400_00': { num:  95, en: 'Groudon'             },
  '016410_00': { num:  96, en: 'Hawlucha'            },
  '016050_00': { num:  97, en: 'Gastly'              },
  '016420_00': { num:  98, en: 'Haunter'             },
  '016430_00': { num:  99, en: 'Mega Gengar ex'      },
  '016430_01': { num: 100, en: 'Mega Gengar ex'      },
  '016470_00': { num: 101, en: 'Zorua'               },
  '016480_00': { num: 102, en: 'Zoroark'             },
  '016490_00': { num: 103, en: 'Morpeko'             },
  '016500_00': { num: 104, en: 'Forretress'          },
  '016510_00': { num: 105, en: 'Mega Scizor ex'      },
  '016510_01': { num: 106, en: 'Mega Scizor ex'      },
  '016540_00': { num: 107, en: 'Revavroom'           },
  '016550_00': { num: 108, en: 'Dratini'             },
  '016560_00': { num: 109, en: 'Dragonair'           },
  '016570_00': { num: 110, en: 'Dragonite'           },
  '016580_00': { num: 111, en: 'Axew'                },
  '016590_00': { num: 112, en: 'Fraxure'             },
  '016030_00': { num: 113, en: 'Haxorus'             },
  '016620_00': { num: 114, en: 'Miltank'             },
};

// zh/ja overrides for Mega ex cards not in trilingual.json
const MEGA_ZH_JA = {
  'Arboliva':            { zh: '奧利瓦',          ja: 'オリーヴァ'       },
  'Mega Charizard X ex': { zh: '超級噴火龍Xex',   ja: 'メガリザードンXex' },
  'Mega Slowbro ex':     { zh: '超級呆殼獸ex',    ja: 'メガヤドランex'    },
  'Mega Manectric ex':   { zh: '超級雷電獸ex',    ja: 'メガライボルトex'  },
  'Mega Gengar ex':      { zh: '超級耿鬼ex',      ja: 'メガゲンガーex'    },
  'Mega Scizor ex':      { zh: '超級巨鉗螳螂ex',  ja: 'メガハッサムex'    },
};

function buildTrilingualLookup(triPath) {
  const data = JSON.parse(fs.readFileSync(triPath, 'utf8'));
  const map  = new Map();
  const STRIP = /\s+(ex|EX|V|VMAX|VSTAR|GX|GMAX|mega|Mega)$/i;
  const add = (en, zh, ja) => {
    if (!en) return;
    const key = en.toLowerCase();
    if (!map.has(key)) map.set(key, { zh: zh ?? '', ja: ja ?? '' });
    const base = en.replace(STRIP, '').trim().toLowerCase();
    if (base !== key && !map.has(base)) map.set(base, { zh: zh ?? '', ja: ja ?? '' });
  };
  for (const entry of Object.values(data.pokemon ?? {})) add(entry.en, entry.zh, entry.ja);
  return map;
}

function fileKeyFromPath(imgPath) {
  const m = path.basename(imgPath ?? '').match(/^PK_20_(\d{6})_(\d{2})\.png$/i);
  return m ? `${m[1]}_${m[2]}` : null;
}

async function main() {
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  const db  = JSON.parse(raw);
  const tri = buildTrilingualLookup(TRI_PATH);

  const b2bPK20 = db.cards.filter(c => c.set === 'B2b' && c.images?.zh_TW?.includes('PK_20_'));
  let updated = 0;

  for (const card of b2bPK20) {
    const key = fileKeyFromPath(card.images.zh_TW);
    if (!key) { console.warn('  Could not parse key from:', card.images.zh_TW); continue; }

    const mapping = FILE_KEY_TO_CARD[key];
    if (!mapping) { console.warn(`  No mapping for key ${key} (${card.uid})`); continue; }

    const { num, en: correctEn } = mapping;

    // zh/ja: try Mega override first, then trilingual
    const override = MEGA_ZH_JA[correctEn];
    const t = override ?? tri.get(correctEn.toLowerCase()) ??
              tri.get(correctEn.replace(/\s+(ex|EX|V|VMAX|VSTAR|GX|GMAX|mega|Mega)$/i, '').trim().toLowerCase()) ?? {};

    let changed = false;
    if (card.names.en !== correctEn) { card.names.en = correctEn; changed = true; }
    if (t.zh && card.names.zh !== t.zh) { card.names.zh = t.zh; changed = true; }
    if (t.ja && card.names.ja !== t.ja) { card.names.ja = t.ja; changed = true; }
    if (card.num !== num) { card.num = num; card.uid = `B2b-${num}`; changed = true; }

    if (changed) {
      console.log(`  ${key} → #${num} "${correctEn}"`);
      updated++;
    }
  }

  // Re-sort B2b PK_20_ cards by num
  const allB2b = db.cards.filter(c => c.set === 'B2b');
  allB2b.sort((a, b) => a.num - b.num);
  let idx = 0;
  for (let i = 0; i < db.cards.length; i++) {
    if (db.cards[i].set === 'B2b') db.cards[i] = allB2b[idx++];
  }

  console.log(`\nUpdated ${updated} B2b PK_20_ cards.`);

  const unmapped = b2bPK20.filter(c => !FILE_KEY_TO_CARD[fileKeyFromPath(c.images.zh_TW)]);
  if (unmapped.length) {
    console.log(`\n${unmapped.length} unmapped PK_20_ cards:`);
    unmapped.forEach(c => console.log(`  ${c.uid} key=${fileKeyFromPath(c.images.zh_TW)}`));
  }

  db.generated = new Date().toISOString();
  fs.writeFileSync(DB_PATH, JSON.stringify(db));
  console.log('✅  Saved.');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
