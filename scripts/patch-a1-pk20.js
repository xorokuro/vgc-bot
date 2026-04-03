'use strict';

/**
 * Fix A1 (Genetic Apex) IL rare / full-art cards (positions 227–286).
 *
 * Root cause: PK_20_ files have no name code in the filename — gids were sorted
 * ascending and matched positionally, but gid order ≠ official card order.
 * Additionally, trainer full-art cards (pos 266–273) were pointed at PK_20_
 * files instead of the correct TR_20_ files.
 *
 * This patch looks up each card by its current image filename and assigns the
 * correct card number, uid, and name. No image paths change — the physical
 * files are already correct; only the metadata in the DB is wrong.
 *
 * GID → position mapping built by reading all 52 en_US PK_20_ images via OCR
 * and cross-referencing with the official TCGdex A1 card list.
 *
 * Run:  node scripts/patch-a1-pk20.js
 * Then: node scripts/enrich-ptcgp-db.js
 *       node scripts/enrich-ptcgp-zh-trainer.js
 *       node scripts/enrich-sameset-specialart.js
 */

const fs   = require('fs');
const path = require('path');

const DB_PATH  = path.join(__dirname, '../data/ptcgp_cards.json');
const TRI_PATH = path.join(__dirname, '../data/trilingual.json');

// ---------------------------------------------------------------------------
// IMAGE FILENAME → correct card metadata
// Key = bare filename (no path). Covers all 52 PK_20_ + 8 TR_20_ entries.
// ---------------------------------------------------------------------------
const FILE_TO_CARD = {
  // ── Pokémon IL rares ── (single-art, positions 227–250)
  'PK_20_000010_00.png': { pos: 227, en: 'Bulbasaur' },
  'PK_20_000120_00.png': { pos: 228, en: 'Gloom' },
  'PK_20_000260_00.png': { pos: 229, en: 'Pinsir' },
  'PK_20_000330_00.png': { pos: 230, en: 'Charmander' },
  'PK_20_000430_00.png': { pos: 231, en: 'Rapidash' },
  'PK_20_000530_00.png': { pos: 232, en: 'Squirtle' },
  'PK_20_001880_00.png': { pos: 233, en: 'Gyarados' },
  'PK_20_000790_00.png': { pos: 234, en: 'Lapras' },
  'PK_20_000780_00.png': { pos: 235, en: 'Electrode' },
  'PK_20_001730_00.png': { pos: 236, en: 'Alakazam' },
  'PK_20_001180_00.png': { pos: 237, en: 'Slowpoke' },
  'PK_20_001390_00.png': { pos: 238, en: 'Diglett' },
  'PK_20_001510_00.png': { pos: 239, en: 'Cubone' },
  'PK_20_001680_00.png': { pos: 240, en: 'Nidoqueen' },
  'PK_20_001710_00.png': { pos: 241, en: 'Nidoking' },
  'PK_20_002050_00.png': { pos: 242, en: 'Golbat' },
  'PK_20_001770_00.png': { pos: 243, en: 'Weezing' },
  'PK_20_001850_00.png': { pos: 244, en: 'Dragonite' },
  'PK_20_001170_00.png': { pos: 245, en: 'Pidgeot' },
  'PK_20_001960_00.png': { pos: 246, en: 'Meowth' },
  'PK_20_001000_00.png': { pos: 247, en: 'Ditto' },
  'PK_20_002060_00.png': { pos: 248, en: 'Eevee' },
  'PK_20_002070_00.png': { pos: 249, en: 'Porygon' },
  'PK_20_002090_00.png': { pos: 250, en: 'Snorlax' },

  // ── ex Pokémon IL rares ── (single-art, positions 251–265)
  'PK_20_000040_00.png': { pos: 251, en: 'Venusaur ex' },
  'PK_20_000230_00.png': { pos: 252, en: 'Exeggutor ex' },
  'PK_20_000360_00.png': { pos: 253, en: 'Charizard ex' },
  'PK_20_000410_00.png': { pos: 254, en: 'Arcanine ex' },
  'PK_20_000470_00.png': { pos: 255, en: 'Moltres ex' },
  'PK_20_000560_00.png': { pos: 256, en: 'Blastoise ex' },
  'PK_20_000760_00.png': { pos: 257, en: 'Starmie ex' },
  'PK_20_000840_00.png': { pos: 258, en: 'Articuno ex' },
  'PK_20_000960_00.png': { pos: 259, en: 'Pikachu ex' },
  'PK_20_001040_00.png': { pos: 260, en: 'Zapdos ex' },
  'PK_20_001230_00.png': { pos: 261, en: 'Gengar ex' },
  'PK_20_001290_00.png': { pos: 262, en: 'Mewtwo ex' },
  'PK_20_001460_00.png': { pos: 263, en: 'Machamp ex' },
  'PK_20_001530_00.png': { pos: 264, en: 'Marowak ex' },
  'PK_20_001950_00.png': { pos: 265, en: 'Wigglytuff ex' },

  // ── Trainer full arts ── (TR_20_ files, positions 266–273)
  'TR_20_000110_00.png': { pos: 266, en: 'Erika',     zh: '莉佳',   ja: 'エリカ'  },
  'TR_20_000120_00.png': { pos: 267, en: 'Misty',     zh: '小霞',   ja: 'カスミ'  },
  'TR_20_000130_00.png': { pos: 268, en: 'Blaine',    zh: '夏伯',   ja: 'カツラ'  },
  'TR_20_000140_00.png': { pos: 269, en: 'Koga',      zh: '阿桔',   ja: 'キョウ'  },
  'TR_20_000150_00.png': { pos: 270, en: 'Giovanni',  zh: '坂木',   ja: 'サカキ'  },
  'TR_20_000160_00.png': { pos: 271, en: 'Brock',     zh: '小剛',   ja: 'タケシ'  },
  'TR_20_000170_00.png': { pos: 272, en: 'Sabrina',   zh: '娜姿',   ja: 'ナツメ'  },
  'TR_20_000180_00.png': { pos: 273, en: 'Lt. Surge', zh: '馬志士', ja: 'マチス'  },

  // ── Alt-art ex Pokémon ── (positions 274–286)
  'PK_20_000470_01.png': { pos: 274, en: 'Moltres ex' },
  'PK_20_000840_01.png': { pos: 275, en: 'Articuno ex' },
  'PK_20_001040_01.png': { pos: 276, en: 'Zapdos ex' },
  'PK_20_001230_01.png': { pos: 277, en: 'Gengar ex' },
  'PK_20_001460_01.png': { pos: 278, en: 'Machamp ex' },
  'PK_20_001950_01.png': { pos: 279, en: 'Wigglytuff ex' },
  'PK_20_000360_01.png': { pos: 280, en: 'Charizard ex' },
  'PK_20_000960_01.png': { pos: 281, en: 'Pikachu ex' },
  'PK_20_001290_01.png': { pos: 282, en: 'Mewtwo ex' },
  'PK_20_002140_00.png': { pos: 283, en: 'Mew' },
  'PK_20_000360_02.png': { pos: 284, en: 'Charizard ex' },
  'PK_20_000960_02.png': { pos: 285, en: 'Pikachu ex' },
  'PK_20_001290_02.png': { pos: 286, en: 'Mewtwo ex' },
};

// ---------------------------------------------------------------------------
// Helpers (copied from patch-b2b-pk10.js)
// ---------------------------------------------------------------------------
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
  for (const section of ['item', 'move', 'ability']) {
    for (const entry of Object.values(data[section] ?? {})) add(entry.en, entry.zh, entry.ja);
  }
  return map;
}

function filenameFromPath(imgPath) {
  return path.basename(imgPath ?? '');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const db  = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  const tri = buildTrilingualLookup(TRI_PATH);

  const a1Cards = db.cards.filter(c => c.set === 'A1' && c.num >= 227);
  let updated = 0;
  const unmapped = [];

  for (const card of a1Cards) {
    const filename = filenameFromPath(card.images?.zh_TW);
    const target   = FILE_TO_CARD[filename];

    if (!target) {
      unmapped.push(`  num=${card.num} file=${filename} en="${card.names.en}"`);
      continue;
    }

    let changed = false;

    // ── English name ──
    if (card.names.en !== target.en) { card.names.en = target.en; changed = true; }

    // ── zh / ja ──
    if (target.zh !== undefined) {
      // Trainer: use hardcoded zh/ja
      if (target.zh && card.names.zh !== target.zh) { card.names.zh = target.zh; changed = true; }
      if (target.ja && card.names.ja !== target.ja) { card.names.ja = target.ja; changed = true; }
    } else {
      // Pokémon: look up from trilingual.json
      const t = tri.get(target.en.toLowerCase()) ??
                tri.get(target.en.replace(/\s+(ex|EX|V|VMAX|VSTAR|GX|GMAX|mega|Mega)$/i, '').trim().toLowerCase()) ?? {};
      if (t.zh && card.names.zh !== t.zh) { card.names.zh = t.zh; changed = true; }
      if (t.ja && card.names.ja !== t.ja) { card.names.ja = t.ja; changed = true; }
    }

    // ── Card number / uid ──
    if (card.num !== target.pos) { card.num = target.pos; changed = true; }
    const expectedUid = `A1-${target.pos}`;
    if (card.uid !== expectedUid) { card.uid = expectedUid; changed = true; }

    if (changed) {
      console.log(`  Fixed ${filename} → #${target.pos} "${target.en}"`);
      updated++;
    }
  }

  // ── Re-sort A1 cards num>=227 in place ──
  const a1InDb = db.cards.filter(c => c.set === 'A1' && c.num >= 227);
  a1InDb.sort((a, b) => a.num - b.num);
  let idx = 0;
  for (let i = 0; i < db.cards.length; i++) {
    if (db.cards[i].set === 'A1' && db.cards[i].num >= 227) db.cards[i] = a1InDb[idx++];
  }

  console.log(`\nUpdated ${updated} A1 IL-rare/full-art cards.`);

  if (unmapped.length) {
    console.warn(`\n${unmapped.length} cards with unmapped filenames (check OCR table):`);
    unmapped.forEach(l => console.warn(l));
  }

  db.generated = new Date().toISOString();
  fs.writeFileSync(DB_PATH, JSON.stringify(db));
  console.log('✅  Saved.');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
