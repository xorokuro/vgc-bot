'use strict';

/**
 * scripts/validate-txt.js
 *
 * Parses all 16 PTCGP .txt files and reports anomalies:
 *   a) Duplicate card IDs with CONFLICTING data within same language section
 *   b) Cards missing from one language section but present in another
 *   c) Card count mismatches between sections
 *   d) Cards where ZH name looks like English (Latin chars only)
 *   e) Cards where ZH section has Japanese kana names (wrong language)
 *   f) Name/type mismatches (same card, different type across sections)
 */

const fs   = require('fs');
const path = require('path');

// ── Constants ─────────────────────────────────────────────────────────────────

const TXT_DIR = 'C:/Users/sagen/Desktop/PTCGP';

const SETS = [
  'A1','A1a','A2','A2a','A2b',
  'A3','A3a','A3b',
  'A4','A4a','A4b',
  'B1','B1a','B2','B2a','B2b',
];

const RARITIES = new Set([
  'C','U','R','RR','AR','SR','SAR','IM','S','SSR','UR',
  'PROMO-A','PROMO-B','PR',
]);

const EN_TYPES = new Set([
  'Grass','Fire','Water','Lightning','Psychic',
  'Fighting','Darkness','Metal','Dragon','Colorless',
]);
// Includes variants: 火=Fire, 無=Colorless
const ZH_TYPES = new Set(['草','炎','火','水','雷','超','鬥','惡','鋼','龍','無色','無']);
const JA_TYPES = new Set(['草','炎','水','雷','超','闘','悪','鋼','龍','無色']);

// Allow lowercase suffix (A1a, A2b, B2a etc)
const CARD_ID_RE = /^[A-Z][A-Z0-9a-z]+-\d+$/;

// ── Language detection ────────────────────────────────────────────────────────

/**
 * Detect language from the section header row (multi-column header with tabs).
 */
function detectHeaderLang(line) {
  if (/^Card #1\t/.test(line) && line.split('\t').length >= 3)     return 'en';
  if (/^第 1 張卡\t/.test(line) && line.split('\t').length >= 3)   return 'zh';
  if (/^1枚目\t/.test(line) && line.split('\t').length >= 3)       return 'ja';
  return null;
}

/** Detect language from a single probability data line. */
function detectProbLang(line) {
  if (/^Card #\d+\t/.test(line))     return 'en';
  if (/^第 \d+ 張卡\t/.test(line))   return 'zh';
  if (/^\d+枚目\t/.test(line))       return 'ja';
  return null;
}

// ── Parser ────────────────────────────────────────────────────────────────────

/**
 * Split file lines into per-language regions.
 * Strategy: locate multi-column header rows to detect where each language starts.
 * All sub-packs of the same language are merged into one region.
 *
 * Returns array of { lang, lines[] } in file order.
 */
function splitIntoSections(allLines) {
  const headerPositions = [];
  for (let i = 0; i < allLines.length; i++) {
    const lang = detectHeaderLang(allLines[i]);
    if (lang) headerPositions.push({ lang, pos: i });
  }

  if (headerPositions.length === 0) return [];

  // Find first occurrence of each language to determine region order
  const firstByLang = {};
  for (const h of headerPositions) {
    if (!(h.lang in firstByLang)) firstByLang[h.lang] = h.pos;
  }

  // Sort languages by first appearance
  const langOrder = Object.entries(firstByLang)
    .sort((a, b) => a[1] - b[1])
    .map(([lang]) => lang);

  // Each language's region: from its first header to the next language's first header
  const sections = [];
  for (let li = 0; li < langOrder.length; li++) {
    const lang           = langOrder[li];
    const start          = firstByLang[lang];
    const nextLangStart  = li + 1 < langOrder.length
      ? firstByLang[langOrder[li + 1]]
      : allLines.length;

    sections.push({
      lang,
      lines: allLines.slice(start, nextLangStart),
    });
  }

  return sections;
}

/**
 * Parse a language section into card records.
 * Deduplicates by ID (same card in multiple sub-packs).
 *
 * Returns Map<id, { id, altIds[], rarityCode, type, name }>.
 */
function parseSection(lines, lang) {
  const typeSet = lang === 'en' ? EN_TYPES : (lang === 'zh' ? ZH_TYPES : JA_TYPES);
  const seen    = new Map(); // id → card
  const conflicts = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();

    if (!CARD_ID_RE.test(line)) {
      i++;
      continue;
    }

    // Found a card ID — collect all consecutive IDs
    const ids = [line];
    i++;
    while (i < lines.length && CARD_ID_RE.test(lines[i].trim())) {
      ids.push(lines[i].trim());
      i++;
    }

    const primaryId = ids[0];
    const altIds    = ids.slice(1);

    // Collect rarity lines
    const rarities = [];
    while (i < lines.length && RARITIES.has(lines[i].trim())) {
      rarities.push(lines[i].trim());
      i++;
    }

    if (rarities.length === 0) continue;

    const rarityCode = rarities[0]; // canonical rarity = first rarity token

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

    // Doubled name on single line (e.g. "MistyMisty" → "Misty")
    const chars = [...name];
    if (chars.length > 0 && chars.length % 2 === 0) {
      const half  = chars.length / 2;
      const first = chars.slice(0, half).join('');
      const sec   = chars.slice(half).join('');
      if (first === sec) name = first;
    }

    // For Pokémon, second line is duplicate name — skip it
    if (type !== null && i < lines.length && lines[i].trim() === name) {
      i++;
    }

    // Skip probability lines + blank lines
    while (i < lines.length && lines[i].trim() !== '' && !CARD_ID_RE.test(lines[i].trim())) {
      i++;
    }

    const card = { id: primaryId, altIds, rarityCode, type, name };

    if (seen.has(primaryId)) {
      const existing = seen.get(primaryId);
      // Check for conflicting data
      if (existing.name !== name || existing.type !== type || existing.rarityCode !== rarityCode) {
        conflicts.push({
          id: primaryId,
          a: existing,
          b: card,
        });
      }
      // Always keep first occurrence (deduplicate)
    } else {
      seen.set(primaryId, card);
    }
  }

  return { cards: [...seen.values()], conflicts };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isLatinOnly(str) {
  return /^[\x20-\x7E\u00C0-\u024F]+$/.test(str);
}

function hasKana(str) {
  return /[\u3040-\u309F\u30A0-\u30FF]/.test(str);
}

const ZH_TYPE_TO_EN = {
  '草': 'Grass', '炎': 'Fire', '火': 'Fire', '水': 'Water', '雷': 'Lightning',
  '超': 'Psychic', '鬥': 'Fighting', '惡': 'Darkness', '鋼': 'Metal',
  '龍': 'Dragon', '無色': 'Colorless', '無': 'Colorless',
};

// ── Main ──────────────────────────────────────────────────────────────────────

const allIssues = [];
let totalCardsEN = 0;
let totalIssues  = 0;

function report(setId, issue) {
  allIssues.push(`[${setId}] ${issue}`);
  totalIssues++;
}

for (const setId of SETS) {
  const txtPath = path.join(TXT_DIR, `${setId}.txt`);
  if (!fs.existsSync(txtPath)) {
    report(setId, `MISSING FILE: ${txtPath}`);
    continue;
  }

  const raw   = fs.readFileSync(txtPath, 'utf8');
  const lines = raw.split('\n').map(l => l.replace(/\r$/, ''));

  const sections = splitIntoSections(lines);

  if (sections.length !== 3) {
    report(setId, `Expected 3 language sections, found ${sections.length} (langs: ${sections.map(s => s.lang).join(', ')})`);
  }

  const byLang = {};
  for (const sec of sections) {
    const { cards, conflicts } = parseSection(sec.lines, sec.lang);
    byLang[sec.lang] = cards;
    if (sec.lang === 'en') totalCardsEN += cards.length;

    // (a) Duplicate IDs with conflicting data
    for (const c of conflicts) {
      report(setId, `[${sec.lang.toUpperCase()}] Conflicting duplicate ${c.id}: name="${c.a.name}"↔"${c.b.name}" type="${c.a.type}"↔"${c.b.type}"`);
    }
  }

  const langs = Object.keys(byLang);

  // Build ID sets per language
  const idSets = {};
  for (const [lang, cards] of Object.entries(byLang)) {
    idSets[lang] = new Set(cards.map(c => c.id));
  }

  // (b) Cards missing from one section
  if (langs.length === 3) {
    const allIds = new Set([
      ...(idSets.en ?? []),
      ...(idSets.zh ?? []),
      ...(idSets.ja ?? []),
    ]);

    for (const id of allIds) {
      const missing = langs.filter(l => !idSets[l]?.has(id));
      if (missing.length > 0) {
        report(setId, `Card ${id} missing from [${missing.map(l => l.toUpperCase()).join(', ')}]`);
      }
    }

    // (c) Count mismatches
    const counts = langs.map(l => byLang[l].length);
    if (counts[0] !== counts[1] || counts[1] !== counts[2]) {
      report(setId, `Section count mismatch: ${langs.map((l, i) => `${l.toUpperCase()}=${counts[i]}`).join(', ')}`);
    }
  }

  // (d) (e) (f) — Cross-language checks on ZH section
  const zhCards = byLang['zh'] ?? [];
  const enCards = byLang['en'] ?? [];
  const enById  = new Map(enCards.map(c => [c.id, c]));

  for (const zhCard of zhCards) {
    // (d) ZH name is Latin-only
    if (isLatinOnly(zhCard.name)) {
      report(setId, `[ZH] Card ${zhCard.id} has Latin-only name: "${zhCard.name}"`);
    }

    // (e) ZH name has kana
    if (hasKana(zhCard.name)) {
      report(setId, `[ZH] Card ${zhCard.id} has kana in ZH name: "${zhCard.name}"`);
    }

    // (f) Type mismatch ZH ↔ EN
    const enCard = enById.get(zhCard.id);
    if (enCard) {
      const zhHasType = zhCard.type !== null;
      const enHasType = enCard.type !== null;

      if (zhHasType !== enHasType) {
        report(setId, `Card ${zhCard.id} category mismatch: ZH type="${zhCard.type}", EN type="${enCard.type}"`);
      } else if (zhHasType && enHasType) {
        const zhTypeEn = ZH_TYPE_TO_EN[zhCard.type] ?? zhCard.type;
        if (zhTypeEn !== enCard.type) {
          report(setId, `Card ${zhCard.id} type mismatch: ZH="${zhCard.type}" (→${zhTypeEn}) EN="${enCard.type}"`);
        }
      }
    }
  }

  const setIssueCount = allIssues.filter(x => x.startsWith(`[${setId}]`)).length;
  const counts = langs.map(l => `${l.toUpperCase()}:${byLang[l]?.length ?? 0}`).join(', ');
  const status  = setIssueCount === 0 ? '✓ OK' : `⚠ ${setIssueCount} issue(s)`;
  console.log(`${setId.padEnd(4)} — [${counts}] — ${status}`);
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(60));
console.log(`Total EN cards (deduplicated): ${totalCardsEN}`);
console.log(`Total issues found:            ${totalIssues}`);

if (allIssues.length > 0) {
  console.log('\n── Issues ──────────────────────────────────────────────────');
  for (const issue of allIssues) {
    console.log('  ' + issue);
  }
} else {
  console.log('\n✓ No issues found.');
}
