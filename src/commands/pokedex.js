'use strict';

/**
 * /pokedex — direct Pokémon lookup with game + language selection.
 *
 * SCVI:  4-tab interactive view — Tab 1: basic info, Tab 2: level-up moves,
 *        Tab 3: TM moves, Tab 4: egg moves. Uses data/scvi_moves_db.json.
 * PLZA:  3-tab interactive view — Tab 1: basic info, Tab 2: level-up moves,
 *        Tab 3: TM moves. Moves show type + category emoji, TMs show TM number.
 */

const {
  SlashCommandBuilder, EmbedBuilder, AttachmentBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType,
  StringSelectMenuBuilder,
} = require('discord.js');
const path = require('path');
const {
  buildStatImage, buildDetailEmbed, getPokeDisplayName, typeEmoji,
  DEX_LABELS, gameLabel,
} = require('../utils/pokedexUtils');
const { CATEGORY_EMOJI } = require('../utils/buildEmbed');

// ── Game registry ─────────────────────────────────────────────────────────────
const POKEDEX_GAMES = {
  scvi: {
    dbFile:  'pokedex_scvi_db.json',
    hasLevelMoves: false,
    hasTmMoves:    false,
  },
  plza: {
    dbFile:  'pokedex_plza_db.json',
    hasLevelMoves: true,
    hasTmMoves:    true,
  },
  champion: {
    dbFile:  'pokedex_champion_db.json',
    hasLevelMoves: false,
    hasTmMoves:    false,
  },
};

// ── TM number map (PLZA) ──────────────────────────────────────────────────────
// Keys: English move name, lowercase, hyphens→spaces
const TM_NUMBER_MAP = {
  'headbutt': 'TM001', 'dragon claw': 'TM002', 'psyshock': 'TM003',
  'rock smash': 'TM004', 'roar': 'TM005', 'calm mind': 'TM006',
  'toxic': 'TM007', 'thunder wave': 'TM008', 'flip turn': 'TM009',
  'brick break': 'TM010', 'bulk up': 'TM011', 'rock slide': 'TM012',
  'ice beam': 'TM013', 'fire fang': 'TM014', 'ice fang': 'TM015',
  'light screen': 'TM016', 'protect': 'TM017', 'power up punch': 'TM018',
  'power gem': 'TM019', 'play rough': 'TM020', 'thunder fang': 'TM021',
  'aerial ace': 'TM022', 'thunder punch': 'TM023', 'ice punch': 'TM024',
  'crunch': 'TM025', 'energy ball': 'TM026', 'swift': 'TM027',
  'dig': 'TM028', 'fire punch': 'TM029', 'swords dance': 'TM030',
  'reflect': 'TM031', 'double team': 'TM032', 'body slam': 'TM033',
  'night slash': 'TM034', 'endure': 'TM035', 'rock tomb': 'TM036',
  'stealth rock': 'TM037', 'fire blast': 'TM038', 'discharge': 'TM039',
  'bullet seed': 'TM040', 'water pulse': 'TM041', 'giga drain': 'TM042',
  'fly': 'TM043', 'hyper beam': 'TM044', 'knock off': 'TM045',
  'mud shot': 'TM046', 'agility': 'TM047', 'self destruct': 'TM048',
  'icy wind': 'TM049', 'overheat': 'TM050', 'safeguard': 'TM051',
  'earth power': 'TM052', 'sludge bomb': 'TM053', 'draco meteor': 'TM054',
  'giga impact': 'TM055', 'double edge': 'TM056', 'will o wisp': 'TM057',
  'iron head': 'TM058', 'zen headbutt': 'TM059', 'future sight': 'TM060',
  'shadow claw': 'TM061', 'flamethrower': 'TM062', 'psychic': 'TM063',
  'solar beam': 'TM064', 'stone edge': 'TM065', 'volt switch': 'TM066',
  'thunderbolt': 'TM067', 'heat wave': 'TM068', 'earthquake': 'TM069',
  'whirlpool': 'TM070', 'hyper voice': 'TM071', 'fire spin': 'TM072',
  'surf': 'TM073', 'shadow ball': 'TM074', 'dragon pulse': 'TM075',
  'liquidation': 'TM076', 'poison jab': 'TM077', 'bulldoze': 'TM078',
  'hurricane': 'TM079', 'iron defense': 'TM080', 'x scissor': 'TM081',
  'u turn': 'TM082', 'nasty plot': 'TM083', 'flash cannon': 'TM084',
  'substitute': 'TM085', 'wild charge': 'TM086', 'iron tail': 'TM087',
  'spikes': 'TM088', 'toxic spikes': 'TM089', 'dark pulse': 'TM090',
  'curse': 'TM091', 'dazzling gleam': 'TM092', 'outrage': 'TM093',
  'whirlwind': 'TM094', 'taunt': 'TM095', 'hydro pump': 'TM096',
  'heal block': 'TM097', 'waterfall': 'TM098', 'metronome': 'TM099',
  'gunk shot': 'TM100', 'electroweb': 'TM101', 'focus blast': 'TM102',
  'work up': 'TM103', 'flare blitz': 'TM104', 'blizzard': 'TM105',
  'thunder': 'TM106', 'close combat': 'TM107', 'comet punch': 'TM108',
  'facade': 'TM109', 'chilling water': 'TM110', 'sing': 'TM111',
  'acid spray': 'TM112', 'low sweep': 'TM113', 'flame charge': 'TM114',
  'trailblaze': 'TM115', 'pay day': 'TM116', 'silver wind': 'TM117',
  'shadow punch': 'TM118', 'ominous wind': 'TM119', 'ancient power': 'TM120',
  'torment': 'TM121', 'false swipe': 'TM122', 'poison fang': 'TM123',
  'psychic fangs': 'TM124', 'mimic': 'TM125', 'magnet bomb': 'TM126',
  'dream eater': 'TM127', 'seed bomb': 'TM128', 'circle throw': 'TM129',
  'charge beam': 'TM130', 'drain punch': 'TM131', 'double hit': 'TM132',
  'blaze kick': 'TM133', 'dual wingbeat': 'TM134', 'dual chop': 'TM135',
  'scorching sands': 'TM136', 'storm throw': 'TM137', 'frost breath': 'TM138',
  'swagger': 'TM139', 'muddy water': 'TM140', 'fake out': 'TM141',
  'first impression': 'TM142', 'scale shot': 'TM143', 'triple axel': 'TM144',
  'razor wind': 'TM145', 'skull bash': 'TM146', 'tri attack': 'TM147',
  'scald': 'TM148', 'icicle spear': 'TM149', 'vacuum wave': 'TM150',
  'petal dance': 'TM151', 'solar blade': 'TM152', 'sky attack': 'TM153',
  'fissure': 'TM154', 'sheer cold': 'TM155', 'meteor beam': 'TM156',
  'steel beam': 'TM157', 'blast burn': 'TM158', 'hydro cannon': 'TM159',
  'frenzy plant': 'TM160',
};

// ── Data (lazy loaded) ────────────────────────────────────────────────────────
const _dbs     = {};
let _tri       = null;
let _plzaMoves = null;
let _movesDb   = null;
let _scviMoves = null;

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

function loadMovesDb() {
  if (!_movesDb) _movesDb = require(path.join(__dirname, '../../data/moves_db.json'));
  return _movesDb;
}

function loadScviMoves() {
  if (!_scviMoves) {
    try {
      _scviMoves = require(path.join(__dirname, '../../data/scvi_moves_db.json'));
    } catch {
      _scviMoves = {};
    }
  }
  return _scviMoves;
}

let _svDetail = null;
function loadSvDetail() {
  if (!_svDetail) _svDetail = require(path.join(__dirname, '../../data/moves_sv_detailed.json'));
  return _svDetail;
}

let _championMoves = null;
function loadChampionMoves() {
  if (!_championMoves) {
    try {
      _championMoves = require(path.join(__dirname, '../../data/champion_moves_db.json'));
    } catch {
      _championMoves = {};
    }
  }
  return _championMoves;
}

// ── zh→en move name map (for TM lookup) ──────────────────────────────────────
let _zhToEnMove = null;

function getZhToEnMove() {
  if (_zhToEnMove) return _zhToEnMove;
  const tri = loadTri();
  _zhToEnMove = {};
  Object.values(tri.move || {}).forEach(m => {
    if (m.zh && m.en) _zhToEnMove[m.zh] = m.en;
  });
  // Fill gaps from moves_db
  const db = loadMovesDb();
  Object.values(db).forEach(v => {
    if (v.name_zh && v.name_en && !_zhToEnMove[v.name_zh]) {
      _zhToEnMove[v.name_zh] = v.name_en;
    }
  });
  return _zhToEnMove;
}

// ── Move helpers ──────────────────────────────────────────────────────────────
function getMoveType(zhName) {
  return loadMovesDb()[zhName]?.type || 'unknown';
}

function getMoveCategory(zhName) {
  return loadMovesDb()[zhName]?.category || 'unknown';
}

function moveCatEmoji(zhName) {
  const cat = getMoveCategory(zhName);
  if (cat === 'physical') return CATEGORY_EMOJI.Physical;
  if (cat === 'special')  return CATEGORY_EMOJI.Special;
  return '';
}

function getTmId(zhName) {
  const en = getZhToEnMove()[zhName];
  if (!en) return '';
  // Normalise: lowercase + hyphens→spaces
  const key = en.toLowerCase().replace(/-/g, ' ');
  return TM_NUMBER_MAP[key] || '';
}

// ── en move name → {zh, ja, type, category} (for SCVI) ───────────────────────
let _enMoveMap = null;

function getEnMoveMap() {
  if (_enMoveMap) return _enMoveMap;
  const tri    = loadTri();
  const db     = loadMovesDb();
  _enMoveMap   = {};

  // zh→{type,category} from moves_db
  const zhInfo = {};
  Object.entries(db).forEach(([zh, v]) => { zhInfo[zh] = v; });

  Object.values(tri.move || {}).forEach(m => {
    if (!m.en) return;
    const enKey = m.en.toLowerCase();
    const info  = m.zh ? (zhInfo[m.zh] ?? {}) : {};
    _enMoveMap[enKey] = {
      zh:       m.zh || m.en,
      ja:       m.ja || m.en,
      type:     info.type     || 'unknown',
      category: info.category || 'unknown',
    };
  });
  return _enMoveMap;
}

function getMoveInfoByEn(enName) {
  return getEnMoveMap()[enName.toLowerCase()] ??
    { zh: enName, ja: enName, type: 'unknown', category: 'unknown' };
}

function moveNameByEn(enName, lang) {
  if (lang === 'en') return enName.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
  const info = getMoveInfoByEn(enName);
  return (lang === 'ja' ? info.ja : info.zh) || enName;
}

function typeEmojiByEn(enName) {
  const { type } = getMoveInfoByEn(enName);
  return (type && type !== 'unknown') ? typeEmoji(type) : '';
}

function catEmojiByEn(enName) {
  const { category } = getMoveInfoByEn(enName);
  if (category === 'physical') return CATEGORY_EMOJI.Physical;
  if (category === 'special')  return CATEGORY_EMOJI.Special;
  return '';
}

// ── Move name lookup (zh → en/ja) ─────────────────────────────────────────────
let _moveZhMap = null;

function getMoveZhMap() {
  if (_moveZhMap) return _moveZhMap;
  const tri   = loadTri();
  const plzaM = loadPlzaMoves();
  _moveZhMap  = {};
  Object.values(tri.move || {}).forEach(m => {
    if (m.zh) _moveZhMap[m.zh] = { en: m.en, ja: m.ja };
  });
  Object.entries(plzaM).forEach(([k, v]) => {
    if (/[\u4e00-\u9fff]/.test(k) && !_moveZhMap[k]) {
      _moveZhMap[k] = { en: v.name_en, ja: null };
    }
  });
  return _moveZhMap;
}

function moveName(zh, lang) {
  const map   = getMoveZhMap();
  const entry = map[zh];
  if (!entry) return zh;
  if (lang === 'zh') return zh;
  if (lang === 'ja') return entry.ja || zh;
  return entry.en || zh;
}

// ── Pokémon display name for PLZA ─────────────────────────────────────────────
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
  return zhToJaPokemon(poke.name_zh) || poke.name_en;
}

// ── Search ────────────────────────────────────────────────────────────────────
function searchInDb(gameId, query) {
  const entries = loadDb(gameId);
  const q       = query.trim();
  const qLow    = q.toLowerCase();

  const exact =
    entries.find(e => e.name_zh === q) ??
    entries.find(e => (e.name_en || '').toLowerCase() === qLow) ??
    null;
  if (exact) return exact;

  return (
    entries.find(e => (e.name_zh || '').includes(q)) ??
    entries.find(e => (e.name_en || '').toLowerCase().includes(qLow)) ??
    null
  );
}

function searchInDbByJa(gameId, query) {
  const tri    = loadTri();
  const q      = query.trim();
  const zhName = Object.values(tri.pokemon || {}).find(e => e.ja === q || e.ja_hrkt === q)?.zh;
  if (!zhName) return null;
  return searchInDb(gameId, zhName);
}

function findPokemon(gameId, query) {
  const direct = searchInDb(gameId, query);
  if (direct) return direct;
  return searchInDbByJa(gameId, query);
}

function findPokemonByEn(gameId, nameEn) {
  return loadDb(gameId).find(p => p.name_en === nameEn) ?? null;
}

// ── Autocomplete ──────────────────────────────────────────────────────────────
function autocompleteForGame(gameId, q) {
  const entries = loadDb(gameId);
  const qLow    = q.toLowerCase().trim();

  if (!_zhToJaPoke) zhToJaPokemon('');

  const startZh = [], startEn = [], startJa = [];
  const hasZh   = [], hasEn   = [], hasJa   = [];

  for (const e of entries) {
    const zh = e.name_zh || '';
    const en = (e.name_en || '').toLowerCase();
    // Champion db stores name_ja directly; other dbs look it up via zh→ja map
    const ja = e.name_ja || _zhToJaPoke?.[e.name_zh] || '';

    if (zh.startsWith(q))         startZh.push(e);
    else if (en.startsWith(qLow)) startEn.push(e);
    else if (ja.startsWith(q))    startJa.push(e);
    else if (zh.includes(q))      hasZh.push(e);
    else if (en.includes(qLow))   hasEn.push(e);
    else if (ja.includes(q))      hasJa.push(e);
  }

  return [...startZh, ...startEn, ...startJa, ...hasZh, ...hasEn, ...hasJa]
    .slice(0, 25)
    .map(e => {
      const value = (e.name_zh || e.name_en || '').slice(0, 100);
      const name  = `${e.name_zh || e.name_en || ''}  ${e.name_en || ''}`.trim().slice(0, 100) || value;
      return { name: name || '?', value: value || e.name_en || '?' };
    })
    .filter(o => o.value && o.value.length >= 1);
}

// ── Field splitter ────────────────────────────────────────────────────────────
function splitToFields(embed, fieldName, lines) {
  let current = '';
  let first   = true;
  for (const line of lines) {
    const sep = current ? '\n' : '';
    if (current.length + sep.length + line.length > 1000) {
      embed.addFields({ name: first ? fieldName : '\u200b', value: current || '—' });
      current = line;
      first   = false;
    } else {
      current = current + sep + line;
    }
  }
  if (current) embed.addFields({ name: first ? fieldName : '\u200b', value: current });
}

// ── Move select helpers (SCVI) ────────────────────────────────────────────────

const MOVE_SELECT_PLACEHOLDER = {
  levelup: { zh: '👁 查看升等招式詳情', en: '👁 View level-up move', ja: '👁 昇格技の詳細' },
  tm:      { zh: '👁 查看 TM 招式詳情', en: '👁 View TM move',       ja: '👁 わざマシン技の詳細' },
  egg:     { zh: '👁 查看蛋招式詳情',   en: '👁 View egg move',      ja: '👁 タマゴ技の詳細' },
};

function getMoveListForTab(poke, tab) {
  const data = loadScviMoves()[poke.name_en];
  if (!data) return [];
  if (tab === 'levelup') {
    return (data.level_up_moves ?? [])
      .slice()
      .sort((a, b) => {
        const la = a.level < 0 ? -2 : a.level === 0 ? -1 : a.level;
        const lb = b.level < 0 ? -2 : b.level === 0 ? -1 : b.level;
        return la - lb;
      })
      .map(m => ({ en: m.move_en, level: m.level }));
  }
  if (tab === 'tm') {
    return (data.tm_moves ?? [])
      .slice()
      .sort((a, b) => a.tm.localeCompare(b.tm))
      .map(m => ({ en: m.move_en, tm: m.tm }));
  }
  if (tab === 'egg') {
    return (data.egg_moves ?? []).map(en => ({ en }));
  }
  return [];
}

function buildMoveSelectRow(moveList, page, tab, lang, disabled = false) {
  const slice = moveList.slice(page * 25, page * 25 + 25);
  if (!slice.length) return null;

  const options = slice.map(m => {
    const name = moveNameByEn(m.en, lang);
    let prefix = '';
    if (tab === 'levelup') {
      const lv = m.level < 0 ? '回憶' : m.level === 0 ? '進化' : `Lv.${m.level}`;
      prefix = `[${lv}] `;
    } else if (tab === 'tm') {
      prefix = `[TM${m.tm}] `;
    }
    return { label: `${prefix}${name}`.slice(0, 100), value: m.en };
  });

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('scvi_move_select')
      .setPlaceholder((MOVE_SELECT_PLACEHOLDER[tab]?.[lang] ?? MOVE_SELECT_PLACEHOLDER[tab]?.zh ?? '👁 查看招式詳情'))
      .setDisabled(disabled)
      .addOptions(options),
  );
}

function buildMovePageRow(total, page, disabled = false) {
  if (total <= 25) return null;
  const totalPages = Math.ceil(total / 25);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('scvi_move_prev')
      .setLabel('◀')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || page === 0),
    new ButtonBuilder()
      .setCustomId('scvi_move_next')
      .setLabel('▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || page >= totalPages - 1),
  );
}


function buildMoveDetailEmbed(enHyphen, lang) {
  const key     = enHyphen.toLowerCase().replace(/-/g, ' ');
  const d       = loadSvDetail()[key];
  const tri     = loadTri();
  const triEntry = Object.values(tri.move || {}).find(m =>
    m.en?.toLowerCase() === key || m.en?.toLowerCase() === enHyphen.toLowerCase()
  );

  const zh = triEntry?.zh || d?.name?.zh || enHyphen;
  const ja = triEntry?.ja || d?.name?.ja || enHyphen;
  const en = triEntry?.en || d?.name?.en || enHyphen;

  const title = lang === 'zh' ? `${zh}  /  ${en}`
              : lang === 'ja' ? `${ja}  /  ${zh}`
              :                 `${en}  /  ${zh}`;

  const embed = new EmbedBuilder().setColor(COLOR).setTitle(`[SV 招式] ${title}`);
  const names = [];
  if (zh) names.push(`ZH: ${zh}`);
  if (en) names.push(`EN: ${en}`);
  if (ja) names.push(`JA: ${ja}${triEntry?.ja_hrkt ? ` (${triEntry.ja_hrkt})` : ''}`);
  embed.setDescription(names.join('\n'));

  if (d) {
    const typeEn  = (d.type?.en || '').toLowerCase();
    const catEn   = (d.category?.en || '').toLowerCase();
    const typeLabel = lang === 'zh' ? d.type?.zh : lang === 'ja' ? d.type?.ja : d.type?.en;
    const catLabel  = lang === 'zh'
      ? (catEn === 'physical' ? '物理' : catEn === 'special' ? '特殊' : catEn === 'status' ? '變化' : '???')
      : lang === 'ja'
      ? (catEn === 'physical' ? 'ぶつり' : catEn === 'special' ? 'とくしゅ' : catEn === 'status' ? 'へんか' : '???')
      : (catEn.charAt(0).toUpperCase() + catEn.slice(1) || '???');

    const lType   = lang === 'zh' ? '屬性'    : lang === 'ja' ? 'タイプ'      : 'Type';
    const lCat    = lang === 'zh' ? '分類'    : lang === 'ja' ? '分類'        : 'Category';
    const lPow    = lang === 'zh' ? '威力'    : lang === 'ja' ? 'いりょく'    : 'Power';
    const lAcc    = lang === 'zh' ? '命中'    : lang === 'ja' ? 'めいちゅう'  : 'Accuracy';
    const lTgt    = lang === 'zh' ? '目標'    : lang === 'ja' ? '対象'        : 'Target';
    const lMech   = lang === 'zh' ? '機制'    : lang === 'ja' ? 'しくみ'      : 'Mechanics';
    const lEffect = lang === 'zh' ? '效果'    : lang === 'ja' ? '効果'        : 'Effect';

    embed.addFields(
      { name: lType, value: `${typeEn ? typeEmoji(typeEn) : '❓'} ${typeLabel}`, inline: true },
      { name: lCat,  value: catLabel,                                           inline: true },
      { name: lPow,  value: d.power !== '—' ? d.power : '—',                  inline: true },
      { name: lAcc,  value: d.accuracy !== '—' ? `${d.accuracy}%` : '—',      inline: true },
      { name: 'PP',  value: d.pp !== '—' ? d.pp : '—',                        inline: true },
      { name: lTgt,  value: d.target?.[lang] || d.target?.en || '—',          inline: true },
    );

    const lContact = lang === 'zh' ? '直接接觸' : lang === 'ja' ? '直接攻撃' : 'Makes Contact';
    const lProtect = lang === 'zh' ? '守護招式' : lang === 'ja' ? 'まもる対応' : 'Blocked by Protect';
    const mechParts = [];
    if (d.contact) mechParts.push(d.contact === '直○' ? `${lContact}: ✅` : `${lContact}: ❌`);
    if (d.protect) mechParts.push(d.protect === '守○' ? `${lProtect}: ✅` : `${lProtect}: ❌`);
    if (mechParts.length) embed.addFields({ name: lMech, value: mechParts.join('  ·  '), inline: false });

    const effectText = lang === 'zh' ? d.effect?.zh : lang === 'ja' ? d.effect?.ja : d.effect?.en;
    const effectAlt  = lang !== 'en' ? d.effect?.en : d.effect?.zh;
    const altLabel   = lang !== 'en' ? 'EN' : 'ZH';
    if (effectText || effectAlt) {
      const lines = [];
      if (effectText) lines.push(effectText);
      if (effectAlt)  lines.push(`-# ${altLabel}: ${effectAlt}`);
      embed.addFields({ name: lEffect, value: lines.join('\n').slice(0, 1024), inline: false });
    }
  }

  return embed;
}

// ── PLZA page builders ────────────────────────────────────────────────────────
const COLOR = 0x3B4CCA;

const FOOTER_TEXT = {
  zh: { p1: '頁 1/3：基本資料', p2: '頁 2/3：升等招式', p3: '頁 3/3：TM 招式' },
  ja: { p1: 'ページ 1/3：基本情報', p2: 'ページ 2/3：昇格技', p3: 'ページ 3/3：わざマシン' },
  en: { p1: 'Page 1/3: Basic Info', p2: 'Page 2/3: Level Moves', p3: 'Page 3/3: TM Moves' },
};

async function buildPlzaPage1(poke, lang) {
  const embed = buildDetailEmbed(poke, lang, COLOR);
  embed.setTitle(getPlzaDisplayName(poke, lang));

  const ft = FOOTER_TEXT[lang] ?? FOOTER_TEXT.zh;
  embed.setFooter({ text: `${gameLabel('plza', lang)} · ${ft.p1}` });

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

function buildPlzaPage2(poke, lang) {
  const L  = DEX_LABELS[lang] ?? DEX_LABELS.zh;
  const ft = FOOTER_TEXT[lang] ?? FOOTER_TEXT.zh;

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(getPlzaDisplayName(poke, lang))
    .setFooter({ text: `${gameLabel('plza', lang)} · ${ft.p2}` });

  const lvMoves = (poke['Level Up Moves'] ?? []).slice().sort((a, b) => {
    // 進化 (0) and 回憶 (< 0) sort before level moves
    const la = a.level === 0 ? -1 : a.level < 0 ? -2 : a.level;
    const lb = b.level === 0 ? -1 : b.level < 0 ? -2 : b.level;
    return la - lb;
  });

  if (!lvMoves.length) {
    embed.addFields({ name: `📈 ${L.levelUp}`, value: L.noMoves });
    return embed;
  }

  const lines = lvMoves.map(m => {
    const lv    = m.level === 0 ? '進化' : m.level < 0 ? '回憶' : `Lv.${m.level}`;
    const tEm   = typeEmoji(getMoveType(m.move_zh));
    const cEm   = moveCatEmoji(m.move_zh);
    const name  = moveName(m.move_zh, lang);
    return `\`${lv.padEnd(5)}\` ${tEm}${cEm} **${name}**`;
  });

  splitToFields(embed, `📈 ${L.levelUp}`, lines);
  return embed;
}

function buildPlzaPage3(poke, lang) {
  const L  = DEX_LABELS[lang] ?? DEX_LABELS.zh;
  const ft = FOOTER_TEXT[lang] ?? FOOTER_TEXT.zh;

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(getPlzaDisplayName(poke, lang))
    .setFooter({ text: `${gameLabel('plza', lang)} · ${ft.p3}` });

  const tmMoves = poke['TM Learn'] ?? [];

  if (!tmMoves.length) {
    embed.addFields({ name: `💿 ${L.tmMoves}`, value: L.noMoves });
    return embed;
  }

  const sortList = tmMoves.map(zh => {
    const tmId  = getTmId(zh);
    const tmNum = tmId ? parseInt(tmId.replace('TM', ''), 10) : 9999;
    const tEm   = typeEmoji(getMoveType(zh));
    const cEm   = moveCatEmoji(zh);
    const name  = moveName(zh, lang);
    const label = tmId ? `\`${tmId}\` ` : '';
    return { tmNum, line: `${label}${tEm}${cEm} **${name}**` };
  });
  sortList.sort((a, b) => a.tmNum - b.tmNum);

  splitToFields(embed, `💿 ${L.tmMoves}`, sortList.map(x => x.line));
  return embed;
}

// ── Tab button row ────────────────────────────────────────────────────────────
const TAB_LABELS = {
  zh: { basic: '基本資料', levelup: '升等招式', tm: 'TM招式' },
  ja: { basic: '基本情報', levelup: '昇格技',   tm: 'わざマシン' },
  en: { basic: 'Basic',   levelup: 'Lv. Moves', tm: 'TM Moves' },
};

function buildTabRow(currentTab, lang, disabled = false) {
  const lbs = TAB_LABELS[lang] ?? TAB_LABELS.zh;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('plza_basic')
      .setLabel(lbs.basic)
      .setStyle(currentTab === 'basic'   ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId('plza_levelup')
      .setLabel(lbs.levelup)
      .setStyle(currentTab === 'levelup' ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId('plza_tm')
      .setLabel(lbs.tm)
      .setStyle(currentTab === 'tm'      ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(disabled),
  );
}

// ── Champion page builder ─────────────────────────────────────────────────────

const GAME_ABBR_LABELS = {
  LGPE: "Let's Go", SWSH: 'Sword/Shield', BDSP: 'Brilliant Diamond/Pearl',
  LA: 'Legends: Arceus', SV: 'Scarlet/Violet', LZA: 'Legends: Z-A',
};

const FLAG_LABELS = {
  'Mega Evolution': '🔮 Mega', 'Gigantamax': '🌀 Gmax', 'Legendary': '⭐ Legendary',
  'Hisuian Form': '🗾 Hisui', 'Galarian Form': '🌿 Galar', 'Alolan Form': '🌺 Alola',
  'Paldean Form': '🌍 Paldea',
};

const CHAMPION_COLOR = 0xD4A017; // gold

function getChampionDisplayName(poke, lang) {
  if (lang === 'zh') return poke.name_zh || poke.name_en || '';
  if (lang === 'ja') return poke.name_ja || poke.name_zh || poke.name_en || '';
  const cap = w => w.charAt(0).toUpperCase() + w.slice(1);
  return (poke.name_en || '').split('-').map(cap).join('-');
}

async function buildChampionPage1(poke, lang) {
  const embed = buildDetailEmbed(poke, lang, CHAMPION_COLOR);
  embed.setTitle(getChampionDisplayName(poke, lang));
  embed.setFooter({ text: `${gameLabel('champion', lang)}` });

  // Height / Weight / Exp Group
  const L = {
    zh: { height: '身高', weight: '體重', exp: '成長組', games: '登場作品', flags: '特性標記', noGames: '無（僅Champion）' },
    ja: { height: '高さ', weight: '重さ', exp: '経験値グループ', games: '登場作品', flags: 'フォームタグ', noGames: 'なし（Champion専用）' },
    en: { height: 'Height', weight: 'Weight', exp: 'Exp. Group', games: 'Compatible Games', flags: 'Form Tags', noGames: 'None (Champion only)' },
  }[lang] ?? { height: 'Height', weight: 'Weight', exp: 'Exp. Group', games: 'Compatible Games', flags: 'Form Tags', noGames: 'None (Champion only)' };

  const hwParts = [];
  if (poke.height_m  != null) hwParts.push(`📏 ${L.height}: **${poke.height_m} m**`);
  if (poke.weight_kg != null) hwParts.push(`⚖️ ${L.weight}: **${poke.weight_kg} kg**`);
  if (poke.exp_group)         hwParts.push(`🧪 ${L.exp}: ${poke.exp_group}`);
  if (hwParts.length) embed.addFields({ name: '\u200b', value: hwParts.join('  ·  '), inline: false });

  // Compatible Games
  const games = poke.compatible_games ?? [];
  const gamesStr = games.length
    ? games.map(g => GAME_ABBR_LABELS[g] ?? g).join(', ')
    : L.noGames;
  embed.addFields({ name: `🎮 ${L.games}`, value: gamesStr, inline: false });

  // Form Flags (Mega, Legendary, etc.) — skip pure UI flags
  const SKIP_FLAGS = new Set(['Hide In Number Sort', 'Hide Model', 'Hide Abilities']);
  const visibleFlags = (poke.flags ?? []).filter(f => !SKIP_FLAGS.has(f));
  if (visibleFlags.length) {
    const flagStr = visibleFlags.map(f => FLAG_LABELS[f] ?? f).join('  ·  ');
    embed.addFields({ name: `✨ ${L.flags}`, value: flagStr, inline: false });
  }

  const s   = poke.stats ?? {};
  const bst = poke.bst || Object.values(s).reduce((a, v) => a + (v || 0), 0);
  try {
    const imgBuf = await buildStatImage(s, bst, lang);
    const file   = new AttachmentBuilder(imgBuf, { name: 'stats.png' });
    embed.setImage('attachment://stats.png');
    return { embed, file };
  } catch {
    return { embed, file: null };
  }
}

// ── Champion page 2: move pool ────────────────────────────────────────────────

const CHAMPION_TAB_LABELS = {
  zh: { basic: '基本資料', moves: '招式學習' },
  ja: { basic: '基本情報', moves: '覚えるわざ' },
  en: { basic: 'Basic',   moves: 'Moves' },
};

const CHAMPION_FOOTER = {
  zh: { p1: '基本資料', p2: '招式學習（來源：Serebii）' },
  ja: { p1: '基本情報', p2: '覚えるわざ（出典：Serebii）' },
  en: { p1: 'Basic Info', p2: 'Moves (source: Serebii)' },
};

// ── Champion form helpers ─────────────────────────────────────────────────────

function findChampionForms(dexId) {
  return loadDb('champion')
    .filter(p => p.dex_id === dexId && !(p.flags ?? []).includes('Hide Model'))
    .sort((a, b) => (a.form_id ?? 0) - (b.form_id ?? 0));
}

function buildChampionFormsRow(currentNameEn, allForms, lang, disabled = false) {
  if (!allForms || allForms.length <= 1) return null;
  const placeholder = lang === 'en' ? '🔀 Switch form'
                    : lang === 'ja' ? '🔀 フォーム切替'
                    :                 '🔀 切換形態';
  const options = allForms.map(f => ({
    label:   getChampionDisplayName(f, lang).slice(0, 100),
    value:   f.name_en,
    default: f.name_en === currentNameEn,
  }));
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('champ_form_select')
      .setPlaceholder(placeholder)
      .setDisabled(disabled)
      .addOptions(options),
  );
}

function buildChampionTabRow(currentTab, lang, disabled = false) {
  const lbs = CHAMPION_TAB_LABELS[lang] ?? CHAMPION_TAB_LABELS.zh;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('champ_basic')
      .setLabel(lbs.basic)
      .setStyle(currentTab === 'basic' ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId('champ_moves')
      .setLabel(lbs.moves)
      .setStyle(currentTab === 'moves' ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(disabled),
  );
}

function buildChampionPage2(poke, lang) {
  const ft = CHAMPION_FOOTER[lang] ?? CHAMPION_FOOTER.zh;
  const lbs = CHAMPION_TAB_LABELS[lang] ?? CHAMPION_TAB_LABELS.zh;

  const embed = new EmbedBuilder()
    .setColor(CHAMPION_COLOR)
    .setTitle(getChampionDisplayName(poke, lang))
    .setFooter({ text: `${gameLabel('champion', lang)} · ${ft.p2}` });

  const movesDb = loadChampionMoves();
  const dexId   = String(poke.dex_id);
  const moveList = movesDb[dexId];

  const noMovesLabel = lang === 'zh' ? '（此寶可夢暫無招式資料）'
                     : lang === 'ja' ? '（わざデータなし）'
                     : '(No move data available)';

  if (!moveList || moveList.length === 0) {
    embed.addFields({ name: `⚔️ ${lbs.moves}`, value: noMovesLabel });
    return embed;
  }

  const lines = moveList.map(enName => {
    const info = getMoveInfoByEn(enName);
    const tEm  = (info.type && info.type !== 'unknown') ? typeEmoji(info.type) : '';
    const cEm  = info.category === 'physical' ? CATEGORY_EMOJI.Physical
               : info.category === 'special'  ? CATEGORY_EMOJI.Special
               : '';
    const name = lang === 'en' ? enName
               : lang === 'ja' ? (info.ja || enName)
               :                 (info.zh || enName);
    return `${tEm}${cEm} **${name}**`;
  });

  splitToFields(embed, `⚔️ ${lbs.moves} (${moveList.length})`, lines);
  return embed;
}

// ── SCVI page builders ────────────────────────────────────────────────────────
const SCVI_FOOTER = {
  zh: { p1: '頁 1/5：基本資料', p2: '頁 2/5：進化路線', p3: '頁 3/5：升等招式', p4: '頁 4/5：TM 招式', p5: '頁 5/5：蛋招式' },
  ja: { p1: 'ページ 1/5：基本情報', p2: 'ページ 2/5：進化', p3: 'ページ 3/5：昇格技', p4: 'ページ 4/5：わざマシン', p5: 'ページ 5/5：タマゴ技' },
  en: { p1: 'Page 1/5: Basic Info', p2: 'Page 2/5: Evolution', p3: 'Page 3/5: Level Moves', p4: 'Page 4/5: TM Moves', p5: 'Page 5/5: Egg Moves' },
};

const SCVI_TAB_LABELS = {
  zh: { basic: '基本資料', evo: '進化路線', levelup: '升等招式', tm: 'TM招式', egg: '蛋招式' },
  ja: { basic: '基本情報', evo: '進化',     levelup: '昇格技',   tm: 'わざマシン', egg: 'タマゴ技' },
  en: { basic: 'Basic',   evo: 'Evolution', levelup: 'Lv. Moves', tm: 'TM Moves',  egg: 'Egg Moves' },
};

const EGG_LABEL = { zh: '蛋招式', ja: 'タマゴ技', en: 'Egg Moves' };
const EVO_LABEL = { zh: '進化路線', ja: '進化', en: 'Evolution' };
const EVO_SELECT_PLACEHOLDER = { zh: '查看進化成員資料', ja: '進化メンバーを見る', en: 'View evo chain member' };
const EVO_NO_EVO = { zh: '此寶可夢不會進化', ja: '進化しない', en: 'Does not evolve' };

// ── Evolution chain helpers ───────────────────────────────────────────────────

function translateEvoMethod(method, lang) {
  if (!method) return null;

  // Normalize scraper artifacts: pokemondb's <small> tags sometimes contain
  // newlines which get_text() concatenates without spaces → "useTart Apple",
  // "afterDragon Cheerlearned", etc.  Fix common patterns before translating.
  let m = method
    .replace(/^use([A-Z])/, 'use $1')          // useTart → use Tart
    .replace(/^after([A-Z])/, 'after $1')       // afterDragon → after Dragon
    .replace(/([a-z])(Tart|Sweet|Syrupy|Dragon|Thunder|Fire|Water|Leaf|Moon|Sun|Shiny|Dusk|Dawn|Ice|High)/g, '$1 $2')
    .replace(/Cheer\s*learned/, 'Cheer learned'); // Cheerlearned → Cheer learned

  if (lang === 'en') return m;

  if (lang === 'zh') {
    m = m.replace(/^Lv\.\s*(\d+)$/, '升$1級');
    // Named items (must come before generic "use" rule)
    m = m.replace(/use\s+Tart Apple/i,   '使用酸蘋果');
    m = m.replace(/use\s+Sweet Apple/i,  '使用甜蘋果');
    m = m.replace(/use\s+Syrupy Apple/i, '使用蜜蘋果');
    m = m.replace(/after.*Dragon Cheer.*learned/i, '學會龍聲鼓舞後');
    m = m.replace(/use\s+Water Stone/i,   '使用水之石');
    m = m.replace(/use\s+Thunder Stone/i, '使用雷之石');
    m = m.replace(/use\s+Fire Stone/i,    '使用火之石');
    m = m.replace(/use\s+Leaf Stone/i,    '使用葉之石');
    m = m.replace(/use\s+Moon Stone/i,    '使用月之石');
    m = m.replace(/use\s+Sun Stone/i,     '使用太陽之石');
    m = m.replace(/use\s+Shiny Stone/i,   '使用光之石');
    m = m.replace(/use\s+Dusk Stone/i,    '使用晚之石');
    m = m.replace(/use\s+Dawn Stone/i,    '使用曙之石');
    m = m.replace(/use\s+Ice Stone/i,     '使用冰之石');
    m = m.replace(/^use\s+/i,             '使用');   // generic fallback
    m = m.replace(/High Friendship/i,     '高親密度');
    m = m.replace(/Friendship/i,          '親密度');
    m = m.replace(/at night/i,            '（夜晚）');
    m = m.replace(/in the day/i,          '（白天）');
    m = m.replace(/knowing\s+/i,          '知道');
    m = m.replace(/Trade/i,               '交換');
  } else if (lang === 'ja') {
    m = m.replace(/^Lv\.\s*(\d+)$/, 'Lv.$1');
    m = m.replace(/use\s+Tart Apple/i,   'タルトのリンゴを使う');
    m = m.replace(/use\s+Sweet Apple/i,  'あまいリンゴを使う');
    m = m.replace(/use\s+Syrupy Apple/i, 'シロップのリンゴを使う');
    m = m.replace(/after.*Dragon Cheer.*learned/i, 'ドラゴンエールを覚えた後');
    m = m.replace(/use\s+Water Stone/i,   'みずのいしを使う');
    m = m.replace(/use\s+Thunder Stone/i, 'かみなりのいしを使う');
    m = m.replace(/use\s+Fire Stone/i,    'ほのおのいしを使う');
    m = m.replace(/use\s+Leaf Stone/i,    'くさのいしを使う');
    m = m.replace(/use\s+Moon Stone/i,    'つきのいしを使う');
    m = m.replace(/use\s+Sun Stone/i,     'たいようのいしを使う');
    m = m.replace(/use\s+Shiny Stone/i,   'ひかりのいしを使う');
    m = m.replace(/use\s+Dusk Stone/i,    'やみのいしを使う');
    m = m.replace(/use\s+Dawn Stone/i,    'めざめのいしを使う');
    m = m.replace(/use\s+Ice Stone/i,     'こおりのいしを使う');
    m = m.replace(/High Friendship/i,     '仲良し度高');
    m = m.replace(/Friendship/i,          '仲良し度');
    m = m.replace(/at night/i,            '（夜）');
    m = m.replace(/in the day/i,          '（昼）');
    m = m.replace(/Trade/i,               '通信交換');
  }
  return m;
}

function buildEvoLine(chain, lang) {
  if (!chain || chain.length === 0) return null;

  // Group by stage
  const stages = {};
  for (const entry of chain) {
    if (!stages[entry.stage]) stages[entry.stage] = [];
    stages[entry.stage].push(entry);
  }

  const stageNums = Object.keys(stages).map(Number).sort((a, b) => a - b);
  if (stageNums.length <= 1 && stages[0]?.length === 1) return null; // no evolution

  const lines = [];
  for (const stageNum of stageNums) {
    const members = stages[stageNum];
    const nameList = members.map(e => {
      // Look up display name from scvi db
      const dbEntry = loadDb('scvi').find(p => p.name_en === e.name_en);
      const displayName = dbEntry ? getPokeDisplayName(dbEntry, lang) : e.name_en;
      const method = e.method ? translateEvoMethod(e.method, lang) : null;
      return method ? `${method} → **${displayName}**` : `**${displayName}**`;
    });
    lines.push(nameList.join('  /  '));
  }

  return lines.join('\n');
}

async function buildScviPage1(poke, lang) {
  const embed = buildDetailEmbed(poke, lang, COLOR);
  const ft = SCVI_FOOTER[lang] ?? SCVI_FOOTER.zh;
  embed.setFooter({ text: `${gameLabel('scvi', lang)} · ${ft.p1}` });

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

function buildScviPageEvo(poke, lang) {
  const ft   = SCVI_FOOTER[lang] ?? SCVI_FOOTER.zh;
  const data = loadScviMoves()[poke.name_en];
  const chain = data?.evolution_chain;

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(getPokeDisplayName(poke, lang))
    .setFooter({ text: `${gameLabel('scvi', lang)} · ${ft.p2}` });

  const evoText = buildEvoLine(chain, lang);
  embed.addFields({
    name:  `<:rarecandy:1489986738997821501> ${EVO_LABEL[lang] ?? EVO_LABEL.zh}`,
    value: evoText ?? (EVO_NO_EVO[lang] ?? EVO_NO_EVO.zh),
  });
  return embed;
}

function buildScviPage2(poke, lang) {
  const L   = DEX_LABELS[lang] ?? DEX_LABELS.zh;
  const ft  = SCVI_FOOTER[lang] ?? SCVI_FOOTER.zh;
  const data = loadScviMoves()[poke.name_en];

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(getPokeDisplayName(poke, lang))
    .setFooter({ text: `${gameLabel('scvi', lang)} · ${ft.p3}` });

  const lvMoves = (data?.level_up_moves ?? []).slice().sort((a, b) => {
    const la = a.level < 0 ? -2 : a.level === 0 ? -1 : a.level;
    const lb = b.level < 0 ? -2 : b.level === 0 ? -1 : b.level;
    return la - lb;
  });

  if (!lvMoves.length) {
    embed.addFields({ name: `📈 ${L.levelUp}`, value: L.noMoves });
    return embed;
  }

  const lines = lvMoves.map(m => {
    const lv   = m.level < 0 ? '回憶' : m.level === 0 ? '進化' : `Lv.${m.level}`;
    const tEm  = typeEmojiByEn(m.move_en);
    const cEm  = catEmojiByEn(m.move_en);
    const name = moveNameByEn(m.move_en, lang);
    return `\`${lv.padEnd(5)}\` ${tEm}${cEm} **${name}**`;
  });

  splitToFields(embed, `📈 ${L.levelUp}`, lines);
  return embed;
}

function buildScviPage3(poke, lang) {
  const L   = DEX_LABELS[lang] ?? DEX_LABELS.zh;
  const ft  = SCVI_FOOTER[lang] ?? SCVI_FOOTER.zh;
  const data = loadScviMoves()[poke.name_en];

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(getPokeDisplayName(poke, lang))
    .setFooter({ text: `${gameLabel('scvi', lang)} · ${ft.p4}` });

  const tmMoves = (data?.tm_moves ?? []).slice().sort((a, b) => a.tm.localeCompare(b.tm));

  if (!tmMoves.length) {
    embed.addFields({ name: `💿 ${L.tmMoves}`, value: L.noMoves });
    return embed;
  }

  const lines = tmMoves.map(m => {
    const tEm  = typeEmojiByEn(m.move_en);
    const cEm  = catEmojiByEn(m.move_en);
    const name = moveNameByEn(m.move_en, lang);
    return `\`TM${m.tm}\` ${tEm}${cEm} **${name}**`;
  });

  splitToFields(embed, `💿 ${L.tmMoves}`, lines);
  return embed;
}

function buildScviPage4(poke, lang) {
  const L   = DEX_LABELS[lang] ?? DEX_LABELS.zh;
  const ft  = SCVI_FOOTER[lang] ?? SCVI_FOOTER.zh;
  const data = loadScviMoves()[poke.name_en];

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(getPokeDisplayName(poke, lang))
    .setFooter({ text: `${gameLabel('scvi', lang)} · ${ft.p5}` });

  const eggMoves = data?.egg_moves ?? [];
  const eggLabel = EGG_LABEL[lang] ?? EGG_LABEL.zh;

  if (!eggMoves.length) {
    embed.addFields({ name: `🥚 ${eggLabel}`, value: L.noMoves });
    return embed;
  }

  const lines = eggMoves.map(m => {
    const tEm  = typeEmojiByEn(m);
    const cEm  = catEmojiByEn(m);
    const name = moveNameByEn(m, lang);
    return `${tEm}${cEm} **${name}**`;
  });

  splitToFields(embed, `🥚 ${eggLabel}`, lines);
  return embed;
}

function buildScviTabRow(currentTab, lang, disabled = false) {
  const lbs = SCVI_TAB_LABELS[lang] ?? SCVI_TAB_LABELS.zh;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('scvi_basic')
      .setLabel(lbs.basic)
      .setStyle(currentTab === 'basic'   ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId('scvi_evo')
      .setLabel(lbs.evo)
      .setStyle(currentTab === 'evo'     ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId('scvi_levelup')
      .setLabel(lbs.levelup)
      .setStyle(currentTab === 'levelup' ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId('scvi_tm')
      .setLabel(lbs.tm)
      .setStyle(currentTab === 'tm'      ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId('scvi_egg')
      .setLabel(lbs.egg)
      .setStyle(currentTab === 'egg'     ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(disabled),
  );
}

function buildEvoSelectRow(chain, lang, currentNameEn, disabled = false) {
  if (!chain || chain.length === 0) return null;

  const seen    = new Set();
  const options = [];
  for (const entry of chain) {
    if (seen.has(entry.name_en)) continue;
    seen.add(entry.name_en);
    const dbEntry     = loadDb('scvi').find(p => p.name_en === entry.name_en);
    const displayName = dbEntry ? getPokeDisplayName(dbEntry, lang) : entry.name_en;
    options.push({
      label:   displayName.slice(0, 100),
      value:   entry.name_en,
      default: entry.name_en === currentNameEn,
    });
  }

  if (options.length <= 1) return null; // no point for solo Pokémon

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('scvi_evo_member')
      .setPlaceholder(EVO_SELECT_PLACEHOLDER[lang] ?? EVO_SELECT_PLACEHOLDER.zh)
      .setDisabled(disabled)
      .addOptions(options),
  );
}

// ── Command ────────────────────────────────────────────────────────────────────
module.exports = {
  data: new SlashCommandBuilder()
    .setName('pokedex')
    .setDescription('查詢寶可夢詳細資料 / Pokémon details: stats, moves, abilities')
    .addStringOption(o => o
      .setName('pokemon')
      .setDescription('寶可夢名稱（中文、日文、英文）/ Pokémon name (zh/ja/en)')
      .setRequired(true)
      .setAutocomplete(true))
    .addStringOption(o => o
      .setName('game')
      .setDescription('遊戲版本 / Game version（預設：Champion）')
      .setRequired(false)
      .addChoices(
        { name: 'Pokémon Champion (預設)',      value: 'champion' },
        { name: '朱紫 (Scarlet/Violet)',        value: 'scvi' },
        { name: '傳說Z-A (Legends: Z-A)',       value: 'plza' },
      ))
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
    const gameId = interaction.options.getString('game') ?? 'champion';
    const lang   = interaction.options.getString('lang') ?? 'zh';
    const pub    = interaction.options.getBoolean('public') ?? false;
    const flags  = pub ? undefined : 64;

    if (!POKEDEX_GAMES[gameId]) {
      await interaction.reply({ content: '❌ Unknown game.', flags: 64 });
      return;
    }

    const poke = findPokemon(gameId, query);
    if (!poke) {
      const gLabel    = gameLabel(gameId, lang);
      const notFound  = lang === 'en' ? 'Not found' : lang === 'ja' ? '見つかりません' : '找不到';
      await interaction.reply({ content: `❌ [${gLabel}] ${notFound}: **${query}**`, flags: 64 });
      return;
    }

    await interaction.deferReply({ flags });

    // ── SCVI: 5-tab interactive view ───────────────────────────────────────────
    if (gameId === 'scvi') {
      let currentPoke = poke;
      let currentTab  = 'basic';
      let movePage    = 0;

      function getEvoChain(p) {
        return loadScviMoves()[p.name_en]?.evolution_chain ?? null;
      }

      function buildScviComponents(tab, p, disabled = false) {
        const tabRow = buildScviTabRow(tab, lang, disabled);
        const selRow = buildEvoSelectRow(getEvoChain(p), lang, p.name_en, disabled);
        const rows   = selRow ? [tabRow, selRow] : [tabRow];

        if (['levelup', 'tm', 'egg'].includes(tab)) {
          const moveList   = getMoveListForTab(p, tab);
          const moveSelRow = buildMoveSelectRow(moveList, movePage, tab, lang, disabled);
          if (moveSelRow) rows.push(moveSelRow);
          const pagRow = buildMovePageRow(moveList.length, movePage, disabled);
          if (pagRow) rows.push(pagRow);
        }
        return rows;
      }

      async function renderTab(tab, p) {
        if (tab === 'basic') {
          const { embed, file } = await buildScviPage1(p, lang);
          return { embeds: [embed], files: file ? [file] : [], components: buildScviComponents(tab, p) };
        }
        const embed =
          tab === 'evo'     ? buildScviPageEvo(p, lang)  :
          tab === 'levelup' ? buildScviPage2(p, lang)    :
          tab === 'tm'      ? buildScviPage3(p, lang)    :
                              buildScviPage4(p, lang);
        return { embeds: [embed], files: [], components: buildScviComponents(tab, p) };
      }

      const msg = await interaction.editReply(await renderTab('basic', currentPoke));

      const collector = msg.createMessageComponentCollector({
        filter: i => i.user.id === interaction.user.id,
        time: 300_000,
      });

      collector.on('collect', async compInt => {
        try {
          if (compInt.isStringSelectMenu() && compInt.customId === 'scvi_move_select') {
            // Show move detail as ephemeral followUp — don't update the main message
            await compInt.deferUpdate();
            const detailEmbed = buildMoveDetailEmbed(compInt.values[0], lang);
            await compInt.followUp({ embeds: [detailEmbed], flags: 64 });
            return;
          }

          await compInt.deferUpdate();

          if (compInt.isStringSelectMenu() && compInt.customId === 'scvi_evo_member') {
            const newPoke = findPokemonByEn('scvi', compInt.values[0]);
            if (newPoke) { currentPoke = newPoke; movePage = 0; }
          } else if (compInt.isButton()) {
            const btn = compInt.customId.replace('scvi_', '');
            if (btn === 'move_prev')      { movePage = Math.max(0, movePage - 1); }
            else if (btn === 'move_next') { movePage++; }
            else                          { currentTab = btn; movePage = 0; }
          }
          await interaction.editReply(await renderTab(currentTab, currentPoke));
        } catch (err) {
          console.error('[pokedex] scvi component error:', err);
        }
      });

      collector.on('end', async () => {
        try {
          await interaction.editReply({ components: buildScviComponents(currentTab, currentPoke, true) });
        } catch { /* message may have been deleted */ }
      });
      return;
    }

    // ── Champion: 2-tab interactive view (basic info + moves) ─────────────────
    if (gameId === 'champion') {
      let currentTab  = 'basic';
      let currentPoke = poke;
      const allForms  = findChampionForms(poke.dex_id);

      function buildChampionComponents(tab, p, disabled = false) {
        const rows = [buildChampionTabRow(tab, lang, disabled)];
        const formRow = buildChampionFormsRow(p.name_en, allForms, lang, disabled);
        if (formRow) rows.push(formRow);
        return rows;
      }

      async function renderChampionTab(tab, p) {
        if (tab === 'basic') {
          const { embed, file } = await buildChampionPage1(p, lang);
          embed.setFooter({ text: `${gameLabel('champion', lang)} · ${(CHAMPION_FOOTER[lang] ?? CHAMPION_FOOTER.zh).p1}` });
          return { embeds: [embed], files: file ? [file] : [], components: buildChampionComponents(tab, p) };
        }
        const embed = buildChampionPage2(p, lang);
        return { embeds: [embed], files: [], components: buildChampionComponents(tab, p) };
      }

      const champMsg = await interaction.editReply(await renderChampionTab('basic', currentPoke));

      const champCollector = champMsg.createMessageComponentCollector({
        filter: i => i.user.id === interaction.user.id,
        time: 300_000,
      });

      champCollector.on('collect', async compInt => {
        await compInt.deferUpdate();
        try {
          if (compInt.isStringSelectMenu() && compInt.customId === 'champ_form_select') {
            const selected = allForms.find(f => f.name_en === compInt.values[0]);
            if (selected) currentPoke = selected;
          } else if (compInt.isButton()) {
            const tab = compInt.customId.replace('champ_', '');
            currentTab = tab;
          }
          await interaction.editReply(await renderChampionTab(currentTab, currentPoke));
        } catch (err) {
          console.error('[pokedex] champion component error:', err);
        }
      });

      champCollector.on('end', async () => {
        try {
          await interaction.editReply({ components: buildChampionComponents(currentTab, currentPoke, true) });
        } catch { /* message may have been deleted */ }
      });
      return;
    }

    // ── PLZA: 3-tab interactive view ───────────────────────────────────────────
    const { embed: embed1, file: file1 } = await buildPlzaPage1(poke, lang);
    const row = buildTabRow('basic', lang);

    const msg = await interaction.editReply({
      embeds:     [embed1],
      files:      file1 ? [file1] : [],
      components: [row],
    });

    let currentTab = 'basic';

    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: i => i.user.id === interaction.user.id,
      time: 300_000, // 5 minutes
    });

    collector.on('collect', async btnInt => {
      await btnInt.deferUpdate();

      const tab = btnInt.customId.replace('plza_', '');
      currentTab = tab;
      const newRow = buildTabRow(tab, lang);

      try {
        if (tab === 'basic') {
          const { embed, file } = await buildPlzaPage1(poke, lang);
          await interaction.editReply({
            embeds:     [embed],
            files:      file ? [file] : [],
            components: [newRow],
          });
        } else if (tab === 'levelup') {
          const embed = buildPlzaPage2(poke, lang);
          await interaction.editReply({
            embeds:     [embed],
            files:      [],
            components: [newRow],
          });
        } else if (tab === 'tm') {
          const embed = buildPlzaPage3(poke, lang);
          await interaction.editReply({
            embeds:     [embed],
            files:      [],
            components: [newRow],
          });
        }
      } catch (err) {
        console.error('[pokedex] button handler error:', err);
      }
    });

    collector.on('end', async () => {
      try {
        const disabledRow = buildTabRow(currentTab, lang, true);
        await interaction.editReply({ components: [disabledRow] });
      } catch { /* message may have been deleted */ }
    });
  },

  async autocomplete(interaction) {
    try {
      const gameId = interaction.options.getString('game') ?? 'champion';
      const q      = interaction.options.getFocused().trim();

      if (!POKEDEX_GAMES[gameId]) {
        await interaction.respond([]);
        return;
      }

      const choices = autocompleteForGame(gameId, q);
      await interaction.respond(choices);
    } catch (err) {
      console.error('[pokedex] autocomplete error:', err);
      try { await interaction.respond([]); } catch { /* too late */ }
    }
  },
};
