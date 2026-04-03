'use strict';

/**
 * Fix B2b (Mega Shine) PK_10_ card names and numbers.
 *
 * Root cause: PK_10_ files are stored by global production ID, not by official
 * set order. The entire set is scrambled — gids 016000–016060 have lower IDs
 * than the main block (016070–016650) but represent cards from positions 15–64
 * in the official list, causing massive name/image mismatches throughout.
 *
 * This patch uses the confirmed gid→tcgdex_position mapping (built by reading
 * all 64 card images via OCR) to assign correct names and card numbers.
 *
 * OCR results confirmed against official card list from Serebii/Game8:
 *   016000=Slowpoke(#15), 016030=Haxorus(#56), 016040=Chatot(#61),
 *   016050=Gastly(#37),   016060=Wigglytuff(#59), then 016070=Scyther(#1)
 *   through 016650=Furfrou(#64) with mostly sequential assignment.
 *
 * Run: node scripts/patch-b2b-pk10.js
 * Then re-run: node scripts/enrich-ptcgp-db.js
 *              node scripts/enrich-ptcgp-zh-trainer.js
 *              node scripts/enrich-sameset-specialart.js
 */

const fs   = require('fs');
const path = require('path');

const DB_PATH  = path.join(__dirname, '../data/ptcgp_cards.json');
const TRI_PATH = path.join(__dirname, '../data/trilingual.json');

// gid → official tcgdex card position (1-based) — built from image OCR
const GID_TO_POS = {
  '016000': 15, '016030': 56, '016040': 61,
  '016050': 37, '016060': 59, '016070':  1,
  '016080':  2, '016090':  3, '016100':  4,
  '016110':  5, '016120':  6, '016130':  7,
  '016140':  8, '016150':  9, '016160': 10,
  '016170': 11, '016180': 12, '016190': 13,
  '016200': 14, '016210': 16, '016220': 17,
  '016230': 18, '016240': 19, '016250': 20,
  '016260': 21, '016270': 22, '016280': 23,
  '016290': 24, '016300': 25, '016310': 26,
  '016320': 27, '016330': 28, '016340': 29,
  '016350': 30, '016360': 31, '016370': 32,
  '016380': 33, '016390': 34, '016400': 35,
  '016410': 36, '016420': 38, '016430': 39,
  '016440': 40, '016450': 41, '016460': 42,
  '016470': 43, '016480': 44, '016490': 45,
  '016500': 46, '016510': 47, '016520': 48,
  '016530': 49, '016540': 50, '016550': 51,
  '016560': 52, '016570': 53, '016580': 54,
  '016590': 55, '016600': 57, '016610': 58,
  '016620': 60, '016630': 62, '016640': 63,
  '016650': 64,
};

// official position → English name (from serebii.net/game8 B2b set list)
const POS_TO_EN = {
   1: 'Scyther',            2: 'Pineco',            3: 'Volbeat',
   4: 'Illumise',           5: 'Phantump',          6: 'Trevenant',
   7: 'Charmander',         8: 'Charmeleon',        9: 'Mega Charizard X ex',
  10: 'Ponyta',            11: 'Rapidash',         12: 'Magmar',
  13: 'Magmortar',         14: 'Paldean Tauros',   15: 'Slowpoke',
  16: 'Mega Slowbro ex',   17: 'Lapras',           18: 'Piplup',
  19: 'Prinplup',          20: 'Empoleon',         21: 'Phione',
  22: 'Pikachu',           23: 'Raichu',           24: 'Electabuzz',
  25: 'Electivire',        26: 'Electrike',        27: 'Mega Manectric ex',
  28: 'Drowzee',           29: 'Hypno',            30: 'Mew',
  31: 'Spoink',            32: 'Grumpig',          33: 'Diglett',
  34: 'Dugtrio',           35: 'Groudon',          36: 'Hawlucha',
  37: 'Gastly',            38: 'Haunter',          39: 'Mega Gengar ex',
  40: 'Darkrai',           41: 'Trubbish',         42: 'Garbodor',
  43: 'Zorua',             44: 'Zoroark',          45: 'Morpeko',
  46: 'Forretress',        47: 'Mega Scizor ex',   48: 'Kartana',
  49: 'Varoom',            50: 'Revavroom',        51: 'Dratini',
  52: 'Dragonair',         53: 'Dragonite',        54: 'Axew',
  55: 'Fraxure',           56: 'Haxorus',          57: 'Druddigon',
  58: 'Jigglypuff',        59: 'Wigglytuff',       60: 'Miltank',
  61: 'Chatot',            62: 'Minccino',         63: 'Cinccino',
  64: 'Furfrou',
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
  for (const section of ['item', 'move', 'ability']) {
    for (const entry of Object.values(data[section] ?? {})) add(entry.en, entry.zh, entry.ja);
  }
  return map;
}

function globalIdFromFile(imgPath) {
  const m = path.basename(imgPath ?? '').match(/^PK_10_(\d{6})_/);
  return m?.[1] ?? null;
}

async function main() {
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  const db  = JSON.parse(raw);
  const tri = buildTrilingualLookup(TRI_PATH);

  const b2bCards = db.cards.filter(c => c.set === 'B2b');
  let updated = 0;

  for (const card of b2bCards) {
    const gid = globalIdFromFile(card.images?.zh_TW);
    if (!gid) continue;

    const pos = GID_TO_POS[gid];
    if (!pos) continue;

    const correctEn = POS_TO_EN[pos];
    if (!correctEn) continue;

    const t = tri.get(correctEn.toLowerCase()) ??
              tri.get(correctEn.replace(/\s+(ex|EX|V|VMAX|VSTAR|GX|GMAX|mega|Mega)$/i, '').trim().toLowerCase()) ?? {};

    let changed = false;
    if (card.names.en !== correctEn) { card.names.en = correctEn; changed = true; }
    if (t.zh && card.names.zh !== t.zh) { card.names.zh = t.zh; changed = true; }
    if (t.ja && card.names.ja !== t.ja) { card.names.ja = t.ja; changed = true; }

    if (card.num !== pos) { card.num = pos; card.uid = `B2b-${pos}`; changed = true; }

    if (changed) {
      console.log(`  Fixed gid ${gid} → #${pos} "${correctEn}"`);
      updated++;
    }
  }

  // Re-sort B2b by num
  const b2bInDb = db.cards.filter(c => c.set === 'B2b');
  b2bInDb.sort((a, b) => a.num - b.num);
  let idx = 0;
  for (let i = 0; i < db.cards.length; i++) {
    if (db.cards[i].set === 'B2b') db.cards[i] = b2bInDb[idx++];
  }

  console.log(`\nUpdated ${updated} B2b PK_10_ cards.`);

  const wrong = b2bInDb.filter(c => globalIdFromFile(c.images?.zh_TW) && !GID_TO_POS[globalIdFromFile(c.images?.zh_TW)]);
  if (wrong.length) {
    console.log(`\n${wrong.length} PK_10_ cards with unmapped gids:`);
    wrong.forEach(c => console.log(`  #${c.num} gid=${globalIdFromFile(c.images?.zh_TW)} en="${c.names.en}"`));
  }

  db.generated = new Date().toISOString();
  fs.writeFileSync(DB_PATH, JSON.stringify(db));
  console.log('✅  Saved.');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
