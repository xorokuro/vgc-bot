'use strict';

/**
 * Shared search engine for mainline Pokémon dex commands.
 *
 * Adding a new game: add an entry to GAME_CONFIGS and add the
 * corresponding db JSON file to data/.
 *
 * Query syntax (same for all games):
 *   火系               has Fire type
 *   克火               any of the Pokémon's types is super-effective vs Fire
 *   抗火               combined typing resists Fire (≤0.5×)
 *   克火兼鋼           a SINGLE one of its types beats both Fire AND Steel
 *   s>=100             Speed ≥ 100
 *   bst>550            BST > 550
 *   a>c                Attack > Sp.Atk (stat vs stat)
 *   十萬伏特           knows Thunderbolt (any method)
 *   十萬伏特 升等學    learns Thunderbolt by level-up   (PLZA only)
 *   十萬伏特 TM學      learns Thunderbolt via TM        (PLZA only)
 *   mega               is a Mega form
 *   AND / OR / NOT     logical operators
 *   ( )                grouping
 *
 * Chinese operators (而且, 或, 不是 etc.) are auto-translated.
 * English move / ability names are also accepted.
 */

const fs   = require('fs');
const path = require('path');

// ── Type chart (Gen 6+) ───────────────────────────────────────────────────────
// TYPE_CHART[attackingType][defendingType] = multiplier (omitted = 1)
// Type names are Title-case: "Fire", "Water", etc.
const TYPE_CHART = {
  Normal:   { Rock: 0.5, Ghost: 0, Steel: 0.5 },
  Fire:     { Fire: 0.5, Water: 0.5, Grass: 2, Ice: 2, Bug: 2, Rock: 0.5, Dragon: 0.5, Steel: 2 },
  Water:    { Fire: 2, Water: 0.5, Grass: 0.5, Ground: 2, Rock: 2, Dragon: 0.5 },
  Electric: { Water: 2, Electric: 0.5, Grass: 0.5, Ground: 0, Flying: 2, Dragon: 0.5 },
  Grass:    { Fire: 0.5, Water: 2, Grass: 0.5, Poison: 0.5, Ground: 2, Flying: 0.5, Bug: 0.5, Rock: 2, Dragon: 0.5, Steel: 0.5 },
  Ice:      { Water: 0.5, Grass: 2, Ice: 0.5, Ground: 2, Flying: 2, Dragon: 2, Steel: 0.5 },
  Fighting: { Normal: 2, Ice: 2, Poison: 0.5, Flying: 0.5, Psychic: 0.5, Bug: 0.5, Rock: 2, Ghost: 0, Dark: 2, Steel: 2, Fairy: 0.5 },
  Poison:   { Grass: 2, Poison: 0.5, Ground: 0.5, Rock: 0.5, Ghost: 0.5, Steel: 0, Fairy: 2 },
  Ground:   { Fire: 2, Electric: 2, Grass: 0.5, Poison: 2, Flying: 0, Bug: 0.5, Rock: 2, Steel: 2 },
  Flying:   { Electric: 0.5, Grass: 2, Fighting: 2, Bug: 2, Rock: 0.5, Steel: 0.5 },
  Psychic:  { Fighting: 2, Poison: 2, Psychic: 0.5, Dark: 0, Steel: 0.5 },
  Bug:      { Fire: 0.5, Grass: 2, Fighting: 0.5, Flying: 0.5, Psychic: 2, Ghost: 0.5, Dark: 2, Steel: 0.5, Fairy: 0.5 },
  Rock:     { Fire: 2, Ice: 2, Fighting: 0.5, Ground: 0.5, Flying: 2, Bug: 2, Steel: 0.5 },
  Ghost:    { Normal: 0, Psychic: 2, Ghost: 2, Dark: 0.5 },
  Dragon:   { Dragon: 2, Steel: 0.5, Fairy: 0 },
  Dark:     { Fighting: 0.5, Psychic: 2, Ghost: 2, Dark: 0.5, Fairy: 0.5 },
  Steel:    { Fire: 0.5, Water: 0.5, Electric: 0.5, Ice: 2, Rock: 2, Steel: 0.5, Fairy: 2 },
  Fairy:    { Fighting: 2, Poison: 0.5, Bug: 0.5, Dragon: 2, Dark: 2, Steel: 0.5 },
};

function cap(s) { return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : ''; }

// Multiplier of attackType (lowercase) hitting a Pokémon with defTypes (array of lowercase)
function effectiveness(attackTypeLC, defTypesLC) {
  const atk = cap(attackTypeLC);
  let mult = 1;
  for (const dt of defTypesLC) mult *= (TYPE_CHART[atk]?.[cap(dt)] ?? 1);
  return mult;
}

// ── Translation maps ──────────────────────────────────────────────────────────
const ZH_HANT = require('../../data/zh-Hant.json');

function toApiId(s) {
  return s.toLowerCase().replace(/\s+/g, '-').replace(/[''',.:]/g, '');
}

// ZH/EN move name → PokéAPI ID (e.g. 十萬伏特 / Thunderbolt → thunderbolt)
const ZH_TO_MOVE_ID = {};
const EN_TO_MOVE_ID = {};
// ID → ZH (first mapping wins — used for PLZA lookup)
const MOVE_ID_TO_ZH = {};

for (const [en, zh] of Object.entries(ZH_HANT.moves || {})) {
  const id = toApiId(en);
  if (zh) {
    ZH_TO_MOVE_ID[zh] = id;
    if (!MOVE_ID_TO_ZH[id]) MOVE_ID_TO_ZH[id] = zh;
  }
  EN_TO_MOVE_ID[en.toLowerCase()] = id;
  EN_TO_MOVE_ID[id] = id;
}

// ZH/EN ability name → API ID
const ZH_TO_ABILITY_ID = {};
const EN_TO_ABILITY_ID = {};
for (const [en, zh] of Object.entries(ZH_HANT.abilities || {})) {
  const id = toApiId(en);
  if (zh) ZH_TO_ABILITY_ID[zh] = id;
  EN_TO_ABILITY_ID[en.toLowerCase()] = id;
  EN_TO_ABILITY_ID[id] = id;
}

// ZH/EN type name → lowercase English (e.g. 火/火系/Fire → fire)
const ZH_TO_TYPE = {};
const EN_TO_TYPE = {};
for (const [en, zh] of Object.entries(ZH_HANT.types || {})) {
  if (!en || en === '???') continue;
  const low = en.toLowerCase();
  EN_TO_TYPE[low] = low;
  if (zh) { ZH_TO_TYPE[zh] = low; ZH_TO_TYPE[zh + '系'] = low; }
}
Object.assign(ZH_TO_TYPE, {
  '炎': 'fire',     '炎系': 'fire',
  '電': 'electric', '電系': 'electric', '電氣': 'electric', '電氣系': 'electric',
  '地': 'ground',   '地系': 'ground',   '大地': 'ground',
  '飛': 'flying',   '飛系': 'flying',
  '靈': 'ghost',    '靈系': 'ghost',
  '格': 'fighting', '格鬥系': 'fighting',
  '超': 'psychic',  '超能': 'psychic',  '超能力系': 'psychic',
  '龍': 'dragon',   '龍系': 'dragon',
  '惡': 'dark',     '惡系': 'dark',
  '妖': 'fairy',    '妖精系': 'fairy',
  '蟲': 'bug',      '蟲系': 'bug',
  '石': 'rock',     '岩石系': 'rock',
  '鬼': 'ghost',    '幽靈系': 'ghost',
});

function resolveType(term) {
  return ZH_TO_TYPE[term] || EN_TO_TYPE[term?.toLowerCase()] || null;
}

// Resolve a query term to a move: returns { id, zh } or null
function resolveMove(term) {
  const id = ZH_TO_MOVE_ID[term] || EN_TO_MOVE_ID[term?.toLowerCase()];
  if (!id) return null;
  const zh = MOVE_ID_TO_ZH[id] || term;
  return { id, zh };
}

// Resolve ability: returns API id or null
function resolveAbility(term) {
  return ZH_TO_ABILITY_ID[term] || EN_TO_ABILITY_ID[term?.toLowerCase()] || null;
}

// ── Stat aliases ──────────────────────────────────────────────────────────────
const STAT_ALIAS = {
  hp: 'hp', h: 'hp',
  attack: 'attack', atk: 'attack', a: 'attack', '攻擊': 'attack',
  defense: 'defense', def: 'defense', b: 'defense', '防禦': 'defense',
  'special-attack': 'special-attack', spatk: 'special-attack', spa: 'special-attack',
  c: 'special-attack', '特攻': 'special-attack',
  'special-defense': 'special-defense', spdef: 'special-defense', spd: 'special-defense',
  d: 'special-defense', '特防': 'special-defense',
  speed: 'speed', s: 'speed', '速度': 'speed',
  bst: 'bst', total: 'bst', '總和': 'bst', '種族值': 'bst',
};

function resolveStat(s) { return STAT_ALIAS[s] || STAT_ALIAS[s?.toLowerCase()] || null; }

function getBST(stats) { return Object.values(stats).reduce((a, v) => a + (v || 0), 0); }

function getStatVal(poke, key) {
  if (key === 'bst') return getBST(poke.stats);
  return poke.stats[key] ?? 0;
}

// ── Champion move ID → English display name ───────────────────────────────────
// Used by the champion hasMove implementation.
// e.g. 'darkest-lariat' → 'Darkest Lariat'
const MOVE_ID_TO_EN = {};
for (const en of Object.keys(ZH_HANT.moves || {})) {
  const id = toApiId(en);
  MOVE_ID_TO_EN[id] = en;
}

// Lazy-loaded champion moves db: { dex_id_str: [enName, ...] }
let _championMovesDb = null;
function loadChampionMovesDb() {
  if (!_championMovesDb) {
    try {
      _championMovesDb = JSON.parse(
        fs.readFileSync(path.join(__dirname, '../../data/champion_moves_db.json'), 'utf8'),
      );
    } catch {
      _championMovesDb = {};
    }
  }
  return _championMovesDb;
}

// ── Game configurations ───────────────────────────────────────────────────────
// To add a new game: add an entry here and place the DB JSON in data/.

const GAME_CONFIGS = {
  scvi: {
    labelZh: '朱紫',
    labelEn: 'Scarlet/Violet',
    dbFile:  'pokedex_scvi_db.json',
    // All moves in one flat list (PokéAPI IDs)
    hasMove(poke, moveId, _method) {
      return (poke.moves_en || []).includes(moveId);
    },
    supportsMethod: false,   // no level-up / TM distinction
  },
  plza: {
    labelZh: '傳說Z-A',
    labelEn: 'Legends: Z-A',
    dbFile:  'pokedex_plza_db.json',
    // Moves stored as Chinese names in Level Up Moves[] and TM Learn[]
    hasMove(poke, moveId, method) {
      const zh = MOVE_ID_TO_ZH[moveId];
      if (!zh) return false;
      const inLv = (poke['Level Up Moves'] || []).some(m => m.move_zh === zh);
      const inTm = (poke['TM Learn'] || []).includes(zh);
      if (method === 'levelup') return inLv;
      if (method === 'tm')      return inTm;
      return inLv || inTm;
    },
    supportsMethod: true,
  },
  champion: {
    labelZh: 'Champion',
    labelEn: 'Pokémon Champion',
    dbFile:  'pokedex_champion_db.json',
    // Only dex IDs confirmed in the Champion roster (Serebii pokemonchampions/pokemon.shtml)
    dexIdFilter: new Set([
      3,6,9,15,18,24,25,26,36,38,59,65,68,71,80,94,115,121,127,128,
      130,132,134,135,136,142,143,149,154,157,160,168,181,184,186,196,
      197,199,205,208,212,214,227,229,248,279,282,302,306,308,310,319,
      323,324,334,350,351,354,358,359,362,389,392,395,405,407,409,411,
      428,442,445,448,450,454,460,461,464,470,471,472,473,475,478,479,
      497,500,503,505,510,512,514,516,530,531,534,547,553,563,569,571,
      579,584,587,609,614,618,623,635,637,652,655,658,660,663,666,670,
      671,675,676,678,681,683,685,693,695,697,699,700,701,702,706,707,
      709,711,713,715,724,727,730,733,740,745,748,750,752,758,763,765,
      766,778,780,784,823,841,842,844,855,858,866,867,869,877,887,899,
      900,902,903,908,911,914,925,934,936,937,939,952,956,959,964,968,
      970,981,983,1013,1018,1019,
    ]),
    // Moves stored as English display names in champion_moves_db.json by dex_id
    hasMove(poke, moveId) {
      const enName = MOVE_ID_TO_EN[moveId];
      if (!enName) return false;
      const db    = loadChampionMovesDb();
      const moves = db[String(poke.dex_id)] ?? [];
      return moves.includes(enName);
    },
    supportsMethod: false,
  },
};

// ── Database loader ───────────────────────────────────────────────────────────
const _dbCache = {};

function loadDb(gameId) {
  if (_dbCache[gameId]) return _dbCache[gameId];
  const cfg  = GAME_CONFIGS[gameId];
  const p    = path.join(__dirname, '../../data', cfg.dbFile);
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  // Convert to array for uniform iteration; apply dex roster filter if defined
  let entries = Object.values(data);
  if (cfg.dexIdFilter) entries = entries.filter(p => cfg.dexIdFilter.has(p.dex_id));
  _dbCache[gameId] = entries;
  console.log(`[dex] Loaded ${_dbCache[gameId].length} entries for ${gameId}`);
  return _dbCache[gameId];
}

// ── Chinese operator normalization ────────────────────────────────────────────
const ZH_OPS = [
  ['而且是', ' AND '], ['還要是', ' AND '], ['而且', ' AND '], ['還要', ' AND '],
  ['並且',   ' AND '], ['以及',   ' AND '],
  ['或者是', ' OR '],  ['或者',   ' OR '],  ['或是', ' OR '], ['或', ' OR '],
  ['但不要是', ' NOT '], ['但不要', ' NOT '], ['但不是', ' NOT '],
  ['不要是', ' NOT '], ['不要', ' NOT '], ['不是', ' NOT '], ['排除', ' NOT '],
];

function normalizeQuery(q) {
  q = q.replace(/[（）　]/g, c => ({ '（': '(', '）': ')', '　': ' ' }[c]));
  for (const [zh, en] of ZH_OPS) q = q.split(zh).join(en);
  return q.trim();
}

// ── Learning method keywords ──────────────────────────────────────────────────
const LEVELUP_KW = new Set([
  '升等招式', '升級招式', '升級學', '等級學', '升等學', '升等',
  '等級招式', '升級能學會', '升等能學會', '升級能學', '升等能學', '升級',
]);
const TM_KW = new Set([
  'TM招式', 'TM學', '招式機', '招式學習器', '秘傳學習器', 'HM招式', 'HM學',
  'TM', 'HM', 'TM能學', 'HM能學', '招式機能學', '招式機學習器能學',
]);

// ── Tokenizer ─────────────────────────────────────────────────────────────────
// Splits by whitespace then extracts attached parentheses.
// Returns an array of raw string tokens (operators, parens, terms).
function tokenize(q) {
  const raw    = q.split(/\s+/);
  const tokens = [];
  for (const t of raw) {
    if (!t) continue;
    let cur = t;
    const leading = [];
    while (cur.startsWith('(')) { leading.push('('); cur = cur.slice(1); }
    const trailing = [];
    while (cur.endsWith(')'))   { trailing.push(')'); cur = cur.slice(0, -1); }
    tokens.push(...leading);
    if (cur) tokens.push(cur);
    tokens.push(...trailing);
  }
  return tokens;
}

// ── Post-tokenize: combine move + learning-method adjacent tokens ─────────────
// "十萬伏特" "升等學" → "MOVE:thunderbolt:levelup"
// "十萬伏特" "TM"     → "MOVE:thunderbolt:tm"
// "十萬伏特"          → "MOVE:thunderbolt:any"
//
// Also detects stat comparisons and normalises them to "STAT:statA:op:valOrStat".
function postProcess(tokens) {
  const out = [];

  const STAT_CMP_RE = /^([\w\u4e00-\u9fff-]+)(>=|<=|>|<|=)(\d+|[\w\u4e00-\u9fff-]+)$|^(\d+)(>=|<=|>|<|=)([\w\u4e00-\u9fff-]+)$/i;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];

    // Logical operators & parens — pass through
    if (/^(AND|OR|NOT)$/i.test(t)) { out.push(t.toUpperCase()); continue; }
    if (t === '(' || t === ')')    { out.push(t); continue; }

    // Stat comparison check
    const sm = STAT_CMP_RE.exec(t);
    if (sm) {
      let statA, op, valStr;
      if (sm[1]) { statA = sm[1]; op = sm[2]; valStr = sm[3]; }
      else       { valStr = sm[4]; op = flipOp(sm[5]); statA = sm[6]; }

      const resolvedA = resolveStat(statA);
      if (resolvedA) {
        const numVal = parseFloat(valStr);
        if (!isNaN(numVal)) {
          out.push(`STAT:${resolvedA}:${op}:${numVal}`);
        } else {
          const resolvedB = resolveStat(valStr);
          if (resolvedB) out.push(`STAT:${resolvedA}:${op}:${resolvedB}`);
          else out.push(t); // fallback
        }
        continue;
      }
    }

    // Spaced stat comparison: "速度 > 100" or "s >= 100" (three separate tokens)
    const resolvedStatA = resolveStat(t);
    if (resolvedStatA) {
      const next1 = tokens[i + 1];
      const next2 = tokens[i + 2];
      if (next1 && /^(>=|<=|>|<|=)$/.test(next1) && next2 !== undefined) {
        const numVal = parseFloat(next2);
        if (!isNaN(numVal)) {
          out.push(`STAT:${resolvedStatA}:${next1}:${numVal}`);
          i += 2;
          continue;
        }
        const resolvedStatB = resolveStat(next2);
        if (resolvedStatB) {
          out.push(`STAT:${resolvedStatA}:${next1}:${resolvedStatB}`);
          i += 2;
          continue;
        }
      }
    }

    // Spaced reversed comparison: "100 > 速度"
    const numFirst = Number(t);
    if (!isNaN(numFirst) && /^\d+(\.\d+)?$/.test(t)) {
      const next1 = tokens[i + 1];
      const next2 = tokens[i + 2];
      if (next1 && /^(>=|<=|>|<|=)$/.test(next1) && next2) {
        const resolvedStatB = resolveStat(next2);
        if (resolvedStatB) {
          out.push(`STAT:${resolvedStatB}:${flipOp(next1)}:${numFirst}`);
          i += 2;
          continue;
        }
      }
    }

    // Move + optional learning method
    const mv = resolveMove(t);
    if (mv) {
      const next = tokens[i + 1];
      let method = 'any';
      if (next && LEVELUP_KW.has(next)) { method = 'levelup'; i++; }
      else if (next && TM_KW.has(next)) { method = 'tm';      i++; }
      out.push(`MOVE:${mv.id}:${mv.zh}:${method}`);
      continue;
    }

    // Multi-word English move name: "Fake Out" → "fake-out", "High Horsepower" → "high-horsepower"
    // Try joining current + next 1-3 tokens with hyphens (stop at operators/parens)
    {
      let found = false;
      for (let look = 1; look <= 3 && !found; look++) {
        const peek = tokens[i + look];
        if (!peek || /^(AND|OR|NOT)$/i.test(peek) || peek === '(' || peek === ')') break;
        const candidate = [t, ...tokens.slice(i + 1, i + 1 + look)].join('-');
        const mv2 = resolveMove(candidate);
        if (mv2) {
          i += look;
          let method = 'any';
          const methodTok = tokens[i + 1];
          if (methodTok && LEVELUP_KW.has(methodTok)) { method = 'levelup'; i++; }
          else if (methodTok && TM_KW.has(methodTok)) { method = 'tm'; i++; }
          out.push(`MOVE:${mv2.id}:${mv2.zh}:${method}`);
          found = true;
        }
      }
      if (found) continue;
    }

    // Standalone learning method keywords (after non-move token — syntax error)
    if (LEVELUP_KW.has(t) || TM_KW.has(t)) {
      throw new SyntaxError(`語法錯誤：「${t}」必須緊接在招式名稱之後。`);
    }

    // Type matchup prefix separated from type by a space: "耐 水" → "耐水", "克 水 兼 火" → "克水兼火"
    const ALL_MATCHUP_PFX = new Set([...BEATS_PFX, ...RESISTS_PFX]);
    if (ALL_MATCHUP_PFX.has(t) && tokens[i + 1] && resolveType(tokens[i + 1])) {
      let combined = t + tokens[i + 1];
      i++;
      // absorb optional spaced 兼 + type pairs
      while (tokens[i + 1] === '兼' && tokens[i + 2] && resolveType(tokens[i + 2])) {
        combined += '兼' + tokens[i + 2];
        i += 2;
      }
      out.push(combined);
      continue;
    }

    out.push(t);
  }
  return out;
}

function flipOp(op) {
  return { '>': '<', '<': '>', '>=': '<=', '<=': '>=' }[op] ?? op;
}

// ── Insert implicit AND between adjacent operands ─────────────────────────────
function insertImplicitAnd(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    out.push(t);
    if (i + 1 < tokens.length) {
      const next = tokens[i + 1];
      const tIsOperand    = t    !== 'AND' && t    !== 'OR' && t    !== 'NOT' && t    !== '(';
      const nextIsOperand = next !== 'AND' && next !== 'OR' && next !== 'NOT' && next !== ')';
      if (tIsOperand && nextIsOperand) out.push('AND');
    }
  }
  return out;
}

// ── Shunting-yard: infix → RPN ────────────────────────────────────────────────
const PREC = { 'NOT': 3, 'AND': 2, 'OR': 1 };

function shuntingYard(tokens) {
  const output = [], ops = [];
  for (const t of tokens) {
    if (t === 'NOT' || t === 'AND' || t === 'OR') {
      while (ops.length && ops[ops.length - 1] !== '(' &&
             (PREC[ops[ops.length - 1]] ?? 0) >= PREC[t]) {
        output.push(ops.pop());
      }
      ops.push(t);
    } else if (t === '(') {
      ops.push(t);
    } else if (t === ')') {
      while (ops.length && ops[ops.length - 1] !== '(') output.push(ops.pop());
      if (!ops.length) throw new SyntaxError('語法錯誤：括號不匹配。');
      ops.pop(); // discard (
    } else {
      output.push(t); // operand
    }
  }
  while (ops.length) {
    const op = ops.pop();
    if (op === '(') throw new SyntaxError('語法錯誤：括號不匹配。');
    output.push(op);
  }
  return output;
}

// ── Operand evaluation ────────────────────────────────────────────────────────
// Prefixes for beats/resists
const BEATS_PFX   = ['克制', '剋制', '克', '剋'];
const RESISTS_PFX = ['抵抗', '耐受', '耐', '抗'];

// Return { mode:'beats'|'resists', types:[string,...] } or null
function parseTypeMatchup(term) {
  for (const pfx of BEATS_PFX) {
    if (term.startsWith(pfx)) {
      const rest  = term.slice(pfx.length);
      const types = rest.split('兼').map(resolveType).filter(Boolean);
      return types.length ? { mode: 'beats', types } : null;
    }
  }
  for (const pfx of RESISTS_PFX) {
    if (term.startsWith(pfx)) {
      const rest  = term.slice(pfx.length);
      const types = rest.split('兼').map(resolveType).filter(Boolean);
      return types.length ? { mode: 'resists', types } : null;
    }
  }
  return null;
}

const MEGA_TERMS = new Set(['mega', 'MEGA', '超級進化', '超進化', '可超進化', '可超級進化', 'Mega']);

function evalOperand(poke, token, cfg) {
  // ── STAT comparison ──────────────────────────────────────────────────────
  if (token.startsWith('STAT:')) {
    const [, statA, op, valStr] = token.split(':');
    const a = getStatVal(poke, statA);
    const b = isNaN(Number(valStr)) ? getStatVal(poke, valStr) : Number(valStr);
    if (op === '>')  return a >  b;
    if (op === '<')  return a <  b;
    if (op === '>=') return a >= b;
    if (op === '<=') return a <= b;
    if (op === '=')  return a === b;
    return false;
  }

  // ── MOVE check ───────────────────────────────────────────────────────────
  if (token.startsWith('MOVE:')) {
    const [, moveId, , method] = token.split(':');
    return cfg.hasMove(poke, moveId, method);
  }

  // ── Mega check ───────────────────────────────────────────────────────────
  if (MEGA_TERMS.has(token)) {
    const name = (poke.name_zh || poke.name_en || '').toLowerCase();
    return name.includes('超級') || name.includes('mega');
  }

  // ── Type matchup (克/抗) ─────────────────────────────────────────────────
  const matchup = parseTypeMatchup(token);
  if (matchup) {
    const defTypes = poke.types_en || [];
    if (matchup.mode === 'beats') {
      if (matchup.types.length === 1) {
        // Any of the Pokémon's types deals 2× to the target type
        return defTypes.some(dt => effectiveness(dt, [matchup.types[0]]) >= 2);
      } else {
        // A SINGLE one of its types beats EVERY listed type
        return defTypes.some(dt =>
          matchup.types.every(tgt => effectiveness(dt, [tgt]) >= 2),
        );
      }
    } else { // resists
      // Combined typing takes ≤0.5× from each target type
      return matchup.types.every(tgt => effectiveness(tgt, defTypes) <= 0.5);
    }
  }

  // ── Type membership ──────────────────────────────────────────────────────
  const typeEn = resolveType(token);
  if (typeEn) {
    return (poke.types_en || []).includes(typeEn);
  }

  // ── Ability ──────────────────────────────────────────────────────────────
  const abilityId = resolveAbility(token);
  if (abilityId) {
    return (poke.abilities || []).some(a => a.name === abilityId);
  }

  // ── Fallback: partial name match (ZH or EN) ───────────────────────────────
  const q = token.toLowerCase();
  return (poke.name_zh || '').includes(token) ||
         (poke.name_en || '').toLowerCase().includes(q);
}

// ── RPN evaluator ─────────────────────────────────────────────────────────────
function evalRPN(poke, rpn, cfg) {
  const stack = [];
  for (const t of rpn) {
    if (t === 'AND') {
      const b = stack.pop(), a = stack.pop();
      stack.push(a && b);
    } else if (t === 'OR') {
      const b = stack.pop(), a = stack.pop();
      stack.push(a || b);
    } else if (t === 'NOT') {
      stack.push(!stack.pop());
    } else {
      stack.push(evalOperand(poke, t, cfg));
    }
  }
  return stack[0] ?? false;
}

// ── Public search function ────────────────────────────────────────────────────
/**
 * @param {string} rawQuery  User's search string
 * @param {string} gameId    One of the keys in GAME_CONFIGS
 * @returns {{ results: object[], query: string }}
 * @throws {SyntaxError} on invalid query syntax
 */
function searchPokemon(rawQuery, gameId) {
  const cfg = GAME_CONFIGS[gameId];
  if (!cfg) throw new Error(`Unknown game: ${gameId}`);

  const q = normalizeQuery(rawQuery);
  if (!q) return { results: [], query: rawQuery };

  const raw    = tokenize(q);
  const proc   = postProcess(raw);
  const withAnd = insertImplicitAnd(proc);
  const rpn    = shuntingYard(withAnd);

  const db      = loadDb(gameId);
  const results = db.filter(poke => evalRPN(poke, rpn, cfg));

  return { results, query: q };
}

/** Look up a single Pokémon by its numeric dex_id + form_id from the game's DB. */
function findPokeByIds(gameId, dexId, formId) {
  const entries = loadDb(gameId);
  return entries.find(p => p.dex_id === dexId && (p.form_id ?? 0) === formId) ?? null;
}

module.exports = { searchPokemon, GAME_CONFIGS, findPokeByIds };
