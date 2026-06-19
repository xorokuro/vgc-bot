'use strict';
/*
 * web/search.js — browser port of the bot's dexSearch.js grammar.
 *
 * Query syntax (identical to the Discord /search pokemon command), accepting
 * English, Traditional Chinese AND Japanese terms:
 *   fire / 火系 / ほのお          has Fire type
 *   克火 / beats fire             one of its types is super-effective vs Fire
 *   抗火 / resists fire           combined typing resists Fire (<=0.5x)
 *   bst>550   s>=100   a>c        stat comparisons (vs number or vs stat)
 *   thunderbolt / 十萬伏特        knows Thunderbolt
 *   fire special moves            knows any Fire-type special move
 *   dragon moves                  knows any Dragon-type move
 *   mega                          is a Mega form
 *   AND / OR / NOT  ( )           boolean logic + grouping
 *
 * Public API:  DexSearch.init(window.DEX);  DexSearch.search(query, {includeStatus})
 *              -> { results: pokemon[], rpn: string[] }   (throws SyntaxError)
 */
(function (global) {
  // ── Type chart (Gen 6+) ──────────────────────────────────────────────────
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
    Bug:      { Fire: 0.5, Grass: 2, Fighting: 0.5, Flying: 0.5, Psychic: 2, Ghost: 0.5, Dark: 2, Steel: 0.5, Poison: 0.5, Fairy: 0.5 },
    Rock:     { Fire: 2, Ice: 2, Fighting: 0.5, Ground: 0.5, Flying: 2, Bug: 2, Steel: 0.5 },
    Ghost:    { Normal: 0, Psychic: 2, Ghost: 2, Dark: 0.5 },
    Dragon:   { Dragon: 2, Steel: 0.5, Fairy: 0 },
    Dark:     { Fighting: 0.5, Psychic: 2, Ghost: 2, Dark: 0.5, Fairy: 0.5 },
    Steel:    { Fire: 0.5, Water: 0.5, Electric: 0.5, Ice: 2, Rock: 2, Steel: 0.5, Fairy: 2 },
    Fairy:    { Fighting: 2, Poison: 0.5, Fire: 0.5, Dragon: 2, Dark: 2, Steel: 0.5 },
  };
  const cap = s => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : '');
  function effectiveness(attackLC, defTypesLC) {
    const atk = cap(attackLC);
    let mult = 1;
    for (const dt of defTypesLC) mult *= (TYPE_CHART[atk] && TYPE_CHART[atk][cap(dt)] != null ? TYPE_CHART[atk][cap(dt)] : 1);
    return mult;
  }

  // ── Resolver maps, built from the loaded bundle ───────────────────────────
  let DB = null;            // bundle
  let POKE = [];            // pokemon array
  const TYPE_RESOLVE = {};  // name(any lang/lower) -> en type
  const MOVE_RESOLVE = {};  // name(any lang/lower) -> move id
  const ABIL_RESOLVE = {};  // name(any lang/lower) -> ability id

  function norm(s) { return (s || '').toLowerCase(); }

  // Extra Chinese type aliases (mirror the bot)
  const ZH_TYPE_EXTRA = {
    '炎': 'fire', '電': 'electric', '電氣': 'electric', '地': 'ground', '大地': 'ground',
    '飛': 'flying', '靈': 'ghost', '格': 'fighting', '超': 'psychic', '超能': 'psychic',
    '龍': 'dragon', '惡': 'dark', '妖': 'fairy', '蟲': 'bug', '石': 'rock', '鬼': 'ghost',
  };

  function init(bundle) {
    DB = bundle;
    POKE = bundle.pokemon;
    // Types: en, zh, ja + "<zh>系" suffix
    for (const [en, t] of Object.entries(bundle.types)) {
      TYPE_RESOLVE[en] = en;
      if (t.zh) { TYPE_RESOLVE[t.zh] = en; TYPE_RESOLVE[t.zh + '系'] = en; }
      if (t.ja) TYPE_RESOLVE[norm(t.ja)] = en;
    }
    for (const [zh, en] of Object.entries(ZH_TYPE_EXTRA)) {
      TYPE_RESOLVE[zh] = en; TYPE_RESOLVE[zh + '系'] = en;
    }
    // Moves
    for (const [id, m] of Object.entries(bundle.moves)) {
      MOVE_RESOLVE[id] = id;
      if (m.en) MOVE_RESOLVE[norm(m.en)] = id;
      if (m.zh) MOVE_RESOLVE[m.zh] = id;
      if (m.ja) MOVE_RESOLVE[norm(m.ja)] = id;
    }
    // Abilities
    for (const [id, a] of Object.entries(bundle.abilities)) {
      ABIL_RESOLVE[id] = id;
      if (a.en) ABIL_RESOLVE[norm(a.en)] = id;
      if (a.zh) ABIL_RESOLVE[a.zh] = id;
      if (a.ja) ABIL_RESOLVE[norm(a.ja)] = id;
    }
    return DB;
  }

  const resolveType    = t => TYPE_RESOLVE[t] || TYPE_RESOLVE[norm(t)] || null;
  const resolveMove    = t => MOVE_RESOLVE[t] || MOVE_RESOLVE[norm(t)] || null;
  const resolveAbility = t => ABIL_RESOLVE[t] || ABIL_RESOLVE[norm(t)] || null;

  // ── Stat aliases ──────────────────────────────────────────────────────────
  const STAT_ALIAS = {
    hp: 'hp', h: 'hp', 'hp値': 'hp',
    attack: 'atk', atk: 'atk', a: 'atk', '攻擊': 'atk', '攻撃': 'atk', こうげき: 'atk',
    defense: 'def', def: 'def', b: 'def', '防禦': 'def', '防御': 'def', ぼうぎょ: 'def',
    'special-attack': 'spa', spatk: 'spa', spa: 'spa', c: 'spa', '特攻': 'spa', とくこう: 'spa',
    'special-defense': 'spd', spdef: 'spd', spd: 'spd', d: 'spd', '特防': 'spd', とくぼう: 'spd',
    speed: 'spe', spe: 'spe', s: 'spe', '速度': 'spe', すばやさ: 'spe',
    bst: 'bst', total: 'bst', '總和': 'bst', '種族值': 'bst', しゅぞくち: 'bst', '合計': 'bst',
  };
  const resolveStat = s => STAT_ALIAS[s] || STAT_ALIAS[norm(s)] || null;
  const statVal = (p, key) => (key === 'bst' ? p.bst : (p.stats[key] || 0));

  // ── Category suffix patterns (zh) + english tokens ────────────────────────
  const MOVE_CAT_SUFFIXES = [
    ['物理攻擊招式', 'physical'], ['特殊攻擊招式', 'special'], ['攻擊招式', 'attacking'],
    ['物理招式', 'physical'], ['特殊招式', 'special'], ['變化招式', 'status'],
    ['輔助招式', 'status'], ['狀態招式', 'status'], ['攻撃招式', 'attacking'],
    ['物理技', 'physical'], ['特殊技', 'special'], ['変化技', 'status'], ['攻撃技', 'attacking'],
    ['攻擊招', 'attacking'], ['物理招', 'physical'], ['特殊招', 'special'], ['變化招', 'status'],
    ['輔助招', 'status'], ['招式', 'any'], ['技', 'any'], ['招', 'any'],
  ];
  const MOVE_CAT_TOKENS = new Map([
    ['攻擊招式', 'attacking'], ['物理招式', 'physical'], ['特殊招式', 'special'],
    ['變化招式', 'status'], ['輔助招式', 'status'], ['狀態招式', 'status'], ['招式', 'any'],
    ['物理技', 'physical'], ['特殊技', 'special'], ['変化技', 'status'], ['招', 'any'], ['技', 'any'],
    ['attacking', 'attacking'], ['physical', 'physical'], ['special', 'special'],
    ['status', 'status'], ['moves', 'any'],
    ['attacking moves', 'attacking'], ['physical moves', 'physical'],
    ['special moves', 'special'], ['status moves', 'status'], ['all moves', 'any'],
  ]);
  function parseTypeMoveToken(token) {
    for (const [suffix, cat] of MOVE_CAT_SUFFIXES) {
      if (token.length > suffix.length && token.endsWith(suffix)) {
        const typeEn = resolveType(token.slice(0, -suffix.length));
        if (typeEn) return { typeEn, cat };
      }
    }
    return null;
  }

  // ── Move/type membership predicates ───────────────────────────────────────
  function hasMove(poke, moveId) { return poke.moves.indexOf(moveId) !== -1; }
  function hasMoveOfTypeCategory(poke, typeEn, category) {
    for (const id of poke.moves) {
      const m = DB.moves[id];
      if (!m) continue;
      if (typeEn !== 'any' && m.type !== typeEn) continue;
      if (category === 'any') return true;
      if (category === 'attacking') { if (m.cat === 'physical' || m.cat === 'special') return true; }
      else if (m.cat === category) return true;
    }
    return false;
  }

  // ── Boolean operator normalisation (zh + a little ja) ─────────────────────
  const OPS = [
    ['而且是', ' AND '], ['還要是', ' AND '], ['而且', ' AND '], ['還要', ' AND '],
    ['並且', ' AND '], ['以及', ' AND '], ['かつ', ' AND '],
    ['或者是', ' OR '], ['或者', ' OR '], ['或是', ' OR '], ['または', ' OR '], ['或', ' OR '],
    ['但不要是', ' NOT '], ['但不要', ' NOT '], ['但不是', ' NOT '],
    ['不要是', ' NOT '], ['不要', ' NOT '], ['不是', ' NOT '], ['排除', ' NOT '], ['以外', ' NOT '],
  ];
  function normalizeQuery(q) {
    q = q.replace(/[（）　]/g, c => ({ '（': '(', '）': ')', '　': ' ' }[c]));
    for (const [zh, en] of OPS) q = q.split(zh).join(en);
    return q.trim();
  }

  function tokenize(q) {
    const tokens = [];
    for (const t of q.split(/\s+/)) {
      if (!t) continue;
      let cur = t; const lead = [], trail = [];
      while (cur.startsWith('(')) { lead.push('('); cur = cur.slice(1); }
      while (cur.endsWith(')'))   { trail.push(')'); cur = cur.slice(0, -1); }
      tokens.push(...lead);
      if (cur) tokens.push(cur);
      tokens.push(...trail);
    }
    return tokens;
  }

  const flipOp = op => ({ '>': '<', '<': '>', '>=': '<=', '<=': '>=' }[op] || op);

  function postProcess(tokens) {
    const out = [];
    const STAT_CMP_RE = /^([\w一-鿿぀-ヿ-]+)(>=|<=|>|<|=)(\d+|[\w一-鿿぀-ヿ-]+)$|^(\d+)(>=|<=|>|<|=)([\w一-鿿぀-ヿ-]+)$/i;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (/^(AND|OR|NOT)$/i.test(t)) { out.push(t.toUpperCase()); continue; }
      if (t === '(' || t === ')')    { out.push(t); continue; }

      const sm = STAT_CMP_RE.exec(t);
      if (sm) {
        let statA, op, valStr;
        if (sm[1]) { statA = sm[1]; op = sm[2]; valStr = sm[3]; }
        else       { valStr = sm[4]; op = flipOp(sm[5]); statA = sm[6]; }
        const rA = resolveStat(statA);
        if (rA) {
          const numVal = parseFloat(valStr);
          if (!isNaN(numVal) && /^\d+$/.test(valStr)) out.push(`STAT:${rA}:${op}:${numVal}`);
          else { const rB = resolveStat(valStr); if (rB) out.push(`STAT:${rA}:${op}:${rB}`); else out.push(t); }
          continue;
        }
      }
      // spaced "speed > 100"
      const rStatA = resolveStat(t);
      if (rStatA) {
        const n1 = tokens[i + 1], n2 = tokens[i + 2];
        if (n1 && /^(>=|<=|>|<|=)$/.test(n1) && n2 !== undefined) {
          const numVal = parseFloat(n2);
          if (!isNaN(numVal) && /^\d+$/.test(n2)) { out.push(`STAT:${rStatA}:${n1}:${numVal}`); i += 2; continue; }
          const rB = resolveStat(n2); if (rB) { out.push(`STAT:${rStatA}:${n1}:${rB}`); i += 2; continue; }
        }
      }
      // spaced "100 > speed"
      if (/^\d+$/.test(t)) {
        const n1 = tokens[i + 1], n2 = tokens[i + 2];
        if (n1 && /^(>=|<=|>|<|=)$/.test(n1) && n2) {
          const rB = resolveStat(n2);
          if (rB) { out.push(`STAT:${rB}:${flipOp(n1)}:${Number(t)}`); i += 2; continue; }
        }
      }
      // type+category move (single glued token)
      const tm = parseTypeMoveToken(t);
      if (tm) { out.push(`TYPEMOVE:${tm.typeEn}:${tm.cat}`); continue; }
      // type followed by category word(s)
      {
        const typeEn = resolveType(t);
        if (typeEn) {
          const n1 = tokens[i + 1], n2 = tokens[i + 2];
          if (n1 !== undefined && n2 !== undefined) {
            const cat2 = MOVE_CAT_TOKENS.get(`${n1} ${n2}`);
            if (cat2) { out.push(`TYPEMOVE:${typeEn}:${cat2}`); i += 2; continue; }
          }
          if (n1 !== undefined) {
            const cat1 = MOVE_CAT_TOKENS.get(norm(n1)) || MOVE_CAT_TOKENS.get(n1);
            if (cat1) { out.push(`TYPEMOVE:${typeEn}:${cat1}`); i++; continue; }
          }
          // A bare type word is a TYPE filter. Short-circuit here so a type that is
          // also a move name (e.g. "psychic") is not swallowed by move resolution.
          out.push(`TYPE:${typeEn}`); continue;
        }
      }
      // single-token move
      const mv = resolveMove(t);
      if (mv) { out.push(`MOVE:${mv}`); continue; }
      // multi-word english move ("fake out" -> fake-out)
      {
        let found = false;
        for (let look = 1; look <= 3 && !found; look++) {
          const peek = tokens[i + look];
          if (!peek || /^(AND|OR|NOT)$/i.test(peek) || peek === '(' || peek === ')') break;
          const cand = [t, ...tokens.slice(i + 1, i + 1 + look)].join('-');
          const mv2 = resolveMove(cand);
          if (mv2) { i += look; out.push(`MOVE:${mv2}`); found = true; }
        }
        if (found) continue;
      }
      // spaced matchup prefix "克 火 兼 鋼"
      const ALL_PFX = new Set([...BEATS_PFX, ...RESISTS_PFX]);
      if (ALL_PFX.has(t) && tokens[i + 1] && resolveType(tokens[i + 1])) {
        let combined = t + tokens[i + 1]; i++;
        while (tokens[i + 1] === '兼' && tokens[i + 2] && resolveType(tokens[i + 2])) { combined += '兼' + tokens[i + 2]; i += 2; }
        out.push(combined); continue;
      }
      out.push(t);
    }
    return out;
  }

  function insertImplicitAnd(tokens) {
    const out = [];
    for (let i = 0; i < tokens.length; i++) {
      out.push(tokens[i]);
      if (i + 1 < tokens.length) {
        const t = tokens[i], next = tokens[i + 1];
        const tOp    = t !== 'AND' && t !== 'OR' && t !== 'NOT' && t !== '(';
        const nextOp = next !== 'AND' && next !== 'OR' && next !== ')';
        if (tOp && nextOp) out.push('AND');
      }
    }
    return out;
  }

  const PREC = { NOT: 3, AND: 2, OR: 1 };
  function shuntingYard(tokens) {
    const output = [], ops = [];
    for (const t of tokens) {
      if (t === 'NOT' || t === 'AND' || t === 'OR') {
        while (ops.length && ops[ops.length - 1] !== '(' && (PREC[ops[ops.length - 1]] || 0) >= PREC[t]) output.push(ops.pop());
        ops.push(t);
      } else if (t === '(') ops.push(t);
      else if (t === ')') {
        while (ops.length && ops[ops.length - 1] !== '(') output.push(ops.pop());
        if (!ops.length) throw new SyntaxError('Unbalanced parentheses / 括號不匹配');
        ops.pop();
      } else output.push(t);
    }
    while (ops.length) { const op = ops.pop(); if (op === '(') throw new SyntaxError('Unbalanced parentheses / 括號不匹配'); output.push(op); }
    return output;
  }

  const BEATS_PFX   = ['克制', '剋制', '克', '剋'];
  const RESISTS_PFX = ['抵抗', '耐受', '耐', '抗'];
  function parseTypeMatchup(term) {
    for (const pfx of BEATS_PFX) if (term.startsWith(pfx)) {
      const types = term.slice(pfx.length).split('兼').map(resolveType).filter(Boolean);
      return types.length ? { mode: 'beats', types } : null;
    }
    for (const pfx of RESISTS_PFX) if (term.startsWith(pfx)) {
      const types = term.slice(pfx.length).split('兼').map(resolveType).filter(Boolean);
      return types.length ? { mode: 'resists', types } : null;
    }
    return null;
  }
  // english "beats fire" / "resists fire" handled as two tokens -> implicit AND would split them;
  // postProcess keeps them separate, so support english matchup as a glued fallback here:
  const MEGA_TERMS = new Set(['mega', '超級進化', '超進化', '可超進化', '可超級進化', 'メガ', 'メガシンカ']);

  function evalOperand(poke, token, includeStatus) {
    if (token.startsWith('STAT:')) {
      const [, a, op, v] = token.split(':');
      const x = statVal(poke, a);
      const y = isNaN(Number(v)) ? statVal(poke, v) : Number(v);
      return op === '>' ? x > y : op === '<' ? x < y : op === '>=' ? x >= y : op === '<=' ? x <= y : x === y;
    }
    if (token.startsWith('TYPEMOVE:')) {
      const [, typeEn, rawCat] = token.split(':');
      const category = rawCat === 'any' ? (includeStatus ? 'any' : 'attacking') : rawCat;
      return hasMoveOfTypeCategory(poke, typeEn, category);
    }
    if (token.startsWith('MOVE:')) return hasMove(poke, token.slice(5));
    // Unambiguous tokens emitted by the simple-filter UI (never re-resolved).
    if (token.startsWith('TYPE:')) return (poke.types || []).includes(token.slice(5));
    if (token.startsWith('ABILITY:')) return (poke.abilities || []).some(a => a.id === token.slice(8));
    if (MEGA_TERMS.has(token) || MEGA_TERMS.has(norm(token))) {
      const n = (poke.name.zh || '') + ' ' + norm(poke.name.en) + ' ' + (poke.form || '');
      return /超級|mega/i.test(n);
    }
    const matchup = parseTypeMatchup(token);
    if (matchup) {
      const defTypes = poke.types || [];
      if (matchup.mode === 'beats') {
        if (matchup.types.length === 1) return defTypes.some(dt => effectiveness(dt, [matchup.types[0]]) >= 2);
        return defTypes.some(dt => matchup.types.every(tgt => effectiveness(dt, [tgt]) >= 2));
      }
      return matchup.types.every(tgt => effectiveness(tgt, defTypes) <= 0.5);
    }
    const typeEn = resolveType(token);
    if (typeEn) return (poke.types || []).includes(typeEn);
    const abilityId = resolveAbility(token);
    if (abilityId) return (poke.abilities || []).some(a => a.id === abilityId);
    // fallback partial name match (any language)
    const q = norm(token);
    return (poke.name.zh || '').includes(token) ||
           norm(poke.name.en).includes(q) ||
           (poke.name.ja || '').includes(token);
  }

  function evalRPN(poke, rpn, includeStatus) {
    const st = [];
    for (const t of rpn) {
      if (t === 'AND') { const b = st.pop(), a = st.pop(); st.push(a && b); }
      else if (t === 'OR') { const b = st.pop(), a = st.pop(); st.push(a || b); }
      else if (t === 'NOT') st.push(!st.pop());
      else st.push(evalOperand(poke, t, includeStatus));
    }
    return st.length ? !!st[0] : false;
  }

  function compile(rawQuery) {
    const q = normalizeQuery(rawQuery);
    if (!q) return null;
    return shuntingYard(insertImplicitAnd(postProcess(tokenize(q))));
  }

  function search(rawQuery, opts) {
    opts = opts || {};
    const rpn = compile(rawQuery);
    if (!rpn) return { results: POKE.slice(), rpn: [] };
    const includeStatus = !!opts.includeStatus;
    return { results: POKE.filter(p => evalRPN(p, rpn, includeStatus)), rpn };
  }

  global.DexSearch = {
    init, search, compile,
    resolveType, resolveMove, resolveAbility, resolveStat,
    effectiveness,
    get db() { return DB; },
  };
})(window);
