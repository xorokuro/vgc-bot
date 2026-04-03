'use strict';
/**
 * Restores A2b image paths to their pre-patch state using the original sort
 * logic (where cTR_10_ UT trainers sort to group 7).
 * Run once after patch-a2a-a2b-images.js accidentally worsened A2b.
 */
const fs   = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/ptcgp_cards.json');
const PTCGP   = 'C:/Users/sagen/Desktop/PTCGP';
const SET_DIR = 'A2b - Shining Rivalry';

// ── Old sort (original buggy logic — _UT.png always marks alternate-art UT) ──

function groupOld(f) {
  const isUT  = f.endsWith('_UT.png'); // OLD: treats _zh_TW_UT.png as UT
  const parts = f.replace('.png', '').split('_');
  const pre   = parts[0], ser = parts[1], vrnt = parts[3], rar = parts[5];
  const isPK  = pre === 'cPK', isTR = pre === 'cTR';
  if (isPK && ser === '10')                    return 0;
  if (isTR && ser === '10' && !isUT)           return 1;
  if (isPK && ser === '20' && rar === 'AR')    return 2;
  if (isPK && ser === '20' && vrnt === '00')   return 3;
  if (isTR && ser === '20')                    return 4;
  if (isPK && ser === '20' && vrnt === '01')   return 5;
  if (isPK && ser === '90')                    return 6;
  if (isTR && ser === '10' && isUT)            return 7;
  return 8;
}

function sortOldFormat(files) {
  return files.slice().sort((a, b) => {
    const ga = groupOld(a), gb = groupOld(b);
    return ga !== gb ? ga - gb : a.localeCompare(b);
  });
}

function getSortedZhFiles() {
  const zhDir  = `${PTCGP}/${SET_DIR}/zh_TW`;
  const all    = fs.readdirSync(zhDir).filter(f => f.endsWith('.png'));
  const nonPromo = all.filter(f => !f.startsWith('cPK_90_'));
  const byKey  = new Map();
  for (const f of nonPromo) {
    const parts = f.split('_'); if (parts.length < 4) continue;
    const key = `${parts[0]}_${parts[1]}_${parts[2]}_${parts[3]}`;
    const isUT = f.endsWith('_UT.png');
    if (!byKey.has(key) || (!isUT && byKey.get(key).isUT))
      byKey.set(key, { file: f, isUT });
  }
  return sortOldFormat([...byKey.values()].map(v => v.file));
}

function buildLangMap(lang) {
  const dir = `${PTCGP}/${SET_DIR}/${lang}`;
  if (!fs.existsSync(dir)) return new Map();
  const map = new Map();
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.png'))) {
    const parts = f.split('_'); if (parts.length < 4) continue;
    const key = `${parts[0]}_${parts[1]}_${parts[2]}_${parts[3]}`;
    if (!map.has(key) || !f.endsWith('_UT.png')) map.set(key, f);
  }
  return map;
}

const db    = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
const cards = db.cards;

const zhFiles = getSortedZhFiles();
const jaMap   = buildLangMap('ja_JP');
const enMap   = buildLangMap('en_US');
const setCards = cards.filter(c => c.set === 'A2b').sort((a,b) => a.num - b.num);

let fixed = 0;
for (let i = 0; i < setCards.length; i++) {
  const card = setCards[i];
  const zhFile = zhFiles[i] ?? null;
  if (!zhFile) continue;
  const parts = zhFile.split('_');
  const key = `${parts[0]}_${parts[1]}_${parts[2]}_${parts[3]}`;
  const base = `${PTCGP}/${SET_DIR}`;
  const jaFile = jaMap.get(key);
  const enFile = enMap.get(key);
  const newImages = {
    zh_TW: `${base}/zh_TW/${zhFile}`,
    ja_JP: jaFile ? `${base}/ja_JP/${jaFile}` : null,
    en_US: enFile ? `${base}/en_US/${enFile}` : null,
  };
  if (card.images?.zh_TW !== newImages.zh_TW) {
    card.images = newImages;
    fixed++;
  }
}

db.generated = new Date().toISOString();
fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
console.log(`✅ Reverted ${fixed} A2b cards to original image paths.`);
