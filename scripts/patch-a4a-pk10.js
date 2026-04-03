'use strict';

/**
 * Fix A4a (Secluded Springs) PK_10_ card names and numbers.
 *
 * Root cause: PK_10_ files are stored by global production ID, not by official
 * set order. Six files (010120-010210) have lower gids than the rest of the set,
 * causing them to sort to positions 1-7 in our database even though they are
 * officially cards #10, #22, #36, #43, #49, #50, #62.
 *
 * This patch uses the confirmed gid→tcgdex_position mapping (built by reading
 * all 66 card images) to assign correct names and card numbers.
 *
 * Run: node scripts/patch-a4a-pk10.js
 * Then re-run: node scripts/enrich-ptcgp-db.js
 *              node scripts/enrich-ptcgp-zh-trainer.js
 */

const fs   = require('fs');
const path = require('path');

const DB_PATH  = path.join(__dirname, '../data/ptcgp_cards.json');
const TRI_PATH = path.join(__dirname, '../data/trilingual.json');

// gid → official tcgdex card position (1-based) — built from image OCR
const GID_TO_POS = {
  '010120': 22, '010130': 49, '010140': 50,
  '010180': 62, '010190': 43, '010200': 36,
  '010210': 10, '010220':  1, '010230':  2,
  '010240':  3, '010250':  4, '010260':  5,
  '010270':  6, '010280':  7, '010290':  8,
  '010300':  9, '010310': 11, '010320': 12,
  '010330': 13, '010340': 14, '010350': 15,
  '010360': 16, '010370': 17, '010380': 18,
  '010390': 19, '010400': 20, '010410': 21,
  '010420': 23, '010430': 24, '010440': 25,
  '010450': 26, '010460': 27, '010470': 28,
  '010480': 29, '010490': 30, '010500': 31,
  '010510': 32, '010520': 33, '010530': 34,
  '010540': 35, '010550': 37, '010560': 38,
  '010570': 39, '010580': 40, '010590': 41,
  '010600': 42, '010610': 44, '010620': 45,
  '010630': 46, '010640': 47, '010650': 48,
  '010660': 51, '010670': 52, '010680': 53,
  '010690': 54, '010700': 55, '010710': 56,
  '010720': 57, '010730': 58, '010740': 59,
  '010750': 60, '010760': 61, '010770': 63,
  '010780': 64, '010790': 65, '010800': 66,
};

// tcgdex position → English name (from full A4a set fetch)
const POS_TO_EN = {
   1: 'Hoppip',          2: 'Skiploom',        3: 'Jumpluff ex',
   4: 'Sunkern',         5: 'Sunflora',         6: 'Celebi',
   7: 'Durant',          8: 'Slugma',           9: 'Magcargo',
  10: 'Entei ex',       11: 'Fletchinder',     12: 'Talonflame',
  13: 'Poliwag',        14: 'Poliwhirl',       15: 'Tentacool',
  16: 'Tentacruel',     17: 'Slowpoke',        18: 'Slowking',
  19: 'Jynx',          20: 'Suicune ex',       21: 'Feebas',
  22: 'Milotic',        23: 'Mantyke',         24: 'Cryogonal',
  25: 'Raikou ex',      26: 'Tynamo',          27: 'Eelektrik',
  28: 'Eelektross',     29: 'Stunfisk',        30: 'Yamper',
  31: 'Boltund',        32: 'Misdreavus',      33: 'Mismagius',
  34: 'Galarian Corsola', 35: 'Galarian Cursola', 36: 'Latias',
  37: 'Latios',         38: 'Frillish',        39: 'Jellicent',
  40: 'Diglett',        41: 'Dugtrio',         42: 'Poliwrath ex',
  43: 'Phanpy',         44: 'Donphan',         45: 'Relicanth',
  46: 'Dwebble',        47: 'Crustle',         48: 'Seviper',
  49: 'Zorua',          50: 'Zoroark',         51: 'Inkay',
  52: 'Malamar',        53: 'Skrelp',          54: 'Dragalge',
  55: 'Altaria',        56: "Farfetch'd",      57: 'Lickitung',
  58: 'Lickilicky',     59: 'Igglybuff',       60: 'Teddiursa',
  61: 'Ursaring',       62: 'Miltank',         63: 'Azurill',
  64: 'Swablu',         65: 'Zangoose',        66: 'Fletchling',
};

function buildTrilingualLookup(triPath) {
  const data = JSON.parse(fs.readFileSync(triPath, 'utf8'));
  const map  = new Map();
  const STRIP = /\s+(ex|EX|V|VMAX|VSTAR|GX|GMAX|mega|Mega)$/i;
  const add = (en, zh, ja) => {
    if (!en) return;
    const key = en.toLowerCase();
    if (!map.has(key)) map.set(key, { zh: zh ?? '', ja: ja ?? '' });
    // Also index by base name (without ex/V/etc.)
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

  const a4aCards = db.cards.filter(c => c.set === 'A4a');
  let updated = 0;

  for (const card of a4aCards) {
    const gid = globalIdFromFile(card.images?.zh_TW);
    if (!gid) continue;

    const pos = GID_TO_POS[gid];
    if (!pos) continue;

    const correctEn = POS_TO_EN[pos];
    if (!correctEn) continue;

    // Look up zh/ja from trilingual
    const t = tri.get(correctEn.toLowerCase()) ??
              tri.get(correctEn.replace(/\s+(ex|EX|V|VMAX|VSTAR|GX|GMAX|mega|Mega)$/i, '').trim().toLowerCase()) ?? {};

    let changed = false;
    if (card.names.en !== correctEn) { card.names.en = correctEn; changed = true; }
    if (t.zh && card.names.zh !== t.zh) { card.names.zh = t.zh; changed = true; }
    if (t.ja && card.names.ja !== t.ja) { card.names.ja = t.ja; changed = true; }

    // Fix card number and uid
    if (card.num !== pos) { card.num = pos; card.uid = `A4a-${pos}`; changed = true; }

    if (changed) updated++;
  }

  // Re-sort A4a by num
  const a4aInDb = db.cards.filter(c => c.set === 'A4a');
  a4aInDb.sort((a, b) => a.num - b.num);
  let idx = 0;
  for (let i = 0; i < db.cards.length; i++) {
    if (db.cards[i].set === 'A4a') db.cards[i] = a4aInDb[idx++];
  }

  console.log(`Updated ${updated} A4a PK_10_ cards.`);

  // Report still-wrong cards (no gid match)
  const wrong = a4aInDb.filter(c => globalIdFromFile(c.images?.zh_TW) && !GID_TO_POS[globalIdFromFile(c.images?.zh_TW)]);
  if (wrong.length) {
    console.log(`\n${wrong.length} PK_10_ cards with unmapped gids:`);
    wrong.forEach(c => console.log(`  #${c.num} gid=${globalIdFromFile(c.images?.zh_TW)} en="${c.names.en}"`));
  }

  db.generated = new Date().toISOString();
  fs.writeFileSync(DB_PATH, JSON.stringify(db));
  console.log('✅  Saved.');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
