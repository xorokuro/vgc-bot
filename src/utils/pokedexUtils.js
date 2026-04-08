'use strict';

/**
 * Shared utilities for Pokédex display.
 * Used by /pokemon_search (dex.js) and /pokedex (pokedex.js).
 */

const sharp     = require('sharp');
const { translate }  = require('./i18n');
const { TYPE_EMOJI } = require('./buildEmbed');
const { EmbedBuilder } = require('discord.js');

// ── Type emoji helper (lowercase input) ───────────────────────────────────────
function typeEmoji(t) {
  return TYPE_EMOJI[t[0].toUpperCase() + t.slice(1)] ?? '';
}

// ── Full type chart ────────────────────────────────────────────────────────────
const TYPE_CHART = {
  Normal:   { Rock: 0.5,  Ghost: 0,   Steel: 0.5 },
  Fire:     { Fire: 0.5,  Water: 0.5, Grass: 2,   Ice: 2,   Bug: 2,   Rock: 0.5, Dragon: 0.5, Steel: 2 },
  Water:    { Fire: 2,    Water: 0.5, Grass: 0.5, Ground: 2, Rock: 2,  Dragon: 0.5 },
  Electric: { Water: 2,   Electric: 0.5, Grass: 0.5, Ground: 0, Flying: 2, Dragon: 0.5 },
  Grass:    { Fire: 0.5,  Water: 2,   Grass: 0.5, Poison: 0.5, Ground: 2, Flying: 0.5, Bug: 0.5, Rock: 2, Dragon: 0.5, Steel: 0.5 },
  Ice:      { Water: 0.5, Grass: 2,   Ice: 0.5,   Ground: 2, Flying: 2, Dragon: 2, Steel: 0.5 },
  Fighting: { Normal: 2,  Ice: 2,     Poison: 0.5, Flying: 0.5, Psychic: 0.5, Bug: 0.5, Rock: 2, Ghost: 0, Dark: 2, Steel: 2, Fairy: 0.5 },
  Poison:   { Grass: 2,   Poison: 0.5, Ground: 0.5, Rock: 0.5, Ghost: 0.5, Steel: 0, Fairy: 2 },
  Ground:   { Fire: 2,    Electric: 2, Grass: 0.5, Poison: 2, Flying: 0, Bug: 0.5, Rock: 2, Steel: 2 },
  Flying:   { Electric: 0.5, Grass: 2, Fighting: 2, Bug: 2, Rock: 0.5, Steel: 0.5 },
  Psychic:  { Fighting: 2, Poison: 2, Psychic: 0.5, Dark: 0, Steel: 0.5 },
  Bug:      { Fire: 0.5,  Grass: 2,   Fighting: 0.5, Flying: 0.5, Psychic: 2, Ghost: 0.5, Dark: 2, Steel: 0.5, Fairy: 0.5, Poison: 0.5 },
  Rock:     { Fire: 2,    Ice: 2,     Fighting: 0.5, Ground: 0.5, Flying: 2, Bug: 2, Steel: 0.5 },
  Ghost:    { Normal: 0,  Psychic: 2, Ghost: 2,   Dark: 0.5 },
  Dragon:   { Dragon: 2,  Steel: 0.5, Fairy: 0 },
  Dark:     { Fighting: 0.5, Psychic: 2, Ghost: 2, Dark: 0.5, Fairy: 0.5 },
  Steel:    { Fire: 0.5,  Water: 0.5, Electric: 0.5, Ice: 2, Rock: 2, Steel: 0.5, Fairy: 2 },
  Fairy:    { Fighting: 2, Poison: 0.5, Bug: 0.5, Dragon: 2, Dark: 2, Steel: 0.5 },
};

const ALL_TYPES = Object.keys(TYPE_CHART);

function calcWeaknesses(typesEn) {
  const result = { '4': [], '2': [], '0.5': [], '0.25': [], '0': [] };
  const defTypes = typesEn.map(t => t[0].toUpperCase() + t.slice(1));
  for (const atkType of ALL_TYPES) {
    const chart = TYPE_CHART[atkType] ?? {};
    let mult = 1;
    for (const def of defTypes) mult *= chart[def] ?? 1;
    if      (mult === 4)    result['4'].push(atkType);
    else if (mult === 2)    result['2'].push(atkType);
    else if (mult === 0.5)  result['0.5'].push(atkType);
    else if (mult === 0.25) result['0.25'].push(atkType);
    else if (mult === 0)    result['0'].push(atkType);
  }
  return result;
}

// ── Stat chart image ───────────────────────────────────────────────────────────
const STAT_KEYS = [
  { key: 'hp',              color: '#FF5959' },
  { key: 'attack',          color: '#F5AC78' },
  { key: 'defense',         color: '#FAE078' },
  { key: 'special-attack',  color: '#9DB7F5' },
  { key: 'special-defense', color: '#A7DB8D' },
  { key: 'speed',           color: '#FA92B2' },
];

const STAT_LABELS = {
  zh: ['HP', '攻擊', '防禦', '特攻', '特防', '速度'],
  ja: ['HP', '攻撃', '防御', '特攻', '特防', '素早'],
  en: ['HP', 'Atk', 'Def', 'SpA', 'SpD', 'Spe'],
};

async function buildStatImage(stats, bst, lang = 'zh') {
  const labels = STAT_LABELS[lang] ?? STAT_LABELS.zh;
  const W = 400, H = 258;
  const BAR_X = 100, BAR_W = 276, BAR_H = 14;
  const START_Y = 64, ROW_H = 32;

  const rows = STAT_KEYS.map((r, i) => {
    const label = labels[i];
    const val   = stats[r.key] ?? 0;
    const barW  = Math.max(0, Math.round(val / 255 * BAR_W));
    const y     = START_Y + i * ROW_H;
    return `
      <text x="20" y="${y}" font-family="sans-serif" font-size="13" fill="#CCCCCC">${label}</text>
      <text x="${BAR_X - 8}" y="${y}" font-family="monospace" font-size="13" fill="#CCCCCC" text-anchor="end">${val}</text>
      <rect x="${BAR_X}" y="${y - 12}" width="${BAR_W}" height="${BAR_H}" fill="#2A2A3A" rx="3"/>
      ${barW > 0 ? `<rect x="${BAR_X}" y="${y - 12}" width="${barW}" height="${BAR_H}" fill="${r.color}" rx="3"/>` : ''}`;
  }).join('');

  const chartTitle =
    lang === 'en' ? `Base Stats  Total ${bst}` :
    lang === 'ja' ? `種族値　合計 ${bst}` :
                    `種族值　總計 ${bst}`;

  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${W}" height="${H}" fill="#12121C" rx="10"/>
    <text x="20" y="24" font-family="sans-serif" font-size="13" fill="#888888">${chartTitle}</text>
    <line x1="20" y1="34" x2="${W - 20}" y2="34" stroke="#333333" stroke-width="1"/>
    ${rows}
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

// ── Localised field labels ─────────────────────────────────────────────────────
const DEX_LABELS = {
  zh: {
    type:       '屬性',
    ability:    '特性',
    weakness:   '弱點・抗性',
    noWeak:     '無特殊弱點',
    hidden:     '〔隱藏特性〕',
    levelUp:    '升等招式',
    tmMoves:    'TM 招式',
    noMoves:    '無資料',
    searchTitle:'寶可夢搜尋結果',
    query:      '查詢條件',
    found:      '筆結果',
    page:       '頁數',
    details:    '查看詳細資料',
    prevPage:   '← 上頁',
    nextPage:   '下頁 →',
    expired:    '搜尋結果已過期，請重新執行指令。',
  },
  ja: {
    type:       'タイプ',
    ability:    '特性',
    weakness:   '弱点・耐性',
    noWeak:     '特殊な弱点なし',
    hidden:     '〔隠れ特性〕',
    levelUp:    'レベルアップ技',
    tmMoves:    'わざマシン',
    noMoves:    'データなし',
    searchTitle:'ポケモン検索結果',
    query:      '検索条件',
    found:      '件の結果',
    page:       'ページ',
    details:    '詳細を見る',
    prevPage:   '← 前のページ',
    nextPage:   '次のページ →',
    expired:    '検索結果の有効期限が切れました。コマンドを再実行してください。',
  },
  en: {
    type:       'Type',
    ability:    'Abilities',
    weakness:   'Weaknesses',
    noWeak:     'No special weaknesses',
    hidden:     '[Hidden]',
    levelUp:    'Level-Up Moves',
    tmMoves:    'TM Moves',
    noMoves:    'No data',
    searchTitle:'Pokémon Search Results',
    query:      'Query',
    found:      'results found',
    page:       'Page',
    details:    'View Pokémon details',
    prevPage:   '← Prev',
    nextPage:   'Next →',
    expired:    'Search results have expired. Please run the command again.',
  },
};

// ── Game label by language ─────────────────────────────────────────────────────
const GAME_LABELS = {
  scvi:     { zh: '朱紫',          ja: 'スカーレット・バイオレット', en: 'Scarlet/Violet' },
  plza:     { zh: '傳說Z-A',       ja: 'レジェンズZ-A',             en: 'Legends: Z-A' },
  champion: { zh: 'Pokémon Champion', ja: 'ポケモンChampion',        en: 'Pokémon Champion' },
};

function gameLabel(gameId, lang) {
  return (GAME_LABELS[gameId] ?? {})[lang] ?? gameId;
}

// ── Pokémon display name ───────────────────────────────────────────────────────
function getPokeDisplayName(poke, lang) {
  const nameEn    = poke.name_en || '';
  const speciesEn = poke.species_en_name || nameEn;
  const cap       = w => w.charAt(0).toUpperCase() + w.slice(1);

  if (lang === 'zh') return poke.name_zh || nameEn;

  const formattedEn = nameEn.split('-').map(cap).join('-');
  if (lang === 'en') return formattedEn;

  // Japanese: translate species, append form suffix if any
  const speciesFormatted = speciesEn.split('-').map(cap).join(' ');
  const jaSpecies = translate(speciesFormatted, 'pokemon', 'ja');
  const hasForm   = nameEn.length > speciesEn.length && nameEn.startsWith(speciesEn + '-');
  if (!hasForm) return jaSpecies;
  const formStr = nameEn.slice(speciesEn.length + 1).split('-').map(cap).join(' ');
  return `${jaSpecies} (${formStr})`;
}

// ── Detail embed (stats + types + abilities + weaknesses) ─────────────────────
function buildDetailEmbed(poke, lang = 'zh', color = 0x3B4CCA) {
  const L      = DEX_LABELS[lang] ?? DEX_LABELS.zh;
  const dexNum = poke.id ? `#${String(poke.id).padStart(4, '0')}` : '';
  const title  = `${getPokeDisplayName(poke, lang)}  ${dexNum}`;

  const typeStr = (poke.types_en || []).map(t => typeEmoji(t)).join('  ');

  const abilities = poke.abilities ?? [];
  const abilityLines = abilities.map(a => {
    const enKey = a.name.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
    const name  = translate(enKey, 'ability', lang) || enKey;
    const hidden = a.is_hidden ? ` ${L.hidden}` : '';
    return `${name}${hidden}`;
  }).join('\n');

  const weak = calcWeaknesses(poke.types_en ?? []);
  const weakRows = [
    ['4×', weak['4']], ['2×', weak['2']], ['½×', weak['0.5']],
    ['¼×', weak['0.25']], ['0×', weak['0']],
  ]
    .filter(([, arr]) => arr.length > 0)
    .map(([label, arr]) => `**${label}** ${arr.map(t => typeEmoji(t.toLowerCase())).join('')}`)
    .join('  ');

  const spriteId  = (poke.name_en || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  const spriteUrl = `https://play.pokemonshowdown.com/sprites/home/${spriteId}.png`;

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setThumbnail(spriteUrl)
    .addFields(
      { name: L.type,             value: typeStr || '—',      inline: false },
      { name: `<:abilitypatch:1489985991589761184> ${L.ability}`,  value: abilityLines || '—', inline: false },
      { name: `🛡️ ${L.weakness}`, value: weakRows || L.noWeak, inline: false },
    );
}

module.exports = {
  typeEmoji,
  TYPE_CHART,
  calcWeaknesses,
  STAT_KEYS,
  STAT_LABELS,
  buildStatImage,
  DEX_LABELS,
  GAME_LABELS,
  gameLabel,
  getPokeDisplayName,
  buildDetailEmbed,
};
