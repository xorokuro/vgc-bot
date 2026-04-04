'use strict';

/**
 * /pokedex — direct Pokémon lookup with game + language selection.
 * Shows stats, types, abilities, weaknesses, and (for PLZA) level-up moves + TMs.
 * Designed to be expandable: add a new game by adding to POKEDEX_GAMES.
 */

const {
  SlashCommandBuilder, EmbedBuilder, AttachmentBuilder,
} = require('discord.js');
const path = require('path');
const {
  buildStatImage, buildDetailEmbed, getPokeDisplayName,
  DEX_LABELS, gameLabel,
} = require('../utils/pokedexUtils');

// ── Game registry ─────────────────────────────────────────────────────────────
// To add a new game: add an entry here.
const POKEDEX_GAMES = {
  scvi: {
    dbFile:  'pokedex_scvi_db.json',
    hasLevelMoves: false,   // flat moves_en list only
    hasTmMoves:    false,
  },
  plza: {
    dbFile:  'pokedex_plza_db.json',
    hasLevelMoves: true,
    hasTmMoves:    true,
  },
};

// ── Data (lazy loaded) ────────────────────────────────────────────────────────
const _dbs    = {};   // gameId → array of entries
let _tri      = null; // trilingual.json
let _plzaMoves = null; // plza_moves.json (fallback for move name lookup)

function loadDb(gameId) {
  if (_dbs[gameId]) return _dbs[gameId];
  const { dbFile } = POKEDEX_GAMES[gameId];
  const data = require(path.join(__dirname, '../../data', dbFile));
  _dbs[gameId] = Object.values(data);
  return _dbs[gameId];
}

function loadTri() {
  if (!_tri) _tri = require(path.join(__dirname, '../../data/trilingual.json'));
  return _tri;
}

function loadPlzaMoves() {
  if (!_plzaMoves) _plzaMoves = require(path.join(__dirname, '../../data/plza_moves.json'));
  return _plzaMoves;
}

// ── Move name lookup (zh → en/ja) ─────────────────────────────────────────────
// Combines trilingual.json + plza_moves.json for full coverage
let _moveZhMap = null;

function getMoveZhMap() {
  if (_moveZhMap) return _moveZhMap;
  const tri   = loadTri();
  const plzaM = loadPlzaMoves();
  _moveZhMap  = {};
  // from trilingual
  Object.values(tri.move || {}).forEach(m => {
    if (m.zh) _moveZhMap[m.zh] = { en: m.en, ja: m.ja, ja_hrkt: m.ja_hrkt };
  });
  // fill gaps from plza_moves (zh-keyed entries only)
  Object.entries(plzaM).forEach(([k, v]) => {
    if (/[\u4e00-\u9fff]/.test(k) && !_moveZhMap[k]) {
      _moveZhMap[k] = { en: v.name_en, ja: null };
    }
  });
  return _moveZhMap;
}

function moveName(zh, lang) {
  const map = getMoveZhMap();
  const entry = map[zh];
  if (!entry) return zh; // fallback to zh if unknown
  if (lang === 'zh') return zh;
  if (lang === 'ja') return entry.ja || zh;
  return entry.en || zh;
}

// ── Pokémon display name for PLZA (no species_en_name field) ─────────────────
let _zhToJaPoke = null;

function zhToJaPokemon(zhName) {
  if (!_zhToJaPoke) {
    const tri = loadTri();
    _zhToJaPoke = {};
    Object.values(tri.pokemon || {}).forEach(e => {
      if (e.zh) _zhToJaPoke[e.zh] = e.ja || '';
    });
  }
  return _zhToJaPoke[zhName] || zhName;
}

function getPlzaDisplayName(poke, lang) {
  if (lang === 'zh') return poke.name_zh || poke.name_en;
  if (lang === 'en') {
    const cap = w => w.charAt(0).toUpperCase() + w.slice(1);
    return (poke.name_en || '').split('-').map(cap).join('-');
  }
  // Japanese: use trilingual lookup by zh name
  return zhToJaPokemon(poke.name_zh) || poke.name_en;
}

// ── Search in a game DB ───────────────────────────────────────────────────────
function searchInDb(gameId, query) {
  const entries = loadDb(gameId);
  const q       = query.trim();
  const qLow    = q.toLowerCase();

  // Exact matches first
  const exact =
    entries.find(e => e.name_zh === q) ??
    entries.find(e => (e.name_en || '').toLowerCase() === qLow) ??
    null;
  if (exact) return exact;

  // Partial
  return (
    entries.find(e => e.name_zh.includes(q)) ??
    entries.find(e => (e.name_en || '').toLowerCase().includes(qLow)) ??
    null
  );
}

function searchInDbByJa(gameId, query) {
  // For Japanese queries: use zh name resolved from trilingual
  const tri  = loadTri();
  const q    = query.trim();
  const zhName = Object.values(tri.pokemon || {}).find(e => e.ja === q || e.ja_hrkt === q)?.zh;
  if (!zhName) return null;
  return searchInDb(gameId, zhName);
}

function findPokemon(gameId, query) {
  const tri   = loadTri();
  const q     = query.trim();
  const qLow  = q.toLowerCase();

  // Try direct search
  const direct = searchInDb(gameId, query);
  if (direct) return direct;

  // Try via Japanese → zh resolution
  const viaJa = searchInDbByJa(gameId, q);
  if (viaJa) return viaJa;

  return null;
}

// ── Autocomplete helpers ──────────────────────────────────────────────────────
function autocompleteForGame(gameId, q) {
  const entries = loadDb(gameId);
  const qLow    = q.toLowerCase().trim();
  const tri     = loadTri();

  // Build zh→ja map for pokemon
  if (!_zhToJaPoke) zhToJaPokemon(''); // prime the cache

  const startZh = [], startEn = [], startJa = [];
  const hasZh   = [], hasEn   = [], hasJa   = [];

  for (const e of entries) {
    const zh  = e.name_zh || '';
    const en  = (e.name_en || '').toLowerCase();
    const ja  = _zhToJaPoke?.[e.name_zh] || '';

    if (zh.startsWith(q))              startZh.push(e);
    else if (en.startsWith(qLow))      startEn.push(e);
    else if (ja.startsWith(q))         startJa.push(e);
    else if (zh.includes(q))           hasZh.push(e);
    else if (en.includes(qLow))        hasEn.push(e);
    else if (ja.includes(q))           hasJa.push(e);
  }

  return [...startZh, ...startEn, ...startJa, ...hasZh, ...hasEn, ...hasJa]
    .slice(0, 25)
    .map(e => ({
      name: `${e.name_zh}  ${e.name_en}`.slice(0, 100),
      value: e.name_zh || e.name_en,
    }));
}

// ── PLZA move list fields ─────────────────────────────────────────────────────
function buildPlzaMoveFields(poke, lang, L) {
  const fields = [];

  // Level-up moves
  const lvMoves = poke['Level Up Moves'] ?? [];
  if (lvMoves.length) {
    const lines = lvMoves.map(m => `\`${String(m.level).padStart(2)}\` ${moveName(m.move_zh, lang)}`);
    // Split into columns of 2 to keep it compact
    const mid   = Math.ceil(lines.length / 2);
    const col1  = lines.slice(0, mid).join('\n');
    const col2  = lines.slice(mid).join('\n');

    if (col2) {
      fields.push({ name: L.levelUp, value: col1, inline: true });
      fields.push({ name: '\u200b', value: col2, inline: true });
      fields.push({ name: '\u200b', value: '\u200b', inline: true }); // spacer
    } else {
      fields.push({ name: L.levelUp, value: col1 || '—', inline: false });
    }
  }

  // TM moves
  const tmMoves = poke['TM Learn'] ?? [];
  if (tmMoves.length) {
    const names    = tmMoves.map(zh => moveName(zh, lang));
    const tmStr    = names.join('  •  ');
    // truncate to Discord field limit
    fields.push({
      name:  L.tmMoves,
      value: tmStr.length > 1024 ? tmStr.slice(0, 1020) + '…' : (tmStr || '—'),
    });
  }

  return fields;
}

// ── Build full embed ───────────────────────────────────────────────────────────
const COLOR = 0x3B4CCA;

async function buildPokedexReply(poke, gameId, lang) {
  const L    = DEX_LABELS[lang] ?? DEX_LABELS.zh;
  const cfg  = POKEDEX_GAMES[gameId];

  // Base detail embed (stats image + types + abilities + weaknesses)
  // PLZA entries lack species_en_name, so use dedicated name helper
  const displayPoke = gameId === 'plza'
    ? { ...poke, _displayName: getPlzaDisplayName(poke, lang) }
    : poke;

  // Override name display inside buildDetailEmbed by patching the object
  // (buildDetailEmbed calls getPokeDisplayName which uses name_zh/name_en/species_en_name)
  // For PLZA we rely on the fallback chain in getPokeDisplayName (name_zh → en → ja)
  const embed = buildDetailEmbed(poke, lang, COLOR);

  // For PLZA: replace the title with our custom name resolver
  if (gameId === 'plza') {
    const dexNum = poke.id ? `#${String(poke.id).padStart(4, '0')}` : '';
    const name   = getPlzaDisplayName(poke, lang);
    embed.setTitle(`${name}  ${dexNum}`.trim());
  }

  // Game label in footer
  const gLabel = gameLabel(gameId, lang);
  embed.setFooter({ text: gLabel });

  // PLZA move fields
  if (cfg.hasLevelMoves || cfg.hasTmMoves) {
    const moveFields = buildPlzaMoveFields(poke, lang, L);
    embed.addFields(...moveFields);
  }

  // Stat chart image
  const s   = poke.stats ?? {};
  const bst = Object.values(s).reduce((a, v) => a + (v || 0), 0);

  try {
    const imgBuf = await buildStatImage(s, bst, lang);
    const file   = new AttachmentBuilder(imgBuf, { name: 'stats.png' });
    embed.setImage('attachment://stats.png');
    return { embed, file };
  } catch {
    return { embed, file: null };
  }
}

// ── Command ────────────────────────────────────────────────────────────────────
module.exports = {
  data: new SlashCommandBuilder()
    .setName('pokedex')
    .setDescription('查詢寶可夢詳細資料 / Pokémon details: stats, moves, abilities')
    .addStringOption(o => o
      .setName('game')
      .setDescription('遊戲版本 / Game version')
      .setRequired(true)
      .addChoices(
        { name: '朱紫 (Scarlet/Violet)',  value: 'scvi' },
        { name: '傳說Z-A (Legends: Z-A)', value: 'plza' },
      ))
    .addStringOption(o => o
      .setName('pokemon')
      .setDescription('寶可夢名稱（中文、日文、英文）/ Pokémon name (zh/ja/en)')
      .setRequired(true)
      .setAutocomplete(true))
    .addStringOption(o => o
      .setName('lang')
      .setDescription('顯示語言（預設：繁體中文）/ Display language')
      .setRequired(false)
      .addChoices(
        { name: '繁體中文', value: 'zh' },
        { name: 'English',  value: 'en' },
        { name: '日本語',   value: 'ja' },
      ))
    .addBooleanOption(o => o
      .setName('public')
      .setDescription('公開顯示（預設：僅自己可見）/ Show publicly')
      .setRequired(false)),

  async execute(interaction) {
    const query  = interaction.options.getString('pokemon');
    const gameId = interaction.options.getString('game');
    const lang   = interaction.options.getString('lang') ?? 'zh';
    const pub    = interaction.options.getBoolean('public') ?? false;
    const flags  = pub ? undefined : 64;

    if (!POKEDEX_GAMES[gameId]) {
      await interaction.reply({ content: '❌ Unknown game.', flags: 64 });
      return;
    }

    const L    = DEX_LABELS[lang] ?? DEX_LABELS.zh;
    const poke = findPokemon(gameId, query);

    if (!poke) {
      const gLabel = gameLabel(gameId, lang);
      const notFound = lang === 'en' ? 'Not found' : lang === 'ja' ? '見つかりません' : '找不到';
      await interaction.reply({ content: `❌ [${gLabel}] ${notFound}: **${query}**`, flags: 64 });
      return;
    }

    await interaction.deferReply({ flags });

    const { embed, file } = await buildPokedexReply(poke, gameId, lang);

    if (file) {
      await interaction.editReply({ embeds: [embed], files: [file] });
    } else {
      await interaction.editReply({ embeds: [embed] });
    }
  },

  async autocomplete(interaction) {
    const gameId = interaction.options.getString('game');
    const q      = interaction.options.getFocused().trim();

    if (!gameId || !POKEDEX_GAMES[gameId]) {
      await interaction.respond([]);
      return;
    }

    const choices = autocompleteForGame(gameId, q);
    await interaction.respond(choices);
  },
};
