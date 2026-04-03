'use strict';

/**
 * scripts/patch-a2a-a2b-images.js
 *
 * Fixes the image paths for A2a (Triumphant Light) and A2b (Shining Rivalry)
 * without rebuilding the full database — preserves existing HP and weakness data.
 *
 * Root cause: all files in A2a/A2b end with _zh_TW_UT.png. The old sort logic
 * treated that as "alternate-art UT", placing all cTR_10_ trainers at group 7
 * (end of set) instead of group 1 (after regular Pokémon). This shifted 24+
 * images in A2a and ~40+ in A2b.
 *
 * Usage:
 *   node scripts/patch-a2a-a2b-images.js
 *   node scripts/patch-a2a-a2b-images.js A2a        # patch only A2a
 *   node scripts/patch-a2a-a2b-images.js A2a A2b    # patch both (default)
 */

const fs   = require('fs');
const path = require('path');

const DB_PATH  = path.join(__dirname, '../data/ptcgp_cards.json');
const PTCGP    = 'C:/Users/sagen/Desktop/PTCGP';

const SET_DIRS = {
  A2a: 'A2a - Triumphant Light',
  A2b: 'A2b - Shining Rivalry',
};

const argSets = process.argv.slice(2).filter(a => !a.startsWith('--'));
const SETS    = argSets.length > 0 ? argSets : ['A2a', 'A2b'];

// ── Helpers (mirrors fixed build-from-txt.js logic) ───────────────────────────

// True alternate-art UT: bare _UT.png, NOT a language-embedded suffix.
const isTrueUT = f =>
  f.endsWith('_UT.png') && !/_(?:zh_TW|ja_JP|en_US)_UT\.png$/.test(f);

function group(f) {
  const isUT  = isTrueUT(f);
  const parts = f.replace('.png', '').split('_');
  const pre   = parts[0]; // cPK or cTR
  const ser   = parts[1]; // 10, 20, 90
  const vrnt  = parts[3]; // 00 or 01
  const rar   = parts[5]; // C, U, R, RR, AR, SR, SAR, IM
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
    const ga = group(a), gb = group(b);
    return ga !== gb ? ga - gb : a.localeCompare(b);
  });
}

/** Get sorted, deduped, promo-excluded zh_TW file list for a set. */
function getSortedZhFiles(setDir) {
  const zhDir = `${PTCGP}/${setDir}/zh_TW`;
  const all   = fs.readdirSync(zhDir).filter(f => f.endsWith('.png'));

  // Exclude promos
  const nonPromo = all.filter(f => !f.startsWith('cPK_90_'));

  // Deduplicate (prefer non-UT over UT per key)
  const byKey = new Map();
  for (const f of nonPromo) {
    const parts = f.split('_');
    if (parts.length < 4) continue;
    const key  = `${parts[0]}_${parts[1]}_${parts[2]}_${parts[3]}`;
    const isUT = isTrueUT(f);
    if (!byKey.has(key) || (!isUT && byKey.get(key).isUT)) {
      byKey.set(key, { file: f, isUT });
    }
  }

  return sortOldFormat([...byKey.values()].map(v => v.file));
}

/** Build key→filename map for a language directory. */
function buildLangMap(setDir, lang) {
  const dir = `${PTCGP}/${setDir}/${lang}`;
  if (!fs.existsSync(dir)) return new Map();
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.png'));
  const map   = new Map();
  for (const f of files) {
    const parts = f.split('_');
    if (parts.length < 4) continue;
    const key  = `${parts[0]}_${parts[1]}_${parts[2]}_${parts[3]}`;
    const isUT = isTrueUT(f);
    if (!map.has(key) || !isUT) map.set(key, f); // prefer non-UT
  }
  return map;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const db    = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
const cards = db.cards;

let totalFixed = 0;

for (const setId of SETS) {
  const setDir = SET_DIRS[setId];
  if (!setDir) { console.warn(`Unknown set: ${setId}`); continue; }

  console.log(`\n🔧 Patching ${setId} (${setDir}) …`);

  const zhFiles = getSortedZhFiles(setDir);
  const jaMap   = buildLangMap(setDir, 'ja_JP');
  const enMap   = buildLangMap(setDir, 'en_US');

  // Get set cards sorted by num (1-indexed position = index in zhFiles)
  const setCards = cards
    .filter(c => c.set === setId)
    .sort((a, b) => a.num - b.num);

  if (setCards.length !== zhFiles.length) {
    console.warn(`  ⚠  Card count mismatch: DB has ${setCards.length}, folder has ${zhFiles.length} files`);
  }

  let fixed = 0;
  for (let i = 0; i < setCards.length; i++) {
    const card   = setCards[i];
    const zhFile = zhFiles[i] ?? null;
    if (!zhFile) { console.warn(`  ⚠  No file at position ${i+1} for ${card.uid}`); continue; }

    const parts  = zhFile.split('_');
    const key    = `${parts[0]}_${parts[1]}_${parts[2]}_${parts[3]}`;
    const jaFile = jaMap.get(key) ?? null;
    const enFile = enMap.get(key) ?? null;
    const base   = `${PTCGP}/${setDir}`;

    const newImages = {
      zh_TW: `${base}/zh_TW/${zhFile}`,
      ja_JP: jaFile ? `${base}/ja_JP/${jaFile}` : null,
      en_US: enFile ? `${base}/en_US/${enFile}` : null,
    };

    const oldZh = card.images?.zh_TW ?? '';
    if (oldZh !== newImages.zh_TW) {
      console.log(`  ${card.uid} ${card.names.en?.padEnd(25)} ${zhFile.split('_').slice(4, 6).join('_')}`);
      card.images = newImages;
      fixed++;
    }
  }

  console.log(`  ✅ Fixed ${fixed} / ${setCards.length} cards`);
  totalFixed += fixed;
}

db.generated = new Date().toISOString();
fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');

console.log(`\n${'='.repeat(60)}`);
console.log(`✅ Done! Fixed ${totalFixed} cards total. DB saved.`);
