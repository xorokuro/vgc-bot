'use strict';

/**
 * scripts/build-web-dex.js
 *
 * Builds the self-contained data bundle for the standalone web dex
 * (web/index.html), written as `web/data.js`:
 *
 *     window.DEX = { meta, types, abilities, moves, pokemon };
 *
 * SOURCE = the Pokémon Champions roster only (NOT the full national dex):
 *   - data/pokedex_champion_db.json   species + forms (incl. Megas / regionals)
 *   - data/champion_moves_db.json      learnsets, keyed by national dex id
 *   - data/champion_roster.json        allowlist of "<dex>:<formKey>" that are
 *                                      actually available (from Serebii
 *                                      pokemonchampions/pokemon.shtml)
 *
 * Emitted as a JS assignment (not raw JSON) so the page can load it with a plain
 * <script src="data.js"> and work by double-clicking index.html (file://).
 * All names (Pokémon / moves / abilities / types) are tri-lingual: en/zh/ja.
 *
 * Run: node scripts/build-web-dex.js
 */

const fs   = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '../data');
const OUT  = path.join(__dirname, '../web/data.js');

const champ  = JSON.parse(fs.readFileSync(path.join(DATA, 'pokedex_champion_db.json'), 'utf8'));
const cMoves = JSON.parse(fs.readFileSync(path.join(DATA, 'champion_moves_db.json'), 'utf8'));
const roster = new Set(JSON.parse(fs.readFileSync(path.join(DATA, 'champion_roster.json'), 'utf8')));
// Tri-lingual overrides for Champions-specific custom abilities/moves (optional).
let overrides = { abilities: {}, moves: {} };
try { overrides = JSON.parse(fs.readFileSync(path.join(DATA, 'champion_overrides.json'), 'utf8')); } catch {}
// Extra battle-distinct forms + tri-lingual form-name overrides (optional).
let forms = { include: [], names: {} };
try { forms = JSON.parse(fs.readFileSync(path.join(DATA, 'champion_forms.json'), 'utf8')); } catch {}
const includeForms = new Set(forms.include || []);
const formNames    = forms.names || {};
const dropForms    = new Set(forms.drop || []);

// Pokémon Showdown HOME sprite slug (toID + form rules). Falls back to base species.
function toID(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
const tri    = JSON.parse(fs.readFileSync(path.join(DATA, 'trilingual.json'), 'utf8'));
const zhHant = JSON.parse(fs.readFileSync(path.join(DATA, 'zh-Hant.json'), 'utf8'));
const movesD = JSON.parse(fs.readFileSync(path.join(DATA, 'moves_sv_detailed.json'), 'utf8'));

// Mirror dexSearch.js toApiId so move/ability ids resolve in the search engine.
function toApiId(s) {
  return s.toLowerCase().replace(/\s+/g, '-').replace(/[‘’',.:]/g, '');
}
function titleFromId(id) {
  return id.split('-').map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(' ');
}

// Which roster slot does a champion-db entry occupy? Must match champion_roster.json keys.
function formKey(e) {
  if (e.form_id === 0) return 'base';
  const fn = (e.form_name || '').toLowerCase();
  if (fn.includes('mega')) {
    if (fn.includes(' x') || fn.endsWith('-x')) return 'mega-x';
    if (fn.includes(' y') || fn.endsWith('-y')) return 'mega-y';
    return 'mega';
  }
  if (fn.includes('alola'))   return 'alola';
  if (fn.includes('galar'))   return 'galar';
  if (fn.includes('hisui'))   return 'hisui';
  if (fn.includes('paldea'))  return 'paldea';
  if (fn.includes('eternal')) return 'eternal';
  return 'other';
}

// ── 18 types, tri-lingual (zh from zh-Hant.types, ja hard-coded) ───────────────
const TYPE_JA = {
  normal: 'ノーマル', fire: 'ほのお', water: 'みず', electric: 'でんき', grass: 'くさ',
  ice: 'こおり', fighting: 'かくとう', poison: 'どく', ground: 'じめん', flying: 'ひこう',
  psychic: 'エスパー', bug: 'むし', rock: 'いわ', ghost: 'ゴースト', dragon: 'ドラゴン',
  dark: 'あく', steel: 'はがね', fairy: 'フェアリー',
};
const types = {};
for (const en of Object.keys(TYPE_JA)) {
  const title = en[0].toUpperCase() + en.slice(1);
  types[en] = { en, zh: (zhHant.types || {})[title] || en, ja: TYPE_JA[en] };
}

// ── Tri-lingual lookup helpers ─────────────────────────────────────────────────
function buildApiIdToJa(section) {
  const map = {};
  for (const v of Object.values(section || {})) if (v && v.en && v.ja) map[toApiId(v.en)] = v.ja;
  return map;
}
const moveIdToJa    = buildApiIdToJa(tri.move);
const abilityIdToJa = buildApiIdToJa(tri.ability);

function buildApiIdToZhEn(section) {
  const idToZh = {}, idToEn = {};
  for (const [en, zh] of Object.entries(section || {})) {
    const id = toApiId(en);
    idToEn[id] = en;
    if (zh) idToZh[id] = zh;
  }
  return { idToZh, idToEn };
}
const moveZE    = buildApiIdToZhEn(zhHant.moves);
const abilityZE = buildApiIdToZhEn(zhHant.abilities);

// moves_sv_detailed: keyed by lowercase English move name; carries type + category.
const moveDetailById = {};
for (const v of Object.values(movesD)) {
  if (!v || !v.name || !v.name.en) continue;
  const id = toApiId(v.name.en);
  moveDetailById[id] = {
    ja:     v.name.ja || null,
    zh:     v.name.zh || null,
    typeEn: (v.type && v.type.en ? v.type.en : '').toLowerCase() || null,
    catEn:  (v.category && v.category.en ? v.category.en : '').toLowerCase() || null,
  };
}

// Base species name per dex (form 0, with any "(Form)" descriptor stripped) → sprite slug base.
const baseNameByDex = {};
for (const e of Object.values(champ)) {
  if (e.form_id === 0 || !baseNameByDex[e.dex_id]) {
    baseNameByDex[e.dex_id] = (e.name_en || '').replace(/\s*\(.*\)\s*$/, '');
  }
}
function spriteSlug(e) {
  const base = toID(baseNameByDex[e.dex_id] || e.name_en);
  const fn = (e.form_name || '').toLowerCase();
  if (e.form_id === 0 || !fn) return base;
  if (fn.includes('mega')) {
    if (fn.includes(' x') || fn.endsWith('-x')) return base + '-megax';
    if (fn.includes(' y') || fn.endsWith('-y')) return base + '-megay';
    return base + '-mega';
  }
  if (fn.includes('alola')) return base + '-alola';
  if (fn.includes('galar')) return base + '-galar';
  if (fn.includes('hisui')) return base + '-hisui';
  if (fn.includes('paldea')) {
    if (fn.includes('blaze')) return base + '-paldeablaze';
    if (fn.includes('aqua'))  return base + '-paldeaaqua';
    return base + '-paldeacombat';
  }
  if (fn.includes('eternal')) return base + '-eternal';
  if (fn.includes('heat'))  return 'rotom-heat';
  if (fn.includes('wash'))  return 'rotom-wash';
  if (fn.includes('frost')) return 'rotom-frost';
  if (fn.includes('fan'))   return 'rotom-fan';
  if (fn.includes('mow'))   return 'rotom-mow';
  if (fn.includes('midnight')) return base + '-midnight';
  if (fn.includes('dusk'))     return base + '-dusk';
  if (fn.includes('small')) return base + '-small';
  if (fn.includes('large')) return base + '-large';
  if (fn.includes('jumbo')) return base + '-super';
  if (fn === 'female') return base + '-f';
  return base; // default/in-battle forms share the base sprite
}

// ── Walk the roster, collecting used moves / abilities ─────────────────────────
const usedMoves = new Set();      // move ids
const usedAbilities = new Set();
const pokemon = [];

for (const e of Object.values(champ)) {
  const formId = e.dex_id + ':' + e.form_name;
  if (!roster.has(e.dex_id + ':' + formKey(e)) && !includeForms.has(formId)) continue;

  // Learnset is keyed by national dex id; all forms inherit the base list
  // (same behaviour as the bot's champion search).
  const moveNames = cMoves[String(e.dex_id)] || [];
  const moveIds = moveNames.map(n => {
    const id = toApiId(n);
    if (!moveZE.idToEn[id]) moveZE.idToEn[id] = n; // keep champion display name
    usedMoves.add(id);
    return id;
  });

  const abilities = (e.abilities || []).map(a => ({ id: a.name, hidden: !!a.is_hidden }));
  abilities.forEach(a => usedAbilities.add(a.id));

  const s = e.stats || {};
  // Tri-lingual name override for this form (drops the grey English form label).
  const nameOv = formNames[formId];
  const name = {
    en: (nameOv && nameOv.en) || e.name_en || String(e.dex_id),
    zh: (nameOv && nameOv.zh) || e.name_zh || e.name_en || '',
    ja: (nameOv && nameOv.ja) || e.name_ja || e.name_en || '',
  };
  // Drop redundant single/default-form suffixes: "Castform (Normal)" -> "Castform".
  const dropped = dropForms.has(formId);
  if (dropped) {
    name.en = name.en.replace(/\s*\([^)]*\)\s*$/, '');
    name.zh = name.zh.replace(/（[^）]*）\s*$/, '').replace(/\s*\([^)]*\)\s*$/, '');
    name.ja = name.ja.replace(/（[^）]*）\s*$/, '').replace(/\s*\([^)]*\)\s*$/, '');
  }
  pokemon.push({
    dex: e.dex_id,
    species_id: e.dex_id,
    form: (nameOv || dropped) ? null : (e.form_name || null),
    isDefault: e.form_id === 0,
    sprite: spriteSlug(e),
    spriteBase: toID(baseNameByDex[e.dex_id] || e.name_en),
    name,
    types: e.types_en || [],
    abilities,
    moves: moveIds,
    stats: {
      hp: s.hp || 0, atk: s.attack || 0, def: s.defense || 0,
      spa: s['special-attack'] || 0, spd: s['special-defense'] || 0, spe: s.speed || 0,
    },
    bst: e.bst || Object.values(s).reduce((a, v) => a + (v || 0), 0),
  });
}

// ── Moves dict ─────────────────────────────────────────────────────────────────
const moves = {};
for (const id of usedMoves) {
  const det = moveDetailById[id] || {};
  const en = moveZE.idToEn[id] || titleFromId(id);
  moves[id] = {
    en,
    zh: moveZE.idToZh[id] || det.zh || en,
    ja: det.ja || moveIdToJa[id] || en,
    type: det.typeEn || null,
    cat:  det.catEn  || null,
  };
}

// ── Abilities dict ───────────────────────────────────────────────────────────
const abilities = {};
for (const id of usedAbilities) {
  abilities[id] = {
    en: abilityZE.idToEn[id] || titleFromId(id),
    zh: abilityZE.idToZh[id] || abilityZE.idToEn[id] || titleFromId(id),
    ja: abilityIdToJa[id] || abilityZE.idToEn[id] || titleFromId(id),
  };
}

// ── Apply Champions custom overrides (highest priority) ────────────────────────
let ovApplied = 0, ovUnused = 0;
for (const [id, v] of Object.entries(overrides.abilities || {})) {
  if (!abilities[id]) { ovUnused++; continue; }
  if (v.en) abilities[id].en = v.en;
  if (v.zh) abilities[id].zh = v.zh;
  if (v.ja) abilities[id].ja = v.ja;
  ovApplied++;
}
for (const [id, v] of Object.entries(overrides.moves || {})) {
  if (!moves[id]) { ovUnused++; continue; }
  if (v.en) moves[id].en = v.en;
  if (v.zh) moves[id].zh = v.zh;
  if (v.ja) moves[id].ja = v.ja;
  if (v.type) moves[id].type = v.type;
  if (v.cat)  moves[id].cat  = v.cat;
  ovApplied++;
}

const bundle = {
  meta: {
    game: 'champion',
    label: { en: 'Pokémon Champions', zh: 'Pokémon Champions', ja: 'ポケモンチャンピオンズ' },
    generated: new Date().toISOString(),
    counts: { pokemon: pokemon.length, moves: Object.keys(moves).length, abilities: Object.keys(abilities).length },
  },
  types,
  abilities,
  moves,
  pokemon,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, 'window.DEX = ' + JSON.stringify(bundle) + ';\n', 'utf8');

const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`✅  web/data.js written — ${kb} KB  (Pokémon Champions roster)`);
console.log(`    pokemon: ${pokemon.length}  moves: ${bundle.meta.counts.moves}  abilities: ${bundle.meta.counts.abilities}`);
const noType = Object.keys(moves).filter(id => !moves[id].type).length;
console.log(`    moves without type/category data (type-cat filter can't match them): ${noType}`);
console.log(`    custom overrides applied: ${ovApplied}${ovUnused ? `  (${ovUnused} unused — not in roster)` : ''}`);
const stillFb = Object.keys(abilities).filter(id => abilities[id].zh === abilities[id].en).length;
console.log(`    abilities still untranslated (zh==en): ${stillFb}`);
