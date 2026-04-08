'use strict';

/**
 * build_champion_db.js
 *
 * Parse the Pokémon Champion datamine (gistfile1.txt) and output
 * data/pokedex_champion_db.json for use by the /pokedex champion command.
 *
 * Run: node build_champion_db.js
 */

const fs   = require('fs');
const path = require('path');

const DATAMINE_PATH = 'C:/Users/sagen/Downloads/Compressed/e34f3c32ebbcc9ccf84c65f9133cbe25-2dca48cbf459b14071cda9d1263aef29a0eece13/e34f3c32ebbcc9ccf84c65f9133cbe25-2dca48cbf459b14071cda9d1263aef29a0eece13/gistfile1.txt';
const TRI_PATH      = path.join(__dirname, 'data/trilingual.json');
const MANUAL_PATH   = path.join(__dirname, 'data/manual.json');
const OUT_PATH      = path.join(__dirname, 'data/pokedex_champion_db.json');

const tri    = JSON.parse(fs.readFileSync(TRI_PATH, 'utf8'));
const manual = JSON.parse(fs.readFileSync(MANUAL_PATH, 'utf8'));

const triPokemon   = tri.pokemon   || {};
const manualPokemon = manual.pokemon || {};

// ── Type name → Chinese ────────────────────────────────────────────────────────
const TYPE_ZH = {
  normal: '一般', fire: '火', water: '水', grass: '草', electric: '電',
  ice: '冰', fighting: '格鬥', poison: '毒', ground: '地面', flying: '飛行',
  psychic: '超能力', bug: '蟲', rock: '岩石', ghost: '幽靈', dragon: '龍',
  dark: '惡', steel: '鋼', fairy: '妖精',
};

// ── Special-case dex_id+form_id → manual key overrides ────────────────────────
// Covers forms where the datamine name alone is ambiguous (Meowstic gender, etc.)
const FORM_KEY_OVERRIDE = {
  '678-0': 'meowstic',
  '678-1': 'meowstic-f',
  '678-2': 'meowstic-m-mega',
  '678-3': 'meowstic-f-mega',
  '801-2': 'magearna-mega',
  '801-3': 'magearna-original-mega',
  '978-3': 'tatsugiri-curly-mega',
  '978-4': 'tatsugiri-droopy-mega',
  '978-5': 'tatsugiri-stretchy-mega',
};

// ── Derive manual.json key from base name + form name ─────────────────────────
function deriveManualKey(baseName, formName, dexId, formId) {
  // Check override table first
  const overrideKey = `${dexId}-${formId}`;
  if (FORM_KEY_OVERRIDE[overrideKey]) return FORM_KEY_OVERRIDE[overrideKey];

  const base = baseName.toLowerCase().replace(/['']/g, '').replace(/ /g, '-');
  if (!formName) return base;

  const form = formName.toLowerCase();

  // Gender forms: "(Male)" = base, "(Female)" = base + "-f"
  if (form === 'male')   return base;
  if (form === 'female') return `${base}-f`;

  // Mega forms: "Mega Charizard X" → "charizard-mega-x"
  if (form.startsWith('mega ')) {
    const rest      = form.slice(5).trim();            // e.g. "charizard x" or "clefable"
    const withoutBase = rest.replace(base, '').trim(); // strip base name part
    return withoutBase ? `${base}-mega-${withoutBase.replace(/ /g, '-')}` : `${base}-mega`;
  }

  // Regional forms
  if (form.includes('alolan'))   return `${base}-alola`;
  if (form.includes('galarian')) return `${base}-galar`;
  if (form.includes('hisuian'))  return `${base}-hisui`;
  if (form.includes('paldean'))  return `${base}-paldea`;

  return null; // unrecognised — caller will fall back
}

// ── Parse a single data line ───────────────────────────────────────────────────
function parseLine(line) {
  if (line.startsWith('Type:')) {
    const types = line.replace('Type:', '').trim().split(' / ').map(t => t.toLowerCase());
    return { types_en: types };
  }
  if (line.startsWith('Base Stats:')) {
    const m = line.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)\.(\d+)\.(\d+)\s*\(BST:\s*(\d+)\)/);
    if (m) return {
      stats: {
        hp: +m[1], attack: +m[2], defense: +m[3],
        'special-attack': +m[4], 'special-defense': +m[5], speed: +m[6],
      },
      bst: +m[7],
    };
  }
  if (line.startsWith('Abilities:')) {
    const parts    = line.replace('Abilities:', '').trim().split(' / ');
    const abilities = [];
    const seen     = new Set();
    for (const part of parts) {
      const m = part.match(/^(.+?)\s+\(([12H])\)$/);
      if (!m) continue;
      const rawName = m[1].trim();
      if (rawName === 'N/A') continue;
      const norm = rawName.toLowerCase().replace(/ /g, '-');
      if (m[2] === 'H') {
        abilities.push({ name: norm, is_hidden: true });
      } else if (!seen.has(norm)) {
        seen.add(norm);
        abilities.push({ name: norm, is_hidden: false });
      }
    }
    return { abilities };
  }
  if (line.startsWith('Height:')) {
    const m = line.match(/([\d.]+)\s*m/);
    if (m) return { height_m: parseFloat(m[1]) };
  }
  if (line.startsWith('Weight:')) {
    const m = line.match(/([\d.]+)\s*kg/);
    if (m) return { weight_kg: parseFloat(m[1]) };
  }
  if (line.startsWith('Compatible Games:')) {
    const val = line.replace('Compatible Games:', '').trim();
    return { compatible_games: val === 'None' ? [] : val.split(', ') };
  }
  if (line.startsWith('Exp. Group:')) {
    return { exp_group: line.replace('Exp. Group:', '').trim() };
  }
  return null;
}

// ── Parse datamine ─────────────────────────────────────────────────────────────
const raw   = fs.readFileSync(DATAMINE_PATH, 'utf8');
const lines = raw.split('\n');
const db    = {};
let i = 0;

while (i < lines.length) {
  if (lines[i].trim() !== '===') { i++; continue; }
  i++;

  const nameLine = (lines[i] || '').trim(); i++;

  // Optional flags line
  let flagsStr = '';
  if ((lines[i] || '').trim().startsWith('Flags:')) {
    flagsStr = lines[i].trim().replace(/^Flags:\s*/, '');
    i++;
  }

  // Expect closing ===
  if ((lines[i] || '').trim() !== '===') { continue; }
  i++;

  // Parse name line: "NNNN-FF: BaseName (FormName)"
  const nameMatch = nameLine.match(/^(\d{4})-(\d{2}):\s+(.+?)(?:\s+\((.+)\))?$/);
  if (!nameMatch) continue;

  const dexId   = parseInt(nameMatch[1], 10);
  const formId  = parseInt(nameMatch[2], 10);
  const baseName = nameMatch[3].trim();
  const formName = nameMatch[4]?.trim() || null;
  const flags   = flagsStr ? flagsStr.split(', ').map(f => f.trim()) : [];

  // Skip purely decorative battle-form duplicates (Gigantamax duplicates in the dex)
  if (flags.includes('Hide In Number Sort') && flags.includes('Hide Model')) {
    // Consume data lines and continue
    while (i < lines.length && lines[i].trim() !== '' && lines[i].trim() !== '===') i++;
    continue;
  }

  // ── Name resolution ──────────────────────────────────────────────────────────
  const triEntry = triPokemon[String(dexId)];
  let nameZh = triEntry?.zh  || null;
  let nameJa = triEntry?.ja  || null;
  let nameEn = triEntry?.en  || baseName;

  // Resolve names via manual.json (covers Megas, regional forms, Farfetch'd, etc.)
  const hasOverride = !!FORM_KEY_OVERRIDE[`${dexId}-${formId}`];
  const mk = deriveManualKey(baseName, formName || '', dexId, formId);
  const manEntry = mk ? manualPokemon[mk] : null;
  if (manEntry) {
    nameZh = manEntry.zh || nameZh;
    nameJa = manEntry.ja || nameJa;
    nameEn = manEntry.en || nameEn;
  } else if (!hasOverride && (formId !== 0 || formName)) {
    // Fallback: append English form description to base name (only if no override)
    if (formName && !nameZh?.includes('（')) {
      nameZh = nameZh ? `${nameZh}（${formName}）` : null;
    }
    if (formName && nameEn && !nameEn.includes('(')) {
      nameEn = `${nameEn} (${formName})`;
    }
  }

  // ── Build entry ──────────────────────────────────────────────────────────────
  const entry = {
    name_en:   nameEn,
    name_zh:   nameZh,
    name_ja:   nameJa,
    dex_id:    dexId,
    form_id:   formId,
    form_name: formName,
    flags,
    types_en:         [],
    types_zh:         [],
    abilities:        [],
    stats:            {},
    bst:              0,
    height_m:         null,
    weight_kg:        null,
    exp_group:        null,
    compatible_games: [],
  };

  // Read data lines until empty line
  while (i < lines.length && lines[i].trim() !== '') {
    const parsed = parseLine(lines[i].trim());
    if (parsed) Object.assign(entry, parsed);
    i++;
  }

  entry.types_zh = entry.types_en.map(t => TYPE_ZH[t] || t);

  // Unique key: dex_id + form_id, but handle same-slot duplicates via form flags
  const flagSuffix = formName ? '' : flags.includes('Gigantamax') ? '-gmax' : '';
  const key = `${dexId}-${formId}${flagSuffix}`;
  db[key] = entry;
}

fs.writeFileSync(OUT_PATH, JSON.stringify(db, null, 2));
console.log(`✅  Written ${Object.keys(db).length} entries → ${OUT_PATH}`);
