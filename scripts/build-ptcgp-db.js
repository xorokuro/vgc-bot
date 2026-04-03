'use strict';

/**
 * Build the PTCGP card database from local image files + tcgdex API.
 * Run: node scripts/build-ptcgp-db.js
 *
 * Takes ~5-10 min depending on API speed.
 * Output: data/ptcgp_cards.json
 */

const fs   = require('fs');
const path = require('path');

const PTCGP_ROOT = 'C:/Users/sagen/Desktop/PTCGP';
const OUTPUT     = path.join(__dirname, '../data/ptcgp_cards.json');

// Map set codes → local directory names (and display names)
const SETS = [
  { id: 'A1',  dir: 'A1 - Genetic Apex',               name: 'Genetic Apex' },
  { id: 'A1a', dir: 'A1a - Mythical Island',             name: 'Mythical Island' },
  { id: 'A2',  dir: 'A2 - Space-Time Smackdown',         name: 'Space-Time Smackdown' },
  { id: 'A2a', dir: 'A2a - Triumphant Light',            name: 'Triumphant Light' },
  { id: 'A2b', dir: 'A2b - Shining Rivalry',             name: 'Shining Rivalry' },
  { id: 'A3',  dir: 'A3 - Celestial Guardians',          name: 'Celestial Guardians' },
  { id: 'A3a', dir: 'A3a - Extradimensional Crisis',     name: 'Extradimensional Crisis' },
  { id: 'A3b', dir: 'A3b - Eevee Groove',                name: 'Eevee Groove' },
  { id: 'A4',  dir: 'A4 - Wisdom of Sea and Sky',        name: 'Wisdom of Sea and Sky' },
  { id: 'A4a', dir: 'A4a Secluded Springs',                         name: 'Secluded Springs' },
  { id: 'A4b', dir: 'A4b - Deluxe Pack ex',              name: 'Deluxe Pack ex' },
  { id: 'B1',  dir: 'B1 - Mega Rising',                  name: 'Mega Rising' },
  { id: 'B1a', dir: 'B1a - Crimson Blaze',               name: 'Crimson Blaze' },
  { id: 'B2',  dir: 'B2 - Fantastical Parade',           name: 'Fantastical Parade' },
  { id: 'B2a', dir: 'B2a - Paldean Sweets',              name: 'Paldean Sweets' },
  { id: 'B2b', dir: 'B2b - Mega Shine',                  name: 'Mega Shine' },
];

const LANGS      = ['zh_TW', 'ja_JP', 'en_US'];
const TCGDEX_MAP = { zh_TW: 'zh-Hant', ja_JP: 'ja', en_US: 'en' };
const DELAY_MS   = 400; // polite rate limit between API calls

// ── Helpers ───────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchJSON(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Fetch cards for a set in one language from tcgdex.
 * Returns array of { localId, name, rarity } sorted by localId.
 */
async function fetchSetCards(setId, tcgLang) {
  const url = `https://api.tcgdex.net/v2/${tcgLang}/sets/${setId}`;
  const data = await fetchJSON(url);
  const cards = (data.cards ?? []).map(c => ({
    localId: String(c.localId),
    name:    c.name ?? '',
    rarity:  c.rarity ?? '',
  }));
  // Sort by numeric localId
  cards.sort((a, b) => parseInt(a.localId, 10) - parseInt(b.localId, 10));
  return cards;
}

/**
 * Extract rarity code from a newer-format filename.
 * e.g. "cPK_10_004250_00_HERACROS_U_M_zh_TW_UT.png" → "U"
 */
function rarityFromFilename(filename) {
  if (!filename.startsWith('c')) return null;
  const parts = filename.replace('.png', '').split('_');
  // format: cPK | 10 | 004250 | 00 | NAME | RARITY | ...
  // index:   0     1    2       3    4      5
  const rarity = parts[5];
  if (rarity && /^[A-Z]+$/.test(rarity)) return rarity;
  return null;
}

/**
 * Find the image file for a given global card ID in a language folder.
 * Returns absolute path or null.
 */
function findImageByGlobalId(langDir, globalId) {
  if (!fs.existsSync(langDir)) return null;
  const files = fs.readdirSync(langDir).filter(f => f.endsWith('.png'));
  const match = files.find(f => f.includes(`_${globalId}_`));
  return match ? path.join(langDir, match) : null;
}

/**
 * Extract global card ID from filename.
 * "PK_10_000010_00.png"        → "000010"
 * "cPK_10_004250_00_HER...png" → "004250"
 */
function globalIdFromFilename(filename) {
  const m = filename.match(/(?:^c?(?:PK|TR)_\d+_)(\d{6})/);
  return m?.[1] ?? null;
}

// ── New-format file sort ───────────────────────────────────────────────────────
// New-format files (cPK_*/cTR_*) must be sorted in official card-number order,
// not alphabetically. Alphabetical puts cPK_20_ (special arts) before cTR_10_
// (items/trainers), which is the reverse of the official set numbering.
//
// Official ordering within a set:
//   0  cPK_10_          – regular Pokémon (C/U/R/RR)
//   1  cTR_10_ (no UT)  – items + regular trainers
//   2  cPK_20_ AR       – Pokémon alternate art (AR)
//   3  cPK_20_ SR _00   – Pokémon ex special art (SR/RR, first art)
//   4  cTR_20_          – trainer special art (SR)
//   5  cPK_20_    _01   – Pokémon ex second art (SAR/IM)
//   6  cPK_90_          – promo / extra Pokémon
//   7  cTR_10_ UT       – alternate-art items
//   8  (unknown)        – anything else

// ── Custom sort-key overrides ─────────────────────────────────────────────────
// Some old-format sets assign global IDs that are out of official card-number
// order. Add entries here if any remaining old-format set needs manual ordering.
const CUSTOM_SORT_KEYS = {};

// Detect renamed new-format files: SETID-NNN.png (e.g. A1-001.png, B2b-042.png)
const RENAMED_RE = /^[A-Za-z][A-Za-z0-9]*-\d+\.png$/;

function sortCardFiles(files, setId) {
  const keyOverrides = CUSTOM_SORT_KEYS[setId] ?? {};
  const sortKey = f => keyOverrides[f] ?? f;

  // If the set has renamed SETID-NNN.png files, sort by numeric position.
  // Old-format files that weren't renamed are placed at the gaps in the
  // numeric sequence (in alphabetical order among themselves).
  if (files.some(f => RENAMED_RE.test(f))) {
    // Find the max card number and all used positions from renamed files
    const usedNums = new Set();
    for (const f of files) {
      if (RENAMED_RE.test(f)) {
        const m = f.match(/-0*(\d+)\.png$/);
        if (m) usedNums.add(parseInt(m[1], 10));
      }
    }
    const maxNum = usedNums.size ? Math.max(...usedNums) : 0;

    // Find gaps (positions not covered), in order
    const gaps = [];
    for (let i = 1; i <= maxNum; i++) {
      if (!usedNums.has(i)) gaps.push(i);
    }

    // Assign old-format files to gaps (alphabetically), then overflow after maxNum
    const oldFiles = files.filter(f => !RENAMED_RE.test(f)).slice().sort((a, b) => a.localeCompare(b));
    const oldPos = new Map();
    oldFiles.forEach((f, i) => {
      oldPos.set(f, gaps[i] ?? maxNum + 1 + (i - gaps.length));
    });

    return files.slice().sort((a, b) => {
      const numOf = f => {
        if (RENAMED_RE.test(f)) {
          const m = f.match(/-0*(\d+)\.png$/);
          return m ? parseInt(m[1], 10) : 999999;
        }
        return oldPos.get(f) ?? 999999;
      };
      return numOf(a) - numOf(b);
    });
  }

  // Old-format sets (no 'c' prefix): PK_10_ → TR_10_ → PK_20_ → TR_20_
  // Alphabetical sort is WRONG here because it puts PK_20_ before TR_10_.
  if (!files.some(f => f.startsWith('c'))) {
    function oldGroup(f) {
      if (f.startsWith('PK_10_')) return 0;
      if (f.startsWith('TR_10_')) return 1;
      if (f.startsWith('PK_20_')) return 2;
      if (f.startsWith('TR_20_')) return 3;
      return 4;
    }
    return files.slice().sort((a, b) => {
      const ga = oldGroup(a), gb = oldGroup(b);
      if (ga !== gb) return ga - gb;
      return sortKey(a).localeCompare(sortKey(b));
    });
  }

  function group(f) {
    if (!f.startsWith('c')) return 0;
    const isUT  = f.endsWith('_UT.png');
    const parts = f.replace('.png', '').split('_');
    const pre  = parts[0];      // cPK or cTR
    const ser  = parts[1];      // 10, 20, 90
    const vrnt = parts[3];      // 00 or 01
    const rar  = parts[5];      // C, U, R, RR, AR, SR, SAR, IM
    const isPK = pre === 'cPK', isTR = pre === 'cTR';
    if (isPK && ser === '10')                          return 0;
    if (isTR && ser === '10' && !isUT)                 return 1;
    if (isPK && ser === '20' && rar === 'AR')          return 2;
    if (isPK && ser === '20' && vrnt === '00')         return 3;
    if (isTR && ser === '20')                          return 4;
    if (isPK && ser === '20' && vrnt === '01')         return 5;
    if (isPK && ser === '90')                          return 6;
    if (isTR && ser === '10' && isUT)                  return 7;
    return 8;
  }

  return files.slice().sort((a, b) => {
    const ga = group(a), gb = group(b);
    if (ga !== gb) return ga - gb;
    return a.localeCompare(b);
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function buildDatabase() {
  const allCards = [];

  for (const set of SETS) {
    const setDir = path.join(PTCGP_ROOT, set.dir);

    if (!fs.existsSync(setDir)) {
      console.warn(`⚠  Skipping ${set.id}: directory not found at ${setDir}`);
      continue;
    }

    // Collect files from the reference language folder (zh_TW)
    const refDir = path.join(setDir, 'zh_TW');
    if (!fs.existsSync(refDir)) {
      console.warn(`⚠  Skipping ${set.id}: no zh_TW folder`);
      continue;
    }

    const rawFiles = fs.readdirSync(refDir).filter(f => f.endsWith('.png'));
    const localFiles = sortCardFiles(rawFiles, set.id);

    console.log(`\n📦 ${set.id} — ${set.name} (${localFiles.length} files)`);

    // Fetch card names from tcgdex for all 3 languages
    const namesByLang = { zh_TW: [], ja_JP: [], en_US: [] };
    let tcgdexRarities = []; // from English response

    for (const [lang, tcgLang] of Object.entries(TCGDEX_MAP)) {
      try {
        const cards = await fetchSetCards(set.id, tcgLang);
        namesByLang[lang] = cards.map(c => c.name);
        if (lang === 'en_US') tcgdexRarities = cards.map(c => c.rarity);
        console.log(`  ✓ ${lang}: ${cards.length} cards from tcgdex`);
      } catch (e) {
        console.warn(`  ✗ ${lang}: tcgdex failed (${e.message})`);
      }
      await sleep(DELAY_MS);
    }

    if (localFiles.length !== namesByLang.en_US.length && namesByLang.en_US.length > 0) {
      console.warn(`  ⚠  Count mismatch: ${localFiles.length} local vs ${namesByLang.en_US.length} tcgdex`);
    }

    // Build card records — match by position
    for (let i = 0; i < localFiles.length; i++) {
      const file     = localFiles[i];
      const globalId = globalIdFromFilename(file);

      // Image paths: find the matching file in each language folder
      const images = {};
      for (const lang of LANGS) {
        const langDir = path.join(setDir, lang);
        if (file.startsWith('c')) {
          // New-format: language code is embedded in filename (e.g. zh_TW).
          // Replace it directly — avoids ambiguity when cPK_10_ and cPK_20_ share the same global ID.
          const langFile = file.replace('zh_TW', lang);
          const candidate = path.join(langDir, langFile);
          images[lang] = fs.existsSync(candidate) ? candidate : path.join(refDir, file);
        } else {
          // Old-format: same filename across all language folders
          const candidate = path.join(langDir, file);
          images[lang] = fs.existsSync(candidate) ? candidate : path.join(refDir, file);
        }
      }

      // Rarity: prefer filename for newer sets, fallback to tcgdex
      const rarity = rarityFromFilename(file) ?? tcgdexRarities[i] ?? '?';

      allCards.push({
        uid:     `${set.id}-${i + 1}`,
        set:     set.id,
        setName: set.name,
        num:     i + 1,
        rarity,
        names: {
          zh: namesByLang.zh_TW[i] ?? '',
          ja: namesByLang.ja_JP[i] ?? '',
          en: namesByLang.en_US[i] ?? '',
        },
        images,
      });
    }

    console.log(`  → Added ${localFiles.length} card records`);
  }

  const db = {
    generated: new Date().toISOString(),
    total:     allCards.length,
    cards:     allCards,
  };

  fs.writeFileSync(OUTPUT, JSON.stringify(db));
  console.log(`\n✅  Done! Saved ${allCards.length} cards to ${path.relative(process.cwd(), OUTPUT)}`);
}

buildDatabase().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
