'use strict';
/* web/app.js — UI controller. Builds a grammar query from the simple controls
 * (or reads the advanced box), runs DexSearch, and renders cards.
 * Designed to stay thin so a damage-calc module can hook in later. */
(function () {
  const DEX = window.DEX;
  const DS  = window.DexSearch;
  DS.init(DEX);

  const TYPE_COLORS = {
    normal: '#9099a1', fire: '#ff9d55', water: '#5090d6', electric: '#f4d23c',
    grass: '#63bc5a', ice: '#73cec0', fighting: '#ce4069', poison: '#ab6ac8',
    ground: '#d97746', flying: '#8fa9de', psychic: '#fa7179', bug: '#90c12c',
    rock: '#c7b78b', ghost: '#5269ac', dragon: '#0b6dc3', dark: '#5a5366',
    steel: '#5a8ea1', fairy: '#ec8fe6',
  };
  const STAT_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe', 'bst'];
  const CATS = ['any', 'attacking', 'physical', 'special', 'status'];
  const TYPE_LIST = Object.keys(DEX.types);
  const MAX_CARDS = 300;

  // ── State ─────────────────────────────────────────────────────────────────
  const state = {
    lang: 'en',
    advanced: false,
    includeStatus: false,
    types: new Set(),
    moves: [],        // move ids
    abilities: [],    // ability ids
    stats: {},        // key -> {op, val}
    mtType: 'any',
    mtCat: 'any',
    advQuery: '',
  };

  const $ = id => document.getElementById(id);
  const T = () => window.I18N[state.lang];

  // ── Localized name helpers ────────────────────────────────────────────────
  const lc = s => (s || '').toLowerCase();
  const pokeName = p => p.name[state.lang] || p.name.en;
  const typeName = en => (DEX.types[en] ? DEX.types[en][state.lang] || en : en);
  const moveName = id => (DEX.moves[id] ? DEX.moves[id][state.lang] || DEX.moves[id].en : id);
  const abilName = id => (DEX.abilities[id] ? DEX.abilities[id][state.lang] || DEX.abilities[id].en : id);
  const titleCase = s => s.replace(/(^|[\s-])\w/g, m => m.toUpperCase());
  // Colour a base stat by value (red low → teal high), like standard stat bars.
  function statColor(v) {
    if (v < 50)  return '#fb5b5b';
    if (v < 70)  return '#f9774b';
    if (v < 90)  return '#f9a825';
    if (v < 110) return '#dcc94b';
    if (v < 130) return '#9acb3c';
    if (v < 150) return '#5ad19a';
    return '#34c6c6';
  }

  // name (any lang) -> id maps, for autocomplete resolution
  function buildNameIndex(dict) {
    const m = {};
    for (const [id, v] of Object.entries(dict)) {
      m[id] = id;
      ['en', 'zh', 'ja'].forEach(l => { if (v[l]) m[lc(v[l])] = id; });
    }
    return m;
  }
  const MOVE_NAME_IDX = buildNameIndex(DEX.moves);
  const ABIL_NAME_IDX = buildNameIndex(DEX.abilities);

  // ── Build static UI pieces ────────────────────────────────────────────────
  function buildLangBar() {
    const bar = $('langbar'); bar.innerHTML = '';
    for (const code of ['en', 'zh', 'ja']) {
      const b = document.createElement('button');
      b.textContent = window.I18N[code]._name;
      b.className = code === state.lang ? 'active' : '';
      b.onclick = () => { state.lang = code; document.documentElement.lang = code; applyLang(); refreshDynamic(); runSearch(); };
      bar.appendChild(b);
    }
  }

  function buildTypeChips() {
    const box = $('typeChips'); box.innerHTML = '';
    for (const en of TYPE_LIST) {
      const c = document.createElement('span');
      c.className = 'typechip' + (state.types.has(en) ? ' on' : '');
      c.style.background = TYPE_COLORS[en];
      c.textContent = typeName(en);
      c.dataset.type = en;
      c.onclick = () => { state.types.has(en) ? state.types.delete(en) : state.types.add(en); buildTypeChips(); runSearch(); };
      box.appendChild(c);
    }
  }

  function buildStatGrid() {
    const g = $('statGrid'); g.innerHTML = '';
    for (const k of STAT_KEYS) {
      const row = document.createElement('div'); row.className = 'statrow';
      const lab = document.createElement('label'); lab.textContent = T().stat[k];
      const sel = document.createElement('select');
      ['', '>=', '<=', '=', '>', '<'].forEach(op => {
        const o = document.createElement('option'); o.value = op; o.textContent = op || '–'; sel.appendChild(o);
      });
      const inp = document.createElement('input'); inp.type = 'number'; inp.min = '0'; inp.placeholder = '–';
      const cur = state.stats[k] || {};
      sel.value = cur.op || '>='; inp.value = cur.val != null ? cur.val : '';
      const update = () => {
        if (sel.value && inp.value !== '') state.stats[k] = { op: sel.value, val: Number(inp.value) };
        else delete state.stats[k];
        runSearch();
      };
      sel.onchange = update; inp.oninput = update;
      row.append(lab, sel, inp); g.appendChild(row);
    }
  }

  function buildMoveTypeSelects() {
    const ts = $('mtType'), cs = $('mtCat');
    ts.innerHTML = ''; cs.innerHTML = '';
    const anyOpt = document.createElement('option'); anyOpt.value = 'any'; anyOpt.textContent = T().anyType; ts.appendChild(anyOpt);
    for (const en of TYPE_LIST) { const o = document.createElement('option'); o.value = en; o.textContent = typeName(en); ts.appendChild(o); }
    for (const c of CATS) { const o = document.createElement('option'); o.value = c; o.textContent = T().cat[c]; cs.appendChild(o); }
    ts.value = state.mtType; cs.value = state.mtCat;
    ts.onchange = () => { state.mtType = ts.value; runSearch(); };
    cs.onchange = () => { state.mtCat = cs.value; runSearch(); };
  }

  function buildDatalists() {
    const ml = $('moveList'); ml.innerHTML = '';
    Object.keys(DEX.moves).map(moveName).sort().forEach(n => { const o = document.createElement('option'); o.value = n; ml.appendChild(o); });
    const al = $('abilList'); al.innerHTML = '';
    Object.keys(DEX.abilities).map(abilName).sort().forEach(n => { const o = document.createElement('option'); o.value = n; al.appendChild(o); });
  }

  function renderChips() {
    const mc = $('moveChips'); mc.innerHTML = '';
    state.moves.forEach((id, i) => mc.appendChild(chip(moveName(id), () => { state.moves.splice(i, 1); renderChips(); runSearch(); })));
    const ac = $('abilChips'); ac.innerHTML = '';
    state.abilities.forEach((id, i) => ac.appendChild(chip(abilName(id), () => { state.abilities.splice(i, 1); renderChips(); runSearch(); })));
  }
  function chip(text, onX) {
    const c = document.createElement('span'); c.className = 'chip';
    const s = document.createElement('span'); s.textContent = text;
    const b = document.createElement('button'); b.textContent = '×'; b.onclick = onX;
    c.append(s, b); return c;
  }

  // ── Apply language to all static labels ───────────────────────────────────
  function applyLang() {
    const t = T();
    document.title = t.title;
    const set = (id, key) => { const el = $(id); if (el) el.textContent = t[key]; };
    set('t-title', 'title'); set('t-subtitle', 'subtitle');
    set('t-advancedToggle', 'advancedToggle'); set('t-includeStatus', 'includeStatus');
    set('t-types', 'types'); set('t-typesHint', 'typesHint');
    set('t-moves', 'moves'); set('t-movesHint', 'movesHint');
    set('t-abilities', 'abilities'); set('t-abilitiesHint', 'abilitiesHint');
    set('t-moveType', 'moveType'); set('t-stats', 'stats');
    set('t-advancedMode', 'advancedMode'); set('t-helpTitle', 'helpTitle');
    set('t-results', 'results'); set('t-calcStub', 'calcStub');
    $('searchBtn').textContent = t.search; $('resetBtn').textContent = t.reset;
    $('moveInput').placeholder = t.addPlaceholderMove;
    $('abilInput').placeholder = t.addPlaceholderAbility;
    $('advInput').placeholder = t.advancedPlaceholder;
    buildLangBar();
    // help box
    const hb = $('helpBox'); hb.innerHTML = '';
    t.help.forEach(([code, desc]) => {
      const c = document.createElement('code'); c.textContent = code;
      const s = document.createElement('span'); s.textContent = desc;
      hb.append(c, s);
    });
  }

  // Re-render the language-dependent dynamic widgets
  function refreshDynamic() {
    buildTypeChips(); buildStatGrid(); buildMoveTypeSelects(); buildDatalists(); renderChips();
  }

  // ── Compile simple controls -> grammar query ──────────────────────────────
  function buildSimpleQuery() {
    // Emit explicit, prefixed tokens (TYPE:/MOVE:/ABILITY:/TYPEMOVE:) so a control
    // can never be mis-resolved — e.g. the "psychic" TYPE chip vs the move Psychic,
    // which share the id "psychic". These tokens pass through the parser untouched
    // and are matched directly by evalOperand.
    const parts = [];
    for (const t of state.types) parts.push(`TYPE:${t}`);
    for (const id of state.moves) parts.push(`MOVE:${id}`);
    for (const id of state.abilities) parts.push(`ABILITY:${id}`);
    for (const k of STAT_KEYS) { const s = state.stats[k]; if (s) parts.push(`${k}${s.op}${s.val}`); }
    if (state.mtType !== 'any') parts.push(`TYPEMOVE:${state.mtType}:${state.mtCat}`);
    // (A category with no specific type isn't expressible in the grammar — ignored.)
    return parts.join(' AND ');
  }

  // ── Search + render ───────────────────────────────────────────────────────
  function currentQuery() {
    return state.advanced ? $('advInput').value : buildSimpleQuery();
  }

  function runSearch() {
    const q = currentQuery();
    let res;
    try {
      res = DS.search(q, { includeStatus: state.includeStatus });
      $('qline').textContent = q ? q : '';
      $('qline').style.color = '';
    } catch (e) {
      $('qline').textContent = '⚠ ' + e.message;
      $('qline').style.color = '#ff7a7a';
      return;
    }
    render(res.results);
  }

  function spriteUrl(p) {
    const base = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/';
    return base + (p.species_id || p.dex) + '.png';
  }

  function render(list) {
    list = list.slice().sort((a, b) => a.dex - b.dex || (a.isDefault === b.isDefault ? 0 : a.isDefault ? -1 : 1));
    $('resCount').textContent = list.length;
    const grid = $('results'); grid.innerHTML = '';
    if (!list.length) { grid.innerHTML = `<div class="hint">${T().noResults}</div>`; return; }
    const frag = document.createDocumentFragment();
    for (const p of list.slice(0, MAX_CARDS)) frag.appendChild(card(p));
    grid.appendChild(frag);
    if (list.length > MAX_CARDS) {
      const more = document.createElement('div'); more.className = 'hint';
      more.style.gridColumn = '1/-1';
      more.textContent = `… +${list.length - MAX_CARDS}`;
      grid.appendChild(more);
    }
  }

  function card(p) {
    const el = document.createElement('div'); el.className = 'card';
    const top = document.createElement('div'); top.className = 'top';
    const img = document.createElement('img'); img.loading = 'lazy'; img.src = spriteUrl(p);
    img.onerror = () => { img.style.visibility = 'hidden'; };
    const info = document.createElement('div');
    const dex = document.createElement('div'); dex.className = 'dex'; dex.textContent = '#' + p.dex;
    const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = state.lang === 'en' ? titleCase(pokeName(p)) : pokeName(p);
    info.append(dex, nm);
    if (p.form) { const f = document.createElement('div'); f.className = 'form'; f.textContent = p.form; info.appendChild(f); }
    top.append(img, info); el.appendChild(top);

    const tr = document.createElement('div'); tr.className = 'typerow';
    for (const t of p.types) { const s = document.createElement('span'); s.className = 't'; s.style.background = TYPE_COLORS[t]; s.textContent = typeName(t); tr.appendChild(s); }
    el.appendChild(tr);

    const ab = document.createElement('div'); ab.className = 'ab';
    ab.innerHTML = p.abilities.map(a => a.hidden ? `<span class="h">${abilName(a.id)} (${T().hidden})</span>` : abilName(a.id)).join(' · ');
    el.appendChild(ab);

    const bars = document.createElement('div'); bars.className = 'bars';
    for (const k of ['hp', 'atk', 'def', 'spa', 'spd', 'spe']) {
      const v = p.stats[k];
      const bk = document.createElement('span'); bk.className = 'bk'; bk.textContent = T().stat[k];
      const bt = document.createElement('span'); bt.className = 'bt';
      const bf = document.createElement('span'); bf.className = 'bf';
      bf.style.width = Math.min(100, v / 200 * 100) + '%';
      bf.style.background = statColor(v);
      bt.appendChild(bf);
      const bv = document.createElement('span'); bv.className = 'bv'; bv.textContent = v;
      bars.append(bk, bt, bv);
    }
    el.appendChild(bars);
    const bst = document.createElement('div'); bst.className = 'bst'; bst.innerHTML = `${T().bst}: <b>${p.bst}</b>`;
    el.appendChild(bst);
    return el;
  }

  // ── Wire inputs ───────────────────────────────────────────────────────────
  function addMove() {
    const v = lc($('moveInput').value.trim());
    const id = MOVE_NAME_IDX[v];
    if (id && state.moves.indexOf(id) === -1) { state.moves.push(id); $('moveInput').value = ''; renderChips(); runSearch(); }
  }
  function addAbil() {
    const v = lc($('abilInput').value.trim());
    const id = ABIL_NAME_IDX[v];
    if (id && state.abilities.indexOf(id) === -1) { state.abilities.push(id); $('abilInput').value = ''; renderChips(); runSearch(); }
  }

  let advTimer = null;
  function wire() {
    $('advToggle').onchange = e => {
      state.advanced = e.target.checked;
      $('simple').classList.toggle('hidden', state.advanced);
      $('advanced').classList.toggle('hidden', !state.advanced);
      runSearch();
    };
    $('includeStatus').onchange = e => { state.includeStatus = e.target.checked; runSearch(); };
    $('moveInput').addEventListener('change', addMove);
    $('abilInput').addEventListener('change', addAbil);
    $('moveInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addMove(); } });
    $('abilInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addAbil(); } });
    $('advInput').addEventListener('input', () => { clearTimeout(advTimer); advTimer = setTimeout(runSearch, 300); });
    $('searchBtn').onclick = runSearch;
    $('resetBtn').onclick = reset;
  }

  function reset() {
    state.types.clear(); state.moves = []; state.abilities = []; state.stats = {};
    state.mtType = 'any'; state.mtCat = 'any'; state.includeStatus = false;
    state.advanced = false; $('advInput').value = '';
    $('advToggle').checked = false; $('includeStatus').checked = false;
    $('simple').classList.remove('hidden'); $('advanced').classList.add('hidden');
    refreshDynamic(); runSearch();
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  applyLang();
  refreshDynamic();
  wire();
  runSearch();
})();
