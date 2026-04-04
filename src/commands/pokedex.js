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
    entries.find(e => e.name_zh.includes(q)) ??
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
    const ja = _zhToJaPoke?.[e.name_zh] || '';

    if (zh.startsWith(q))         startZh.push(e);
    else if (en.startsWith(qLow)) startEn.push(e);
    else if (ja.startsWith(q))    startJa.push(e);
    else if (zh.includes(q))      hasZh.push(e);
    else if (en.includes(qLow))   hasEn.push(e);
    else if (ja.includes(q))      hasJa.push(e);
  }

  return [...startZh, ...startEn, ...startJa, ...hasZh, ...hasEn, ...hasJa]
    .slice(0, 25)
    .map(e => ({
      name:  `${e.name_zh}  ${e.name_en}`.slice(0, 100),
      value: e.name_zh || e.name_en,
    }));
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

// ── SCVI page builders ────────────────────────────────────────────────────────
const SCVI_FOOTER = {
  zh: { p1: '頁 1/4：基本資料', p2: '頁 2/4：升等招式', p3: '頁 3/4：TM 招式', p4: '頁 4/4：蛋招式' },
  ja: { p1: 'ページ 1/4：基本情報', p2: 'ページ 2/4：昇格技', p3: 'ページ 3/4：わざマシン', p4: 'ページ 4/4：タマゴ技' },
  en: { p1: 'Page 1/4: Basic Info', p2: 'Page 2/4: Level Moves', p3: 'Page 3/4: TM Moves', p4: 'Page 4/4: Egg Moves' },
};

const SCVI_TAB_LABELS = {
  zh: { basic: '基本資料', levelup: '升等招式', tm: 'TM招式', egg: '蛋招式' },
  ja: { basic: '基本情報', levelup: '昇格技',   tm: 'わざマシン', egg: 'タマゴ技' },
  en: { basic: 'Basic',   levelup: 'Lv. Moves', tm: 'TM Moves',   egg: 'Egg Moves' },
};

const EGG_LABEL = { zh: '蛋招式', ja: 'タマゴ技', en: 'Egg Moves' };

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

function buildScviPage2(poke, lang) {
  const L   = DEX_LABELS[lang] ?? DEX_LABELS.zh;
  const ft  = SCVI_FOOTER[lang] ?? SCVI_FOOTER.zh;
  const data = loadScviMoves()[poke.name_en];

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(getPokeDisplayName(poke, lang))
    .setFooter({ text: `${gameLabel('scvi', lang)} · ${ft.p2}` });

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
    .setFooter({ text: `${gameLabel('scvi', lang)} · ${ft.p3}` });

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
    .setFooter({ text: `${gameLabel('scvi', lang)} · ${ft.p4}` });

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

    const poke = findPokemon(gameId, query);
    if (!poke) {
      const gLabel    = gameLabel(gameId, lang);
      const notFound  = lang === 'en' ? 'Not found' : lang === 'ja' ? '見つかりません' : '找不到';
      await interaction.reply({ content: `❌ [${gLabel}] ${notFound}: **${query}**`, flags: 64 });
      return;
    }

    await interaction.deferReply({ flags });

    // ── SCVI: 4-tab interactive view ───────────────────────────────────────────
    if (gameId === 'scvi') {
      const { embed: embed1, file: file1 } = await buildScviPage1(poke, lang);
      const row = buildScviTabRow('basic', lang);

      const msg = await interaction.editReply({
        embeds:     [embed1],
        files:      file1 ? [file1] : [],
        components: [row],
      });

      let currentTab = 'basic';

      const collector = msg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: i => i.user.id === interaction.user.id,
        time: 300_000,
      });

      collector.on('collect', async btnInt => {
        await btnInt.deferUpdate();
        const tab    = btnInt.customId.replace('scvi_', '');
        currentTab   = tab;
        const newRow = buildScviTabRow(tab, lang);
        try {
          if (tab === 'basic') {
            const { embed, file } = await buildScviPage1(poke, lang);
            await interaction.editReply({ embeds: [embed], files: file ? [file] : [], components: [newRow] });
          } else if (tab === 'levelup') {
            await interaction.editReply({ embeds: [buildScviPage2(poke, lang)], files: [], components: [newRow] });
          } else if (tab === 'tm') {
            await interaction.editReply({ embeds: [buildScviPage3(poke, lang)], files: [], components: [newRow] });
          } else if (tab === 'egg') {
            await interaction.editReply({ embeds: [buildScviPage4(poke, lang)], files: [], components: [newRow] });
          }
        } catch (err) {
          console.error('[pokedex] scvi button error:', err);
        }
      });

      collector.on('end', async () => {
        try {
          await interaction.editReply({ components: [buildScviTabRow(currentTab, lang, true)] });
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
