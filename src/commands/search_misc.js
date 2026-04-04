'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');

// ── Data loading (lazy) ────────────────────────────────────────────────────────
let _tri = null, _mdb = null, _plza = null;

function loadData() {
  if (!_tri) _tri   = require(path.join(__dirname, '../../data/trilingual.json'));
  if (!_mdb) _mdb   = require(path.join(__dirname, '../../data/moves_db.json'));
  if (!_plza) _plza = require(path.join(__dirname, '../../data/plza_moves.json'));
}

// ── Type / category display ────────────────────────────────────────────────────
const TYPE_EMOJI = {
  normal:   '⬜', fire:     '🔥', water:    '💧', electric: '⚡',
  grass:    '🌿', ice:      '❄️',  fighting: '🥊', poison:   '☠️',
  ground:   '🌍', flying:   '🌬️',  psychic:  '🔮', bug:      '🐛',
  rock:     '🪨', ghost:    '👻', dragon:   '🐉', dark:     '🌑',
  steel:    '⚙️',  fairy:    '✨', unknown:  '❓',
};

const TYPE_ZH = {
  normal: '一般', fire: '火', water: '水', electric: '電', grass: '草',
  ice: '冰', fighting: '格鬥', poison: '毒', ground: '地面', flying: '飛行',
  psychic: '超能力', bug: '蟲', rock: '岩石', ghost: '幽靈', dragon: '龍',
  dark: '惡', steel: '鋼', fairy: '妖精', unknown: '???',
};
const TYPE_JA = {
  normal: 'ノーマル', fire: 'ほのお', water: 'みず', electric: 'でんき',
  grass: 'くさ', ice: 'こおり', fighting: 'かくとう', poison: 'どく',
  ground: 'じめん', flying: 'ひこう', psychic: 'エスパー', bug: 'むし',
  rock: 'いわ', ghost: 'ゴースト', dragon: 'ドラゴン', dark: 'あく',
  steel: 'はがね', fairy: 'フェアリー', unknown: '???',
};
const CAT_ZH = { physical: '物理', special: '特殊', status: '變化', unknown: '???'  };
const CAT_JA = { physical: 'ぶつり', special: 'とくしゅ', status: 'へんか', unknown: '???'  };

function fmtType(t, lang) {
  if (!t) return '???';
  const emoji = TYPE_EMOJI[t] ?? '❓';
  if (lang === 'zh') return `${emoji} ${TYPE_ZH[t] ?? t}`;
  if (lang === 'ja') return `${emoji} ${TYPE_JA[t] ?? t}`;
  return `${emoji} ${t.charAt(0).toUpperCase() + t.slice(1)}`;
}
function fmtCat(c, lang) {
  if (!c || c === 'unknown') return '???';
  if (lang === 'zh') return CAT_ZH[c] ?? c;
  if (lang === 'ja') return CAT_JA[c] ?? c;
  return c.charAt(0).toUpperCase() + c.slice(1);
}

// ── Labels ─────────────────────────────────────────────────────────────────────
const L = {
  zh: {
    type: '屬性', category: '分類', power: '威力', cd: '冷卻', effect: '效果',
    game_scvi: 'SV', game_plza: 'PLZA',
    no_result: '找不到',
    move: '招式', ability: '特性', item: '道具',
    status: '變化',
  },
  ja: {
    type: 'タイプ', category: '分類', power: 'いりょく', cd: 'CT', effect: '効果',
    game_scvi: 'SV', game_plza: 'PLZA',
    no_result: '見つかりません',
    move: 'わざ', ability: 'とくせい', item: 'どうぐ',
    status: '変化',
  },
  en: {
    type: 'Type', category: 'Category', power: 'Power', cd: 'Cooldown', effect: 'Effect',
    game_scvi: 'SV', game_plza: 'PLZA',
    no_result: 'Not found',
    move: 'Move', ability: 'Ability', item: 'Item',
    status: 'Status',
  },
};

// ── SCVI move search ───────────────────────────────────────────────────────────
function searchScviMoves(query) {
  loadData();
  const q    = query.trim();
  const qLow = q.toLowerCase();
  const entries = Object.values(_tri.move);

  const exact = entries.find(e =>
    e.zh === q || e.en.toLowerCase() === qLow || e.ja === q
  );
  if (exact) return [exact];

  return entries.filter(e =>
    e.zh.includes(q) ||
    e.en.toLowerCase().includes(qLow) ||
    e.ja.includes(q)
  ).slice(0, 10);
}

function getScviMoveStats(zhName) {
  loadData();
  return _mdb[zhName] ?? null;
}

// ── SCVI ability search ────────────────────────────────────────────────────────
function searchScviAbilities(query) {
  loadData();
  const q    = query.trim();
  const qLow = q.toLowerCase();
  const entries = Object.values(_tri.ability);

  const exact = entries.find(e =>
    e.zh === q || e.en.toLowerCase() === qLow || e.ja === q
  );
  if (exact) return [exact];

  return entries.filter(e =>
    e.zh.includes(q) ||
    e.en.toLowerCase().includes(qLow) ||
    e.ja.includes(q)
  ).slice(0, 10);
}

// ── SCVI item search ───────────────────────────────────────────────────────────
function searchScviItems(query) {
  loadData();
  const q    = query.trim();
  const qLow = q.toLowerCase();
  const entries = Object.values(_tri.item);

  const exact = entries.find(e =>
    e.zh === q || e.en.toLowerCase() === qLow || e.ja === q
  );
  if (exact) return [exact];

  return entries.filter(e =>
    e.zh.includes(q) ||
    e.en.toLowerCase().includes(qLow) ||
    e.ja.includes(q)
  ).slice(0, 10);
}

// ── PLZA move search ───────────────────────────────────────────────────────────
function searchPlzaMoves(query, typeFilter) {
  loadData();
  const q    = query.trim();
  const qLow = q.toLowerCase();

  // plza_moves has both zh and en keys pointing to same data; only use zh keys
  const unique = Object.entries(_plza)
    .filter(([k]) => /[\u4e00-\u9fff]/.test(k))
    .map(([, v]) => v);

  let results = typeFilter
    ? unique.filter(m => m.type === typeFilter)
    : unique;

  if (q) {
    const exact = results.find(m =>
      m.name_zh === q || m.name_en.toLowerCase() === qLow
    );
    if (exact) return [exact];
    results = results.filter(m =>
      m.name_zh.includes(q) || m.name_en.toLowerCase().includes(qLow)
    );
  }

  return results.slice(0, 10);
}

// ── Display name helpers ───────────────────────────────────────────────────────
function moveDisplayName(e, lang) {
  if (lang === 'zh') return e.zh || e.en;
  if (lang === 'ja') return e.ja || e.en;
  return e.en;
}
function abilityDisplayName(e, lang) {
  if (lang === 'zh') return e.zh || e.en;
  if (lang === 'ja') return e.ja || e.en;
  return e.en;
}
function itemDisplayName(e, lang) {
  if (lang === 'zh') return e.zh || e.en;
  if (lang === 'ja') return e.ja || e.en;
  return e.en;
}

// ── Embed builders ─────────────────────────────────────────────────────────────
function buildScviMoveEmbed(entry, lang) {
  const lbl    = L[lang];
  const stats  = getScviMoveStats(entry.zh);
  const name   = moveDisplayName(entry, lang);
  const title  = lang === 'zh' ? `${entry.zh}  /  ${entry.en}`
               : lang === 'ja' ? `${entry.ja || entry.en}  /  ${entry.zh}`
               :                 `${entry.en}  /  ${entry.zh}`;

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`[SV ${lbl.move}] ${title}`);

  // All three names
  const names = [];
  if (entry.zh) names.push(`ZH: ${entry.zh}`);
  if (entry.en) names.push(`EN: ${entry.en}`);
  if (entry.ja) names.push(`JA: ${entry.ja}${entry.ja_hrkt ? ` (${entry.ja_hrkt})` : ''}`);
  embed.setDescription(names.join('\n'));

  if (stats && stats.type && stats.type !== 'unknown') {
    embed.addFields(
      { name: lbl.type,     value: fmtType(stats.type, lang),     inline: true },
      { name: lbl.category, value: fmtCat(stats.category, lang),  inline: true },
      { name: lbl.power,    value: stats.power != null ? String(stats.power) : '—', inline: true },
    );
  }

  return embed;
}

function buildScviAbilityEmbed(entry, lang) {
  const lbl   = L[lang];
  const title = lang === 'zh' ? `${entry.zh}  /  ${entry.en}`
              : lang === 'ja' ? `${entry.ja || entry.en}  /  ${entry.zh}`
              :                 `${entry.en}  /  ${entry.zh}`;

  const names = [];
  if (entry.zh) names.push(`ZH: ${entry.zh}`);
  if (entry.en) names.push(`EN: ${entry.en}`);
  if (entry.ja) names.push(`JA: ${entry.ja}${entry.ja_hrkt ? ` (${entry.ja_hrkt})` : ''}`);

  return new EmbedBuilder()
    .setColor(0x57F287)
    .setTitle(`[SV ${lbl.ability}] ${title}`)
    .setDescription(names.join('\n'));
}

function buildScviItemEmbed(entry, lang) {
  const lbl   = L[lang];
  const title = lang === 'zh' ? `${entry.zh}  /  ${entry.en}`
              : lang === 'ja' ? `${entry.ja || entry.en}  /  ${entry.zh}`
              :                 `${entry.en}  /  ${entry.zh}`;

  const names = [];
  if (entry.zh) names.push(`ZH: ${entry.zh}`);
  if (entry.en) names.push(`EN: ${entry.en}`);
  if (entry.ja) names.push(`JA: ${entry.ja}${entry.ja_hrkt ? ` (${entry.ja_hrkt})` : ''}`);

  return new EmbedBuilder()
    .setColor(0xFEE75C)
    .setTitle(`[SV ${lbl.item}] ${title}`)
    .setDescription(names.join('\n'));
}

function buildPlzaMoveEmbed(move, lang) {
  const lbl   = L[lang];
  const title = lang === 'en'
    ? `${move.name_en}  /  ${move.name_zh}`
    : `${move.name_zh}  /  ${move.name_en}`;

  const embed = new EmbedBuilder()
    .setColor(0xEB459E)
    .setTitle(`[PLZA ${lbl.move}] ${title}`)
    .addFields(
      { name: lbl.type,     value: fmtType(move.type, lang),    inline: true },
      { name: lbl.category, value: fmtCat(move.category, lang), inline: true },
      { name: lbl.power,    value: String(move.power ?? '—'),   inline: true },
      { name: lbl.cd,       value: String(move.cooldown ?? '—'), inline: true },
    );

  if (move.effect) {
    embed.addFields({ name: lbl.effect, value: move.effect });
  }

  return embed;
}

// List embed when multiple results
function buildListEmbed(results, category, lang, buildName) {
  const lbl = L[lang];
  const catLabel = {
    scvi_move:    `SV ${lbl.move}`,
    scvi_ability: `SV ${lbl.ability}`,
    scvi_item:    `SV ${lbl.item}`,
    plza_move:    `PLZA ${lbl.move}`,
  }[category];

  const lines = results.map((e, i) => `${i + 1}. ${buildName(e)}`).join('\n');
  return new EmbedBuilder()
    .setColor(0x99AAB5)
    .setTitle(catLabel)
    .setDescription(`${lines}\n\n${lang === 'zh' ? '找到多個結果，請輸入完整名稱。' : lang === 'ja' ? '複数の結果が見つかりました。完全な名前を入力してください。' : 'Multiple results found. Please enter the full name.'}`);
}

// ── Autocomplete data ──────────────────────────────────────────────────────────
function autocompleteScviMove(q) {
  loadData();
  const qLow = q.toLowerCase();
  const entries = Object.values(_tri.move);
  const start = [], has = [];
  for (const e of entries) {
    if (e.zh.startsWith(q) || e.en.toLowerCase().startsWith(qLow) || e.ja.startsWith(q)) start.push(e);
    else if (e.zh.includes(q) || e.en.toLowerCase().includes(qLow) || e.ja.includes(q)) has.push(e);
  }
  return [...start, ...has].slice(0, 25).map(e => ({
    name: `${e.zh}  ${e.en}`.slice(0, 100),
    value: e.zh || e.en,
  }));
}

function autocompleteScviAbility(q) {
  loadData();
  const qLow = q.toLowerCase();
  const entries = Object.values(_tri.ability);
  const start = [], has = [];
  for (const e of entries) {
    if (e.zh.startsWith(q) || e.en.toLowerCase().startsWith(qLow) || e.ja.startsWith(q)) start.push(e);
    else if (e.zh.includes(q) || e.en.toLowerCase().includes(qLow) || e.ja.includes(q)) has.push(e);
  }
  return [...start, ...has].slice(0, 25).map(e => ({
    name: `${e.zh}  ${e.en}`.slice(0, 100),
    value: e.zh || e.en,
  }));
}

function autocompleteScviItem(q) {
  loadData();
  const qLow = q.toLowerCase();
  const entries = Object.values(_tri.item);
  const start = [], has = [];
  for (const e of entries) {
    if (e.zh.startsWith(q) || e.en.toLowerCase().startsWith(qLow) || e.ja.startsWith(q)) start.push(e);
    else if (e.zh.includes(q) || e.en.toLowerCase().includes(qLow) || e.ja.includes(q)) has.push(e);
  }
  return [...start, ...has].slice(0, 25).map(e => ({
    name: `${e.zh}  ${e.en}`.slice(0, 100),
    value: e.zh || e.en,
  }));
}

function autocompletePlzaMove(q) {
  loadData();
  const qLow = q.toLowerCase();
  const unique = Object.entries(_plza)
    .filter(([k]) => /[\u4e00-\u9fff]/.test(k))
    .map(([, v]) => v);
  const start = [], has = [];
  for (const e of unique) {
    if (e.name_zh.startsWith(q) || e.name_en.toLowerCase().startsWith(qLow)) start.push(e);
    else if (e.name_zh.includes(q) || e.name_en.toLowerCase().includes(qLow)) has.push(e);
  }
  return [...start, ...has].slice(0, 25).map(e => ({
    name: `${e.name_zh}  ${e.name_en}`.slice(0, 100),
    value: e.name_zh,
  }));
}

// ── Command ────────────────────────────────────────────────────────────────────
module.exports = {
  data: new SlashCommandBuilder()
    .setName('search_misc')
    .setDescription('搜尋招式／特性／道具 (SV & PLZA) / Search moves, abilities, items')
    .addStringOption(o => o
      .setName('category')
      .setDescription('搜尋類別 / Search category')
      .setRequired(true)
      .addChoices(
        { name: 'SV 招式 Move',      value: 'scvi_move'    },
        { name: 'SV 特性 Ability',   value: 'scvi_ability' },
        { name: 'SV 道具 Item',      value: 'scvi_item'    },
        { name: 'PLZA 招式 Move',    value: 'plza_move'    },
      ))
    .addStringOption(o => o
      .setName('query')
      .setDescription('名稱（中文、日文、英文）/ Name (zh/ja/en)')
      .setRequired(true)
      .setAutocomplete(true))
    .addStringOption(o => o
      .setName('lang')
      .setDescription('顯示語言 / Display language (預設中文)')
      .setRequired(false)
      .addChoices(
        { name: '中文 Chinese', value: 'zh' },
        { name: '日本語 Japanese', value: 'ja' },
        { name: 'English', value: 'en' },
      ))
    .addBooleanOption(o => o
      .setName('public')
      .setDescription('公開顯示 / Show publicly (預設隱藏)')
      .setRequired(false)),

  async execute(interaction) {
    const category = interaction.options.getString('category');
    const query    = interaction.options.getString('query');
    const lang     = interaction.options.getString('lang') ?? 'zh';
    const pub      = interaction.options.getBoolean('public') ?? false;
    const ephemeral = !pub;

    const lbl = L[lang];

    if (category === 'scvi_move') {
      const results = searchScviMoves(query);
      if (!results.length) {
        return interaction.reply({ content: `❌ ${lbl.no_result}: **${query}**`, flags: 64 });
      }
      if (results.length === 1) {
        const embed = buildScviMoveEmbed(results[0], lang);
        return interaction.reply({ embeds: [embed], flags: ephemeral ? 64 : undefined });
      }
      const embed = buildListEmbed(results, category, lang, e => moveDisplayName(e, lang));
      return interaction.reply({ embeds: [embed], flags: ephemeral ? 64 : undefined });
    }

    if (category === 'scvi_ability') {
      const results = searchScviAbilities(query);
      if (!results.length) {
        return interaction.reply({ content: `❌ ${lbl.no_result}: **${query}**`, flags: 64 });
      }
      if (results.length === 1) {
        const embed = buildScviAbilityEmbed(results[0], lang);
        return interaction.reply({ embeds: [embed], flags: ephemeral ? 64 : undefined });
      }
      const embed = buildListEmbed(results, category, lang, e => abilityDisplayName(e, lang));
      return interaction.reply({ embeds: [embed], flags: ephemeral ? 64 : undefined });
    }

    if (category === 'scvi_item') {
      const results = searchScviItems(query);
      if (!results.length) {
        return interaction.reply({ content: `❌ ${lbl.no_result}: **${query}**`, flags: 64 });
      }
      if (results.length === 1) {
        const embed = buildScviItemEmbed(results[0], lang);
        return interaction.reply({ embeds: [embed], flags: ephemeral ? 64 : undefined });
      }
      const embed = buildListEmbed(results, category, lang, e => itemDisplayName(e, lang));
      return interaction.reply({ embeds: [embed], flags: ephemeral ? 64 : undefined });
    }

    if (category === 'plza_move') {
      const results = searchPlzaMoves(query, null);
      if (!results.length) {
        return interaction.reply({ content: `❌ ${lbl.no_result}: **${query}**`, flags: 64 });
      }
      if (results.length === 1) {
        const embed = buildPlzaMoveEmbed(results[0], lang);
        return interaction.reply({ embeds: [embed], flags: ephemeral ? 64 : undefined });
      }
      const embed = buildListEmbed(results, category, lang, e => lang === 'en' ? e.name_en : e.name_zh);
      return interaction.reply({ embeds: [embed], flags: ephemeral ? 64 : undefined });
    }
  },

  async autocomplete(interaction) {
    const category = interaction.options.getString('category');
    const q        = interaction.options.getFocused().trim();

    let choices = [];
    if (category === 'scvi_move')    choices = autocompleteScviMove(q);
    if (category === 'scvi_ability') choices = autocompleteScviAbility(q);
    if (category === 'scvi_item')    choices = autocompleteScviItem(q);
    if (category === 'plza_move')    choices = autocompletePlzaMove(q);

    await interaction.respond(choices);
  },
};
