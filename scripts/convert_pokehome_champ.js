'use strict';

// Converts a pokehome scrape JSON (English OCR format) into the bot's season data format.
// Usage: node scripts/convert_pokehome_champ.js <input.json> <output.json>

const fs   = require('fs');
const path = require('path');

const [,, inputFile, outputFile] = process.argv;
if (!inputFile || !outputFile) {
  console.error('Usage: node convert_pokehome_champ.js <input.json> <output.json>');
  process.exit(1);
}

const scraped = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
const tri     = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/trilingual.json'), 'utf8'));
const db      = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/pokedex_db.json'), 'utf8'));

// ── Build lookup maps ──────────────────────────────────────────────────────────

function buildEnToZh(triType) {
  const map = {};
  Object.values(tri[triType]).forEach(e => {
    if (e.en && e.zh) map[e.en.toLowerCase()] = e.zh;
  });
  return map;
}

const pokeMap    = buildEnToZh('pokemon');
const moveMap    = buildEnToZh('move');
const itemMap    = buildEnToZh('item');
const abilityMap = buildEnToZh('ability');
const natureMap  = buildEnToZh('nature');

// pokemon en → national dex id (try normalized key: lowercase, spaces→dashes)
const pokeEn2Id = {};
Object.values(db).forEach(e => {
  if (!e.name_en || !e.id) return;
  pokeEn2Id[e.name_en.toLowerCase()] = e.id;
  // also store by species base name (drop form suffix after first dash segment for multi-word names)
  const base = e.name_en.toLowerCase().replace(/-/g, ' ').split(' ')[0];
  if (!pokeEn2Id[base]) pokeEn2Id[base] = e.id;
});

function getPid(nameEn) {
  const key = nameEn.toLowerCase();
  if (pokeEn2Id[key]) return pokeEn2Id[key];
  // try with dashes instead of spaces
  const dashKey = key.replace(/ /g, '-');
  if (pokeEn2Id[dashKey]) return pokeEn2Id[dashKey];
  // try first word
  const firstWord = key.split(' ')[0];
  if (pokeEn2Id[firstWord]) return pokeEn2Id[firstWord];
  return 0;
}

function getZhPoke(nameEn) {
  const key = nameEn.toLowerCase();
  if (pokeMap[key]) return pokeMap[key];
  const dotless = key.replace(/\./g, '');
  if (pokeMap[dotless]) return pokeMap[dotless];
  return nameEn; // fallback to English
}

function toZh(map, nameEn, fallback) {
  if (!nameEn) return fallback ?? nameEn;
  const zh = map[nameEn.toLowerCase()];
  return zh || fallback || nameEn; // fallback to English for unmapped (e.g. mega stones)
}

function fmtPct(val) {
  if (val == null) return '0.0';
  return Number(val).toFixed(1);
}

// ── Convert ────────────────────────────────────────────────────────────────────

const result     = {};
const nameSeen   = {}; // track duplicate zh names → append form counter

scraped.results.forEach(r => {
  const baseZh = getZhPoke(r.name_en);
  nameSeen[baseZh] = (nameSeen[baseZh] || 0) + 1;
  const zhName = nameSeen[baseZh] === 1 ? baseZh : `${baseZh} (F${nameSeen[baseZh]})`;
  const pid    = getPid(r.name_en);

  const moves = (r.data.moves ?? []).map(m => ({
    name:          toZh(moveMap, m.matched_en, m.ocr_raw),
    usage_percent: fmtPct(m.usage_pct),
  }));

  const abilities = (r.data.abilities ?? []).map(a => ({
    name:          toZh(abilityMap, a.matched_en, a.ocr_raw),
    usage_percent: fmtPct(a.usage_pct),
  }));

  const natures = (r.data.natures ?? []).map(n => ({
    name:          toZh(natureMap, n.matched_en, n.ocr_raw),
    usage_percent: fmtPct(n.usage_pct),
  }));

  const held_items = (r.data.items ?? []).map(i => ({
    name:          toZh(itemMap, i.matched_en, i.ocr_raw),
    usage_percent: fmtPct(i.usage_pct),
  }));

  const teammates = (r.data.teammates ?? []).map(t => {
    const tZh = getZhPoke(t.matched_en ?? t.ocr_raw ?? '');
    return { full_name: tZh, pid: getPid(t.matched_en ?? t.ocr_raw ?? ''), form: 0 };
  });

  result[zhName] = {
    rank:           r.list_rank,
    pid,
    form:           0,
    full_name:      zhName,
    sprite_suffix:  '',
    sprite_id:      pid,
    moves,
    abilities,
    natures,
    held_items,
    tera_types:     [],
    teammates,
    most_defeated_by:  [],
    most_wins_against: [],
    win_moves:         [],
    lose_moves:        [],
  };
});

fs.writeFileSync(outputFile, JSON.stringify(result, null, 2), 'utf8');
console.log(`Wrote ${Object.keys(result).length} entries to ${outputFile}`);
