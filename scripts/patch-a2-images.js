'use strict';
/**
 * Rebuild image paths for A2 (Space-Time Smackdown) by re-sorting the local
 * image files using the same group ordering as build-ptcgp-db.js, then
 * sequentially mapping sorted file[i] → card with num=(i+1).
 *
 * Run: node scripts/patch-a2-images.js
 */

const fs   = require('fs');
const path = require('path');

const PTCGP_ROOT = 'C:/Users/sagen/Desktop/PTCGP';
const A2_DIR     = path.join(PTCGP_ROOT, 'A2 - Space-Time Smackdown');
const DB_PATH    = path.join(__dirname, '../data/ptcgp_cards.json');
const LANGS      = ['zh_TW', 'ja_JP', 'en_US'];

// ── Same sort logic as build-ptcgp-db.js ─────────────────────────────────────

function group(f) {
  if (!f.startsWith('c')) return 8;
  const isUT  = f.endsWith('_UT.png');
  const parts = f.replace('.png', '').split('_');
  const pre  = parts[0];
  const ser  = parts[1];
  const vrnt = parts[3];
  const rar  = parts[5];
  const isPK = pre === 'cPK', isTR = pre === 'cTR';
  if (isPK && ser === '10')                        return 0;
  if (isTR && ser === '10' && !isUT)               return 1;
  if (isPK && ser === '20' && rar === 'AR')        return 2;
  if (isPK && ser === '20' && vrnt === '00')       return 3;
  if (isTR && ser === '20')                        return 4;
  if (isPK && ser === '20' && vrnt === '01')       return 5;
  if (isPK && ser === '90')                        return 6;
  if (isTR && ser === '10' && isUT)                return 7;
  return 8;
}

function sortFiles(files) {
  return files.slice().sort((a, b) => {
    const ga = group(a), gb = group(b);
    if (ga !== gb) return ga - gb;
    return a.localeCompare(b);
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

const raw  = fs.readFileSync(DB_PATH, 'utf8');
const data = JSON.parse(raw);
const all  = Array.isArray(data) ? data : Object.values(data).flat();

// Get A2 cards sorted by card number
const a2Cards = all.filter(c => c.set === 'A2').sort((a, b) => a.num - b.num);
console.log(`A2 cards in DB: ${a2Cards.length}`);

// Build sorted file list for each language
const langFiles = {};
for (const lang of LANGS) {
  const dir = path.join(A2_DIR, lang);
  if (!fs.existsSync(dir)) { console.warn(`Missing dir: ${dir}`); continue; }
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.png'));
  langFiles[lang] = sortFiles(files);
  console.log(`${lang}: ${files.length} files → first 5: ${langFiles[lang].slice(0,5).join(', ')}`);
}

// Map: card[i].images[lang] = langFiles[lang][i]
let updated = 0;
a2Cards.forEach((card, i) => {
  const newImages = {};
  for (const lang of LANGS) {
    const files = langFiles[lang];
    if (!files) continue;
    const file = files[i];
    if (!file) { console.warn(`  No file for card #${card.num} (${card.names.en}) in ${lang} at index ${i}`); continue; }
    newImages[lang] = path.join(A2_DIR, lang, file).replace(/\\/g, '/');
  }

  // Show first few and any changes
  if (i < 5 || (card.images?.zh_TW !== newImages.zh_TW)) {
    const oldName = (card.images?.zh_TW ?? '').split('/').pop();
    const newName = (newImages.zh_TW ?? '').split('/').pop();
    if (oldName !== newName) {
      console.log(`  #${card.num} ${card.names.en}: ${oldName} → ${newName}`);
    }
  }

  card.images = newImages;
  updated++;
});

fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
console.log(`\nDone. Updated images for ${updated} A2 cards.`);
