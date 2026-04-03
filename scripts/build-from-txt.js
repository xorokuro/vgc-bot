'use strict';

/**
 * scripts/build-from-txt.js
 *
 * Parses all 16 PTCGP .txt files and builds data/ptcgp_cards.json.
 *
 * Card ID format in output: SETID-NNN (3-digit zero-padded).
 * For A4b reprints: uid = A4b-NNN, images keyed by original ID.
 */

const fs   = require('fs');
const path = require('path');

// ── Constants ─────────────────────────────────────────────────────────────────

const TXT_DIR  = 'C:/Users/sagen/Desktop/PTCGP';
const OUT_PATH = path.join(__dirname, '../data/ptcgp_cards.json');

const SET_INFO = [
  { id: 'A1',  dir: 'A1 - Genetic Apex',             name: 'Genetic Apex' },
  { id: 'A1a', dir: 'A1a - Mythical Island',          name: 'Mythical Island' },
  { id: 'A2',  dir: 'A2 - Space-Time Smackdown',      name: 'Space-Time Smackdown' },
  { id: 'A2a', dir: 'A2a - Triumphant Light',         name: 'Triumphant Light' },
  { id: 'A2b', dir: 'A2b - Shining Rivalry',          name: 'Shining Rivalry' },
  { id: 'A3',  dir: 'A3 - Celestial Guardians',       name: 'Celestial Guardians' },
  { id: 'A3a', dir: 'A3a - Extradimensional Crisis',  name: 'Extradimensional Crisis' },
  { id: 'A3b', dir: 'A3b - Eevee Groove',             name: 'Eevee Groove' },
  { id: 'A4',  dir: 'A4 - Wisdom of Sea and Sky',     name: 'Wisdom of Sea and Sky' },
  { id: 'A4a', dir: 'A4a Secluded Springs',            name: 'Secluded Springs' },
  { id: 'A4b', dir: 'A4b - Deluxe Pack ex',           name: 'Deluxe Pack ex' },
  { id: 'B1',  dir: 'B1 - Mega Rising',               name: 'Mega Rising' },
  { id: 'B1a', dir: 'B1a - Crimson Blaze',            name: 'Crimson Blaze' },
  { id: 'B2',  dir: 'B2 - Fantastical Parade',        name: 'Fantastical Parade' },
  { id: 'B2a', dir: 'B2a - Paldean Sweets',           name: 'Paldean Sweets' },
  { id: 'B2b', dir: 'B2b - Mega Shine',               name: 'Mega Shine' },
];

const RARITIES = new Set([
  'C','U','R','RR','AR','SR','SAR','IM','S','SSR','UR',
  'PROMO-A','PROMO-B','PR',
]);

const RARITY_SYMBOL = {
  C:   '◇',
  U:   '◇◇',
  R:   '◇◇◇',
  RR:  '◇◇◇◇',
  AR:  '☆',
  SR:  '☆☆',
  SAR: '☆☆☆',
  IM:  '♛',
  S:   '✦',
  SSR: '✦✦',
  UR:  '👑',
};

// EN types
const EN_TYPES = new Set([
  'Grass','Fire','Water','Lightning','Psychic',
  'Fighting','Darkness','Metal','Dragon','Colorless',
]);

// ZH types — includes variants: 火=Fire, 無=Colorless
const ZH_TYPES = new Set(['草','炎','火','水','雷','超','鬥','惡','鋼','龍','無色','無']);

// JA types — includes variant 无 just in case
const JA_TYPES = new Set(['草','炎','水','雷','超','闘','悪','鋼','龍','無色']);

// Normalize any type variant → English canonical name
const TYPE_NORMALIZE = {
  // English
  'Grass':     'Grass',
  'Fire':      'Fire',
  'Water':     'Water',
  'Lightning': 'Lightning',
  'Electric':  'Lightning',
  'Thunder':   'Lightning',
  'Psychic':   'Psychic',
  'Fighting':  'Fighting',
  'Darkness':  'Darkness',
  'Dark':      'Darkness',
  'Metal':     'Metal',
  'Steel':     'Metal',
  'Dragon':    'Dragon',
  'Colorless': 'Colorless',
  'Normal':    'Colorless',
  // ZH
  '草':  'Grass',
  '炎':  'Fire',
  '火':  'Fire',
  '水':  'Water',
  '雷':  'Lightning',
  '超':  'Psychic',
  '鬥':  'Fighting',
  '惡':  'Darkness',
  '鋼':  'Metal',
  '龍':  'Dragon',
  '無色': 'Colorless',
  '無':  'Colorless',
  // JA
  '闘':  'Fighting',
  '悪':  'Darkness',
};

const CARD_ID_RE = /^[A-Z][A-Z0-9a-z]+-\d+$/;

// ── Language detection ────────────────────────────────────────────────────────

function detectHeaderLang(line) {
  if (/^Card #1\t/.test(line) && line.split('\t').length >= 3)     return 'en';
  if (/^第 1 張卡\t/.test(line) && line.split('\t').length >= 3)   return 'zh';
  if (/^1枚目\t/.test(line) && line.split('\t').length >= 3)       return 'ja';
  return null;
}

function detectProbLang(line) {
  if (/^Card #\d+\t/.test(line))     return 'en';
  if (/^第 \d+ 張卡\t/.test(line))   return 'zh';
  if (/^\d+枚目\t/.test(line))       return 'ja';
  return null;
}

// ── Parser ────────────────────────────────────────────────────────────────────

/**
 * Split file lines into per-language regions (merged across sub-packs).
 */
function splitIntoSections(allLines) {
  const headerPositions = [];
  for (let i = 0; i < allLines.length; i++) {
    const lang = detectHeaderLang(allLines[i]);
    if (lang) headerPositions.push({ lang, pos: i });
  }

  if (headerPositions.length === 0) return [];

  const firstByLang = {};
  for (const h of headerPositions) {
    if (!(h.lang in firstByLang)) firstByLang[h.lang] = h.pos;
  }

  const langOrder = Object.entries(firstByLang)
    .sort((a, b) => a[1] - b[1])
    .map(([lang]) => lang);

  return langOrder.map((lang, li) => {
    const start         = firstByLang[lang];
    const nextLangStart = li + 1 < langOrder.length
      ? firstByLang[langOrder[li + 1]]
      : allLines.length;
    return { lang, lines: allLines.slice(start, nextLangStart) };
  });
}

/**
 * Parse a language section.
 * Returns Map<primaryId, { id, altIds[], rarityCode, type, name }>.
 * Deduplicates by primaryId (same card in multiple sub-packs → keep first).
 */
function parseSection(lines, lang) {
  const typeSet = lang === 'en' ? EN_TYPES : (lang === 'zh' ? ZH_TYPES : JA_TYPES);
  const seen    = new Map();

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();

    if (!CARD_ID_RE.test(line)) {
      i++;
      continue;
    }

    // Collect all consecutive IDs
    const ids = [line];
    i++;
    while (i < lines.length && CARD_ID_RE.test(lines[i].trim())) {
      ids.push(lines[i].trim());
      i++;
    }

    const primaryId = ids[0];
    const altIds    = ids.slice(1);

    // Rarity lines
    const rarities = [];
    while (i < lines.length && RARITIES.has(lines[i].trim())) {
      rarities.push(lines[i].trim());
      i++;
    }

    if (rarities.length === 0) continue;

    const rarityCode = rarities[0];

    // Optional type
    let type = null;
    if (i < lines.length && typeSet.has(lines[i].trim())) {
      type = lines[i].trim();
      i++;
    }

    // Name
    if (i >= lines.length) continue;
    let name = lines[i].trim();
    i++;

    // Doubled name on single line → take first half
    const chars = [...name];
    if (chars.length > 0 && chars.length % 2 === 0) {
      const half  = chars.length / 2;
      const first = chars.slice(0, half).join('');
      const sec   = chars.slice(half).join('');
      if (first === sec) name = first;
    }

    // For Pokémon, second line is duplicate name → skip
    if (type !== null && i < lines.length && lines[i].trim() === name) {
      i++;
    }

    // Skip probability / tab lines / blank lines
    while (
      i < lines.length &&
      (lines[i].trim() === '' ||
       detectProbLang(lines[i]) !== null ||
       lines[i].includes('\t'))
    ) {
      i++;
    }

    if (!seen.has(primaryId)) {
      seen.set(primaryId, { id: primaryId, altIds, rarityCode, type, name });
    }
  }

  return seen;
}

// ── Image helpers ─────────────────────────────────────────────────────────────

/** Build new-format image paths (SETID-NNN.png). */
function resolveNewFormatImages(setDir, imageId) {
  const base = `${TXT_DIR}/${setDir}`;
  return {
    zh_TW: `${base}/zh_TW/${imageId}.png`,
    ja_JP: `${base}/ja_JP/${imageId}.png`,
    en_US: `${base}/en_US/${imageId}.png`,
  };
}

/**
 * Check if a set's zh_TW folder uses new-format (SETID-NNN.png) images.
 * Returns false if files are old-format (cPK_10_... etc.)
 */
function isNewFormatSet(setDir) {
  const zhDir = `${TXT_DIR}/${setDir}/zh_TW`;
  if (!fs.existsSync(zhDir)) return true; // assume new, will warn later
  const files = fs.readdirSync(zhDir).filter(f => f.endsWith('.png'));
  return files.length === 0 || files.some(f => /^[A-Z].*-\d{3}\.png$/.test(f));
}

/**
 * Sort old-format card files in official card-number order:
 * cPK_10_ → cTR_10_ → cPK_20_ AR → cPK_20_ _00 → cTR_20_ → cPK_20_ _01 → cPK_90_ → cTR_10_ true-UT
 *
 * NOTE: Newer sets (A2a, A2b, etc.) embed the language in every filename ending with
 * _zh_TW_UT.png. That trailing _UT is a language-format marker, NOT an "alternate-art UT"
 * flag. True alternate-art UT files end with _UT.png but do NOT have the language code
 * embedded (e.g. cTR_10_000001_00_ITEM_U_UT.png in very old sets).
 */
function sortOldFormat(files) {
  // Detect true alternate-art UT: ends with _UT.png but NOT with a language-embedded suffix.
  const isTrueUT = f => f.endsWith('_UT.png') && !/_(?:zh_TW|ja_JP|en_US)_UT\.png$/.test(f);

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
  return files.slice().sort((a, b) => {
    const ga = group(a), gb = group(b);
    return ga !== gb ? ga - gb : a.localeCompare(b);
  });
}

/**
 * For old-format sets: get the sorted, deduplicated zh_TW card file list.
 * Removes promos (cPK_90_) and deduplicates UT/non-UT pairs.
 */
function getOldFormatZhFiles(setDir) {
  const zhDir = `${TXT_DIR}/${setDir}/zh_TW`;
  if (!fs.existsSync(zhDir)) return [];
  const all = fs.readdirSync(zhDir).filter(f => f.endsWith('.png'));

  // Exclude promo cards (cPK_90_) — these are not in the main set card list
  const nonPromo = all.filter(f => !f.startsWith('cPK_90_'));

  // Deduplicate: for each (prefix_series_globalid_variant) key, prefer non-UT over UT.
  // Only files ending with bare _UT.png (not _zh_TW_UT.png etc.) are true alternate-art UT.
  const isTrueUT = f => f.endsWith('_UT.png') && !/_(?:zh_TW|ja_JP|en_US)_UT\.png$/.test(f);
  const byKey = new Map();
  for (const f of nonPromo) {
    const parts = f.split('_');
    if (parts.length < 4) continue;
    const key = `${parts[0]}_${parts[1]}_${parts[2]}_${parts[3]}`;
    const isUT = isTrueUT(f);
    if (!byKey.has(key) || (!isUT && byKey.get(key).isUT)) {
      byKey.set(key, { file: f, isUT });
    }
  }

  const deduped = [...byKey.values()].map(v => v.file);
  return sortOldFormat(deduped);
}

/**
 * Build a (card-key → filename) map for an old-format language directory.
 * Card key = first 4 underscore-parts, e.g. "cPK_10_002820_00"
 * Prefers non-UT over UT when both exist.
 */
function buildOldFormatLangMap(setDir, lang) {
  const dir = `${TXT_DIR}/${setDir}/${lang}`;
  if (!fs.existsSync(dir)) return new Map();
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.png'));
  const map = new Map();
  for (const f of files) {
    const parts = f.split('_');
    if (parts.length < 4) continue;
    const key = `${parts[0]}_${parts[1]}_${parts[2]}_${parts[3]}`;
    const isUT = f.endsWith('_UT.png');
    if (!map.has(key) || (!isUT)) {
      map.set(key, f);
    }
  }
  return map;
}

// ── Main ──────────────────────────────────────────────────────────────────────

let totalCards    = 0;
let missingImages = 0;
const allCards    = [];

for (const { id: setId, dir, name: setName } of SET_INFO) {
  const txtPath = `${TXT_DIR}/${setId}.txt`;
  if (!fs.existsSync(txtPath)) {
    console.warn(`[WARN] Missing txt: ${txtPath}`);
    continue;
  }

  const raw   = fs.readFileSync(txtPath, 'utf8');
  const lines = raw.split('\n').map(l => l.replace(/\r$/, ''));

  const sections = splitIntoSections(lines);
  const byLang   = {};
  for (const sec of sections) {
    byLang[sec.lang] = parseSection(sec.lines, sec.lang);
  }

  // Use ZH as primary; fall back to EN, then JA
  const primaryMap = byLang.zh ?? byLang.en ?? byLang.ja ?? new Map();
  const enMap      = byLang.en ?? new Map();
  const jaMap      = byLang.ja ?? new Map();

  // Determine if this set uses new-format (SETID-NNN.png) or old-format (cPK_10_...) images
  const newFormat = isNewFormatSet(dir);

  // For old-format sets, build positional image maps
  let oldZhFiles = [], oldJaMap = new Map(), oldEnMap = new Map();
  if (!newFormat) {
    oldZhFiles = getOldFormatZhFiles(dir);
    oldJaMap   = buildOldFormatLangMap(dir, 'ja_JP');
    oldEnMap   = buildOldFormatLangMap(dir, 'en_US');
  }

  const setCards  = [];
  const addedUids = new Set();
  let   cardIdx   = 0; // positional index for old-format sets

  for (const [primaryId, zhCard] of primaryMap) {
    // ── Determine uid and imageId ──
    // Find the ID belonging to the current set among all IDs in the block
    const allIds = [primaryId, ...zhCard.altIds];
    const currentSetMatch = allIds.find(id => id.startsWith(`${setId}-`));

    let uid, imageId;

    if (currentSetMatch) {
      uid = currentSetMatch;
      // For image: try the current-set ID first, then fall back to original ID
      const setDir2 = `${TXT_DIR}/${dir}/zh_TW`;
      const paddedCurrent = (() => {
        const [s, n] = currentSetMatch.split('-');
        return `${s}-${String(parseInt(n, 10)).padStart(3, '0')}`;
      })();
      const paddedOriginal = (() => {
        const [s, n] = primaryId.split('-');
        return `${s}-${String(parseInt(n, 10)).padStart(3, '0')}`;
      })();
      if (fs.existsSync(`${setDir2}/${paddedCurrent}.png`)) {
        imageId = paddedCurrent;
      } else if (fs.existsSync(`${setDir2}/${paddedOriginal}.png`)) {
        imageId = paddedOriginal;
      } else {
        imageId = paddedCurrent; // will warn as missing
      }
    } else {
      // Primary ID doesn't belong to this set (shouldn't happen for well-formed data)
      uid     = primaryId;
      imageId = primaryId;
    }

    if (addedUids.has(uid)) continue;
    addedUids.add(uid);

    const enCard = enMap.get(primaryId);
    const jaCard = jaMap.get(primaryId);

    // Pad uid number to 3 digits
    const [uidSet, uidNumStr] = uid.split('-');
    const uidNum    = parseInt(uidNumStr, 10);
    const paddedUid = `${uidSet}-${String(uidNum).padStart(3, '0')}`;

    const zhName   = zhCard?.name ?? null;
    const enName   = enCard?.name ?? zhCard?.name ?? null;
    const jaName   = jaCard?.name ?? null;

    const rawType  = enCard?.type ?? zhCard?.type ?? jaCard?.type ?? null;
    const canonType = rawType ? (TYPE_NORMALIZE[rawType] ?? rawType) : null;
    const rarityCode = zhCard?.rarityCode ?? enCard?.rarityCode ?? 'C';

    // ── Build image paths ──
    let images;
    if (newFormat) {
      images = resolveNewFormatImages(dir, imageId);
    } else {
      // Old-format: use positional match against sorted zh_TW file list
      const zhFile = oldZhFiles[cardIdx] ?? null;
      if (zhFile) {
        const parts = zhFile.split('_');
        const key   = `${parts[0]}_${parts[1]}_${parts[2]}_${parts[3]}`;
        const jaFile = oldJaMap.get(key) ?? null;
        const enFile = oldEnMap.get(key) ?? null;
        const base   = `${TXT_DIR}/${dir}`;
        images = {
          zh_TW: zhFile ? `${base}/zh_TW/${zhFile}` : null,
          ja_JP: jaFile ? `${base}/ja_JP/${jaFile}` : null,
          en_US: enFile ? `${base}/en_US/${enFile}` : null,
        };
      } else {
        images = { zh_TW: null, ja_JP: null, en_US: null };
      }
      cardIdx++;
    }

    // Warn on missing images
    const missingPaths = Object.values(images).filter(p => !p || !fs.existsSync(p));
    if (missingPaths.length) {
      missingImages++;
      if (process.env.VERBOSE_IMAGES) {
        console.warn(`[WARN] Missing image for ${paddedUid}: ${missingPaths[0]}`);
      }
    }

    // For reprint sets (e.g. A4b), store the original UID so the enrichment
    // script can fetch HP from the original set when the reprint has no tcgdex entry.
    const originalUid = (() => {
      if (uid === primaryId) return undefined; // no reprint
      const [s, n] = primaryId.split('-');
      return `${s}-${String(parseInt(n, 10)).padStart(3, '0')}`;
    })();

    setCards.push({
      uid:          paddedUid,
      set:          setId,
      setName:      setName,
      num:          uidNum,
      rarity:       rarityCode,
      raritySymbol: RARITY_SYMBOL[rarityCode] ?? rarityCode,
      type:         canonType,
      category:     canonType ? 'Pokémon' : 'Trainer',
      hp:           null,
      weakness:     null,
      ...(originalUid ? { originalUid } : {}),
      names: { zh: zhName, ja: jaName, en: enName },
      images,
    });
  }

  // Sort by num
  setCards.sort((a, b) => a.num - b.num);
  allCards.push(...setCards);
  totalCards += setCards.length;
  console.log(`${setId.padEnd(4)} — ${setCards.length} cards`);
}

// ── Write output ──────────────────────────────────────────────────────────────

const output = {
  generated: new Date().toISOString(),
  count:     allCards.length,
  cards:     allCards,
};

const dataDir = path.dirname(OUT_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2), 'utf8');

console.log('\n' + '='.repeat(60));
console.log(`Total cards written: ${totalCards}`);
console.log(`Cards with missing images: ${missingImages}`);
console.log(`Output: ${OUT_PATH}`);
if (missingImages > 0) {
  console.log('Re-run with VERBOSE_IMAGES=1 to see which image paths are missing.');
}
