'use strict';

const {
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
} = require('discord.js');
const path = require('path');
const {
  getAvailableSeasons, getLatestSeason, loadSeasonData,
  getChampionSeasons, getLatestChampionSeason, loadChampionData,
  getSpriteUrl, findPokemon,
} = require('../utils/usageData');
const { TYPE_EMOJI } = require('../utils/buildEmbed');
const { getTypeWeaknesses } = require('../utils/pokeData');
const { translateType, translateFromZh, LANG_CHOICES } = require('../utils/i18n');

// ── Static data ───────────────────────────────────────────────────────────────

const zhHant   = require(path.join(__dirname, '../../data/zh-Hant.json'));
const MOVES_DB = require(path.join(__dirname, '../../data/moves_db.json'));

// Chinese type name → English type name (e.g. '妖精' → 'Fairy')
const ZH_TO_EN_TYPE = Object.fromEntries(
  Object.entries(zhHant.types).map(([en, zh]) => [zh, en]),
);

// ── Type/move emoji helpers ───────────────────────────────────────────────────

function typeEmoji(zhTypeName) {
  const en = ZH_TO_EN_TYPE[zhTypeName];
  return en ? (TYPE_EMOJI[en] ?? '') : '';
}

function moveTypeEmoji(zhMoveName) {
  const entry = MOVES_DB[zhMoveName];
  if (!entry?.type || entry.type === 'unknown') return '';
  const en = entry.type.charAt(0).toUpperCase() + entry.type.slice(1);
  return TYPE_EMOJI[en] ?? '';
}

/** Parse '<:name:id>' or '<a:name:id>' into {id, name, animated} for Discord component emoji. */
function parseEmojiObj(str) {
  if (!str) return null;
  const m = str.match(/^<(a?):(\w+):(\d+)>$/);
  return m ? { animated: m[1] === 'a', name: m[2], id: m[3] } : null;
}

// ── Name translation helpers ──────────────────────────────────────────────────

function moveName(zh, lang)    { return translateFromZh(zh, 'move',    lang); }
function abilityName(zh, lang) { return translateFromZh(zh, 'ability', lang); }
function natureName(zh, lang)  { return translateFromZh(zh, 'nature',  lang); }
function pokeName(zh, lang)    { return translateFromZh(zh, 'pokemon', lang); }

function teraTypeName(zh, lang) {
  if (lang === 'zh') return zh;
  const en = ZH_TO_EN_TYPE[zh];
  if (!en) return zh;
  return translateType(en, lang);
}

function teraTypeEmoji(zh) { return typeEmoji(zh); }

// ── Localised labels ──────────────────────────────────────────────────────────

const GAME_CHOICES = [
  { name: '寶可夢朱/紫 (SV)', value: 'sv' },
  { name: 'Pokémon Champions', value: 'champ' },
];

const LBL = {
  zh: {
    doubles: '雙打', singles: '單打',
    fmt: (s, f)    => `S${s} ${f}`,
    fmtChamp: (s, f) => `M-${s} ${f}`,
    overview:    '概覽', builds: '配置', moves: '招式', matchups: '對位',
    ability:     '特性', item: '持有道具', nature: '性格', tera: '太晶屬性',
    move:        '招式', teammate: '隊友',
    top3: '(Top 3)', top5: '(Top 5)', top10: '(Top 10)',
    winMove: '致勝招式', loseMove: '致命招式',
    winsAgainst: '主要優勢對位', defeatedBy: '主要劣勢對位',
    source:        '資料來源為 Pokémon HOME 級別對戰。',
    sourceChamp:   '資料來源為 Pokémon Champions HOME 級別對戰。',
    updated:       (t) => `資料更新於: <t:${t}:R>`,
    footer:        (s, f) => `S${s} ${f} · Pokémon HOME 使用率`,
    footerChamp:   (s, f) => `M-${s} ${f} · Pokémon Champions 使用率`,
    rank:        (r) => `排名 #${r}`,
    moveSel:     '查詢招式詳情...',
    abilitySel:  '查詢特性詳情...',
    teraSel:     '查詢太晶屬性相剋...',
    moveDetail:  (n) => `招式詳情: ${n}`,
    abilDetail:  (n) => `特性詳情: ${n}`,
    teraDetail:  (n) => `${n} 太晶屬性相剋`,
    usage:       (p) => `使用率: **${p}%**`,
    noData:      '暫無資料', noDataShort: '暫無詳細資料',
    type: '屬性', category: '分類', power: '威力',
    weak4: '4× 弱點', weak2: '2× 弱點', resist2: '½× 抗性', resist4: '¼× 抗性', immune: '免疫',
    noMatchup: '此屬性無特殊相剋關係',
    abilityCard: (n) => `特性詳情: ${n}`,
    notFound:    '❌ 資料不存在。',
    notFoundSeason: (s, f) => `❌ 找不到賽季 ${s} 的${f}資料。`,
    notFoundSeasonChamp: (s, f) => `❌ 找不到 Champions M-${s} 的${f}資料。`,
    notFoundPoke: (n) => `❌ 找不到「${n}」的資料。請透過自動補全選擇寶可夢。`,
    noMatchupFail: '無法查詢此屬性的相剋資訊。',
    calcFail: '計算失敗。',
  },
  en: {
    doubles: 'Doubles', singles: 'Singles',
    fmt: (s, f)    => `S${s} ${f}`,
    fmtChamp: (s, f) => `M-${s} ${f}`,
    overview:    'Overview', builds: 'Builds', moves: 'Moves', matchups: 'Matchups',
    ability:     'Ability', item: 'Held Item', nature: 'Nature', tera: 'Tera Type',
    move:        'Move', teammate: 'Teammates',
    top3: '(Top 3)', top5: '(Top 5)', top10: '(Top 10)',
    winMove: 'Win Moves', loseMove: 'Loss Moves',
    winsAgainst: 'Top Wins Against', defeatedBy: 'Top Defeated By',
    source:        'Data source: Pokémon HOME Ranked Battles.',
    sourceChamp:   'Data source: Pokémon Champions HOME Ranked Battles.',
    updated:       (t) => `Updated: <t:${t}:R>`,
    footer:        (s, f) => `S${s} ${f} · Pokémon HOME Usage`,
    footerChamp:   (s, f) => `M-${s} ${f} · Pokémon Champions Usage`,
    rank:        (r) => `Rank #${r}`,
    moveSel:     'Look up move details...',
    abilitySel:  'Look up ability details...',
    teraSel:     'Look up tera type matchups...',
    moveDetail:  (n) => `Move: ${n}`,
    abilDetail:  (n) => `Ability: ${n}`,
    teraDetail:  (n) => `${n} Tera Type Matchups`,
    usage:       (p) => `Usage: **${p}%**`,
    noData:      'No data', noDataShort: 'No detailed data available',
    type: 'Type', category: 'Category', power: 'Power',
    weak4: '4× Weak', weak2: '2× Weak', resist2: '½× Resist', resist4: '¼× Resist', immune: 'Immune',
    noMatchup: 'No special matchups for this type.',
    abilityCard: (n) => `Ability: ${n}`,
    notFound:    '❌ Data not found.',
    notFoundSeason: (s, f) => `❌ No data for Season ${s} ${f}.`,
    notFoundSeasonChamp: (s, f) => `❌ No Champions M-${s} ${f} data.`,
    notFoundPoke: (n) => `❌ No data for "${n}". Please select via autocomplete.`,
    noMatchupFail: 'Cannot look up matchups for this type.',
    calcFail: 'Calculation failed.',
  },
  ja: {
    doubles: 'ダブル', singles: 'シングル',
    fmt: (s, f)    => `S${s} ${f}`,
    fmtChamp: (s, f) => `M-${s} ${f}`,
    overview:    '概要', builds: '型', moves: '技', matchups: '対面',
    ability:     '特性', item: '持ち物', nature: '性格', tera: 'テラスタイプ',
    move:        '技', teammate: '相方',
    top3: '(Top 3)', top5: '(Top 5)', top10: '(Top 10)',
    winMove: '勝ち技', loseMove: '負け技',
    winsAgainst: '主な勝ち対面', defeatedBy: '主な負け対面',
    source:        'データ出典: Pokémon HOME ランクバトル。',
    sourceChamp:   'データ出典: Pokémon Champions HOME ランクバトル。',
    updated:       (t) => `更新: <t:${t}:R>`,
    footer:        (s, f) => `S${s} ${f} · Pokémon HOME 使用率`,
    footerChamp:   (s, f) => `M-${s} ${f} · Pokémon Champions 使用率`,
    rank:        (r) => `ランク #${r}`,
    moveSel:     'わざの詳細を見る...',
    abilitySel:  '特性の詳細を見る...',
    teraSel:     'テラスタイプの相性を見る...',
    moveDetail:  (n) => `わざ: ${n}`,
    abilDetail:  (n) => `特性: ${n}`,
    teraDetail:  (n) => `${n} テラスタイプ相性`,
    usage:       (p) => `使用率: **${p}%**`,
    noData:      'データなし', noDataShort: '詳細データなし',
    type: 'タイプ', category: '分類', power: 'いりょく',
    weak4: '4× 弱点', weak2: '2× 弱点', resist2: '½× 耐性', resist4: '¼× 耐性', immune: '無効',
    noMatchup: 'このタイプに特殊な相性はありません。',
    abilityCard: (n) => `特性: ${n}`,
    notFound:    '❌ データが存在しません。',
    notFoundSeason: (s, f) => `❌ シーズン ${s} ${f} のデータが見つかりません。`,
    notFoundSeasonChamp: (s, f) => `❌ Champions M-${s} ${f} のデータが見つかりません。`,
    notFoundPoke: (n) => `❌ 「${n}」のデータが見つかりません。オートコンプリートで選択してください。`,
    noMatchupFail: 'このタイプの相性を調べられません。',
    calcFail: '計算に失敗しました。',
  },
};

function fmtLabel(format, lang) { return (LBL[lang] ?? LBL.zh)[format === 'singles' ? 'singles' : 'doubles']; }

function fmtTitle(season, format, lang, game) {
  const lbl = LBL[lang] ?? LBL.zh;
  const f = fmtLabel(format, lang);
  return game === 'champ' ? lbl.fmtChamp(season, f) : lbl.fmt(season, f);
}

function fmtSource(lang, game) {
  const lbl = LBL[lang] ?? LBL.zh;
  return game === 'champ' ? lbl.sourceChamp : lbl.source;
}

function fmtFooter(season, format, lang, game) {
  const lbl = LBL[lang] ?? LBL.zh;
  const f = fmtLabel(format, lang);
  return game === 'champ' ? lbl.footerChamp(season, f) : lbl.footer(season, f);
}

// ── Format helpers ────────────────────────────────────────────────────────────

function fmtCol(arr, n, labelFn) {
  if (!arr?.length) return '—';
  return arr.slice(0, n).map(e => `${labelFn(e)}\n(${e.usage_percent}%)`).join('\n');
}

function fmtAbilities(arr, n, lang)  { return fmtCol(arr, n, e => `• ${abilityName(e.name, lang)}`); }
function fmtItems(arr, n, lang)      { return fmtCol(arr, n, e => `• ${e.name}`); } // items stay zh (HOME data)
function fmtNatures(arr, n, lang)    { return fmtCol(arr, n, e => `• ${natureName(e.name, lang)}`); }
function fmtTera(arr, n, lang)       { return fmtCol(arr, n, e => `${teraTypeEmoji(e.name)} ${teraTypeName(e.name, lang)}`); }
function fmtMoves(arr, n, lang)      { return fmtCol(arr, n, e => `${moveTypeEmoji(e.name)} ${moveName(e.name, lang)}`); }

function fmtFullList(arr, labelFn) {
  if (!arr?.length) return '—';
  return arr.map((e, i) => `${i + 1}. ${labelFn(e)} **${e.usage_percent}%**`).join('\n');
}

function fmtNameList(arr, n, lang) {
  if (!arr?.length) return '—';
  return arr.slice(0, n).map((e, i) => `${i + 1}. ${pokeName(e.full_name, lang)}`).join('\n');
}

function relativeTime(data, lang) {
  if (!data?.last_updated) return '';
  return (LBL[lang] ?? LBL.zh).updated(data.last_updated);
}

// ── Embed builders ────────────────────────────────────────────────────────────

function buildOverviewEmbed(entry, season, format, data, lang = 'zh', game = 'sv') {
  const lbl  = LBL[lang] ?? LBL.zh;
  const name = pokeName(entry.full_name, lang);
  const fields = [
    { name: `${lbl.ability} ${lbl.top3}`,  value: fmtAbilities(entry.abilities,  3, lang), inline: true },
    { name: `${lbl.item} ${lbl.top3}`,     value: fmtItems(entry.held_items,     3, lang), inline: true },
    { name: `${lbl.nature} ${lbl.top3}`,   value: fmtNatures(entry.natures,      3, lang), inline: true },
  ];
  if (game !== 'champ') {
    fields.push({ name: `${lbl.tera} ${lbl.top3}`, value: fmtTera(entry.tera_types, 3, lang), inline: true });
  }
  fields.push(
    { name: `${lbl.move} ${lbl.top3}`,     value: fmtMoves(entry.moves,          3, lang), inline: true },
    { name: `${lbl.teammate} ${lbl.top3}`, value: fmtNameList(entry.teammates,   3, lang), inline: true },
  );
  return new EmbedBuilder()
    .setColor(0xEE1515)
    .setTitle(`${fmtTitle(season, format, lang, game)} · ${name} (${lbl.rank(entry.rank)})`)
    .setDescription(`${fmtSource(lang, game)}\n${relativeTime(data, lang)}`)
    .setThumbnail(getSpriteUrl(entry))
    .setFooter({ text: fmtFooter(season, format, lang, game) })
    .addFields(...fields);
}

function buildBuildsEmbed(entry, season, format, data, lang = 'zh', game = 'sv') {
  const lbl  = LBL[lang] ?? LBL.zh;
  const name = pokeName(entry.full_name, lang);
  const fields = [
    { name: `💎 ${lbl.ability}`, value: fmtFullList(entry.abilities, e => abilityName(e.name, lang)), inline: true },
    { name: `🌿 ${lbl.nature}`,  value: fmtFullList(entry.natures,   e => natureName(e.name, lang)),  inline: true },
  ];
  if (game !== 'champ') {
    fields.push({ name: `✨ ${lbl.tera}`, value: fmtFullList(entry.tera_types, e => `${teraTypeEmoji(e.name)} ${teraTypeName(e.name, lang)}`), inline: true });
  }
  fields.push({ name: `🎒 ${lbl.item}`, value: fmtFullList(entry.held_items, e => e.name), inline: false });
  return new EmbedBuilder()
    .setColor(0x4A90D9)
    .setTitle(`${fmtTitle(season, format, lang, game)} · ${name} — ${lbl.builds}`)
    .setThumbnail(getSpriteUrl(entry))
    .setFooter({ text: fmtFooter(season, format, lang, game) })
    .addFields(...fields);
}

function buildMovesEmbed(entry, season, format, data, lang = 'zh', game = 'sv') {
  const lbl  = LBL[lang] ?? LBL.zh;
  const name = pokeName(entry.full_name, lang);
  const fmtMoveList = (arr, n) =>
    !arr?.length ? '—' :
    arr.slice(0, n).map((e, i) =>
      `${i + 1}. ${moveTypeEmoji(e.name)} ${moveName(e.name, lang)} **${e.usage_percent}%**`,
    ).join('\n');

  const fields = [{ name: `🎯 ${lbl.move} ${lbl.top10}`, value: fmtMoveList(entry.moves, 10), inline: false }];
  if (game !== 'champ') {
    fields.push(
      { name: `✅ ${lbl.winMove} ${lbl.top5}`,  value: fmtMoveList(entry.win_moves,  5), inline: true },
      { name: `❌ ${lbl.loseMove} ${lbl.top5}`, value: fmtMoveList(entry.lose_moves, 5), inline: true },
    );
  }
  return new EmbedBuilder()
    .setColor(0xEE9900)
    .setTitle(`${fmtTitle(season, format, lang, game)} · ${name} — ${lbl.moves}`)
    .setThumbnail(getSpriteUrl(entry))
    .setFooter({ text: fmtFooter(season, format, lang, game) })
    .addFields(...fields);
}

function buildMatchupsEmbed(entry, season, format, data, lang = 'zh', game = 'sv') {
  const lbl  = LBL[lang] ?? LBL.zh;
  const name = pokeName(entry.full_name, lang);
  const fields = [{ name: `🤝 ${lbl.teammate} ${lbl.top5}`, value: fmtNameList(entry.teammates, 5, lang), inline: true }];
  if (game !== 'champ') {
    fields.push(
      { name: `✅ ${lbl.winsAgainst} ${lbl.top5}`, value: fmtNameList(entry.most_wins_against, 5, lang), inline: true },
      { name: `❌ ${lbl.defeatedBy} ${lbl.top5}`,  value: fmtNameList(entry.most_defeated_by,  5, lang), inline: true },
    );
  }
  return new EmbedBuilder()
    .setColor(0x57C87A)
    .setTitle(`${fmtTitle(season, format, lang, game)} · ${name} — ${lbl.matchups}`)
    .setThumbnail(getSpriteUrl(entry))
    .setFooter({ text: fmtFooter(season, format, lang, game) })
    .addFields(...fields);
}

// ── Component builders ────────────────────────────────────────────────────────

const TAB_IDS = ['ov', 'bd', 'mv', 'mt'];

function tabLabel(id, lang) {
  const lbl = LBL[lang] ?? LBL.zh;
  return { ov: lbl.overview, bd: lbl.builds, mv: lbl.moves, mt: lbl.matchups }[id] ?? id;
}

function makeTabRow(activeTab, season, format, pokemonName, lang, game = 'sv') {
  const f = format === 'singles' ? 's' : 'd';
  const g = game === 'champ' ? 'c' : 'v';
  return new ActionRowBuilder().addComponents(
    TAB_IDS.map(t => new ButtonBuilder()
      .setCustomId(`up|${t}|${season}|${f}|${lang}|${g}|${pokemonName}`)
      .setLabel(tabLabel(t, lang))
      .setStyle(t === activeTab ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(t === activeTab),
    ),
  );
}

function makeMoveSelectRow(entry, season, format, lang, game = 'sv') {
  const f    = format === 'singles' ? 's' : 'd';
  const g    = game === 'champ' ? 'c' : 'v';
  const lbl  = LBL[lang] ?? LBL.zh;
  const moves = (entry.moves ?? []).slice(0, 10);
  if (!moves.length) return null;
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`up_mv_sel|${season}|${f}|${lang}|${g}|${entry.full_name}`)
    .setPlaceholder(lbl.moveSel)
    .addOptions(moves.map(m => {
      const dbEntry = MOVES_DB[m.name];
      const enType  = dbEntry?.type ? dbEntry.type.charAt(0).toUpperCase() + dbEntry.type.slice(1) : null;
      const emoji   = enType ? parseEmojiObj(TYPE_EMOJI[enType]) : null;
      const opt = new StringSelectMenuOptionBuilder()
        .setLabel(`${moveName(m.name, lang)}  ${m.usage_percent}%`.slice(0, 100))
        .setValue(m.name); // keep zh as value (used for DB lookup)
      if (emoji) opt.setEmoji(emoji);
      return opt;
    }));
  return new ActionRowBuilder().addComponents(menu);
}

function makeAbilitySelectRow(entry, season, format, lang, game = 'sv') {
  const f         = format === 'singles' ? 's' : 'd';
  const g         = game === 'champ' ? 'c' : 'v';
  const lbl       = LBL[lang] ?? LBL.zh;
  const abilities = (entry.abilities ?? []).slice(0, 10);
  if (!abilities.length) return null;
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`up_ab_sel|${season}|${f}|${lang}|${g}|${entry.full_name}`)
    .setPlaceholder(lbl.abilitySel)
    .addOptions(abilities.map(a =>
      new StringSelectMenuOptionBuilder()
        .setLabel(`${abilityName(a.name, lang)}  ${a.usage_percent}%`.slice(0, 100))
        .setValue(a.name), // keep zh as value
    ));
  return new ActionRowBuilder().addComponents(menu);
}

function makeTeraSelectRow(entry, season, format, lang, game = 'sv') {
  if (game === 'champ') return null;
  const f     = format === 'singles' ? 's' : 'd';
  const g     = 'v';
  const lbl   = LBL[lang] ?? LBL.zh;
  const teras = (entry.tera_types ?? []).slice(0, 10);
  if (!teras.length) return null;
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`up_tr_sel|${season}|${f}|${lang}|${g}|${entry.full_name}`)
    .setPlaceholder(lbl.teraSel)
    .addOptions(teras.map(t => {
      const emoji = parseEmojiObj(teraTypeEmoji(t.name));
      const opt = new StringSelectMenuOptionBuilder()
        .setLabel(`${teraTypeName(t.name, lang)}  ${t.usage_percent}%`.slice(0, 100))
        .setValue(t.name); // keep zh as value
      if (emoji) opt.setEmoji(emoji);
      return opt;
    }));
  return new ActionRowBuilder().addComponents(menu);
}

function buildComponents(activeTab, entry, season, format, lang, game = 'sv') {
  const rows = [makeTabRow(activeTab, season, format, entry.full_name, lang, game)];
  const moveRow  = makeMoveSelectRow(entry, season, format, lang, game);
  const abilRow  = makeAbilitySelectRow(entry, season, format, lang, game);
  const teraRow  = makeTeraSelectRow(entry, season, format, lang, game);
  if (moveRow)  rows.push(moveRow);
  if (abilRow)  rows.push(abilRow);
  if (teraRow)  rows.push(teraRow);
  return rows;
}

// ── Select menu response handlers ─────────────────────────────────────────────

async function handleMoveSelect(interaction) {
  const parts    = interaction.customId.split('|');
  const lang     = parts[3] ?? 'zh';
  const lbl      = LBL[lang] ?? LBL.zh;
  const zhMoveName = interaction.values[0];
  const db       = MOVES_DB[zhMoveName];
  const dispName = moveName(zhMoveName, lang);
  const lines    = [];
  if (db?.type && db.type !== 'unknown') {
    const en = db.type.charAt(0).toUpperCase() + db.type.slice(1);
    lines.push(`**${lbl.type}**: ${TYPE_EMOJI[en] ?? ''} ${translateType(en, lang)}`);
  }
  if (db?.category && db.category !== 'unknown') {
    const catMap = {
      physical: { zh: '物理', en: 'Physical', ja: 'ぶつり' },
      special:  { zh: '特殊', en: 'Special',  ja: 'とくしゅ' },
      status:   { zh: '變化', en: 'Status',   ja: 'へんか' },
    };
    lines.push(`**${lbl.category}**: ${catMap[db.category]?.[lang] ?? db.category}`);
  }
  if (db?.power) lines.push(`**${lbl.power}**: ${db.power}`);
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(lbl.moveDetail(dispName))
    .setDescription(lines.length ? lines.join('\n') : lbl.noDataShort);
  await interaction.reply({ embeds: [embed], flags: 64 });
}

async function handleAbilitySelect(interaction) {
  const parts      = interaction.customId.split('|');
  const seasonStr  = parts[1];
  const f          = parts[2];
  const lang       = parts[3] ?? 'zh';
  const g          = parts[4] ?? 'v';
  const pokemonName = parts.slice(5).join('|');
  const lbl        = LBL[lang] ?? LBL.zh;
  const format     = f === 's' ? 'singles' : 'doubles';
  const game       = g === 'c' ? 'champ' : 'sv';
  const season     = seasonStr;
  const zhAbilName = interaction.values[0];
  const dispName   = abilityName(zhAbilName, lang);

  const data  = game === 'champ' ? loadChampionData(season, format) : loadSeasonData(parseInt(season, 10), format);
  const entry = data ? findPokemon(data, pokemonName) : null;
  const abil  = entry?.abilities?.find(a => a.name === zhAbilName);

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(lbl.abilDetail(dispName))
    .setDescription(abil ? lbl.usage(abil.usage_percent) : lbl.noData);
  await interaction.reply({ embeds: [embed], flags: 64 });
}

async function handleTeraSelect(interaction) {
  const parts     = interaction.customId.split('|');
  const lang      = parts[3] ?? 'zh';
  const lbl       = LBL[lang] ?? LBL.zh;
  const zhTypeName = interaction.values[0];
  const enType    = ZH_TO_EN_TYPE[zhTypeName];
  if (!enType || enType === '???') {
    await interaction.reply({ content: lbl.noMatchupFail, flags: 64 });
    return;
  }

  const matchups = getTypeWeaknesses('Pikachu', enType);
  if (!matchups) {
    await interaction.reply({ content: lbl.calcFail, flags: 64 });
    return;
  }

  const fmtTypes = types =>
    types.length ? types.map(t => `${TYPE_EMOJI[t] ?? ''} ${translateType(t, lang)}`).join('  ') : '—';

  const emojiStr  = teraTypeEmoji(zhTypeName);
  const dispType  = teraTypeName(zhTypeName, lang);
  const fields    = [];
  if (matchups['4'].length)    fields.push({ name: lbl.weak4,    value: fmtTypes(matchups['4']),    inline: true });
  if (matchups['2'].length)    fields.push({ name: lbl.weak2,    value: fmtTypes(matchups['2']),    inline: true });
  if (matchups['0.5'].length)  fields.push({ name: lbl.resist2,  value: fmtTypes(matchups['0.5']),  inline: true });
  if (matchups['0.25'].length) fields.push({ name: lbl.resist4,  value: fmtTypes(matchups['0.25']), inline: true });
  if (matchups['0'].length)    fields.push({ name: lbl.immune,   value: fmtTypes(matchups['0']),    inline: true });
  if (!fields.length)          fields.push({ name: lbl.teraDetail(dispType), value: lbl.noMatchup, inline: false });

  const embed = new EmbedBuilder()
    .setColor(0xEE1515)
    .setTitle(`${emojiStr} ${lbl.teraDetail(dispType)}`)
    .addFields(...fields)
    .setFooter({ text: `Pokémon HOME · ${lbl.tera}` });
  await interaction.reply({ embeds: [embed], flags: 64 });
}

// ── Command ───────────────────────────────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName('usage')
    .setDescription('查詢 Pokémon HOME 賽季個別寶可夢使用率數據')
    .addStringOption(o => o
      .setName('game')
      .setDescription('遊戲版本 / Game')
      .setRequired(true)
      .addChoices(...GAME_CHOICES))
    .addStringOption(o => o
      .setName('season')
      .setDescription('賽季 (請先選擇遊戲)')
      .setRequired(true)
      .setAutocomplete(true))
    .addStringOption(o => o
      .setName('pokemon')
      .setDescription('寶可夢名稱 (先選賽季，再搜尋寶可夢)')
      .setRequired(true)
      .setAutocomplete(true))
    .addStringOption(o => o
      .setName('format')
      .setDescription('賽制 (預設：雙打)')
      .addChoices(
        { name: '雙打 (Doubles)', value: 'doubles' },
        { name: '單打 (Singles)', value: 'singles' },
      ))
    .addStringOption(o => o
      .setName('lang')
      .setDescription('顯示語言 / Display language (預設：繁體中文)')
      .addChoices(...LANG_CHOICES)),

  async execute(interaction) {
    const game         = interaction.options.getString('game');
    const format       = interaction.options.getString('format') ?? 'doubles';
    const seasonRaw    = interaction.options.getString('season');
    const pokemonQuery = interaction.options.getString('pokemon');
    const lang         = interaction.options.getString('lang') ?? 'zh';
    const lbl          = LBL[lang] ?? LBL.zh;

    let data, season;
    if (game === 'champ') {
      season = seasonRaw;
      data   = loadChampionData(season, format);
      if (!data) {
        await interaction.reply({ content: lbl.notFoundSeasonChamp(season, fmtLabel(format, lang)), flags: 64 });
        return;
      }
    } else {
      season = parseInt(seasonRaw, 10);
      data   = loadSeasonData(season, format);
      if (!data) {
        await interaction.reply({ content: lbl.notFoundSeason(season, fmtLabel(format, lang)), flags: 64 });
        return;
      }
    }

    const entry = pokemonQuery ? findPokemon(data, pokemonQuery) : null;
    if (!entry) {
      await interaction.reply({ content: lbl.notFoundPoke(pokemonQuery), flags: 64 });
      return;
    }

    await interaction.reply({
      embeds:     [buildOverviewEmbed(entry, season, format, data, lang, game)],
      components: buildComponents('ov', entry, season, format, lang, game),
    });
  },

  async autocomplete(interaction) {
    const focused   = interaction.options.getFocused(true);
    const game      = interaction.options.getString('game') ?? 'sv'; // fallback for autocomplete mid-type
    const format    = interaction.options.getString('format') ?? 'doubles';
    const seasonRaw = interaction.options.getString('season');
    const lang      = interaction.options.getString('lang') ?? 'zh';

    if (focused.name === 'season') {
      const q = focused.value.trim().toLowerCase();
      if (game === 'champ') {
        const seasons     = getChampionSeasons().slice().reverse();
        const latestChamp = getLatestChampionSeason();
        const filtered    = q ? seasons.filter(s => s.startsWith(q)) : seasons;
        const champLabel  = lang === 'en' ? s => `Season M-${s.slice(1)}${s === latestChamp ? ' (Latest)' : ''}`
                          : lang === 'ja' ? s => `シーズン M-${s.slice(1)}${s === latestChamp ? ' (最新)' : ''}`
                          :                 s => `賽季 M-${s.slice(1)}${s === latestChamp ? ' (最新)' : ''}`;
        await interaction.respond(filtered.slice(0, 25).map(s => ({ name: champLabel(s), value: s })));
      } else {
        const latest      = getLatestSeason();
        const seasons     = getAvailableSeasons().slice().reverse();
        const filtered    = q ? seasons.filter(s => String(s).startsWith(q)) : seasons;
        const seasonLabel = lang === 'en' ? s => `Season ${s}${s === latest ? ' (Latest)' : ''}`
                          : lang === 'ja' ? s => `シーズン ${s}${s === latest ? ' (最新)' : ''}`
                          :                 s => `賽季 ${s}${s === latest ? ' (最新)' : ''}`;
        await interaction.respond(filtered.slice(0, 25).map(s => ({ name: seasonLabel(s), value: String(s) })));
      }
      return;
    }

    if (focused.name === 'pokemon') {
      if (!seasonRaw) { await interaction.respond([]); return; }
      const q = focused.value.toLowerCase();
      let data;
      if (game === 'champ') {
        data = loadChampionData(seasonRaw, format);
      } else {
        data = loadSeasonData(parseInt(seasonRaw, 10), format);
      }
      if (!data) { await interaction.respond([]); return; }

      const entries = Object.values(data)
        .filter(e => e && typeof e === 'object' && e.full_name)
        .sort((a, b) => a.rank - b.rank);

      const matches = q ? entries.filter(e => e.full_name.toLowerCase().includes(q)) : entries;

      await interaction.respond(
        matches.slice(0, 25).map(e => ({
          name:  `#${String(e.rank).padStart(3, ' ')} ${e.full_name}`,
          value: e.full_name,
        })),
      );
    }
  },

  async handleButton(interaction) {
    const parts      = interaction.customId.split('|');
    const tab        = parts[1];
    const seasonStr  = parts[2];
    const format     = parts[3] === 's' ? 'singles' : 'doubles';
    const lang       = parts[4] ?? 'zh';
    const g          = parts[5] ?? 'v';
    const pokemonName = parts.slice(6).join('|');
    const lbl        = LBL[lang] ?? LBL.zh;
    const game       = g === 'c' ? 'champ' : 'sv';
    const season     = game === 'champ' ? seasonStr : parseInt(seasonStr, 10);

    const data  = game === 'champ' ? loadChampionData(seasonStr, format) : loadSeasonData(season, format);
    const entry = data ? findPokemon(data, pokemonName) : null;
    if (!entry) { await interaction.reply({ content: lbl.notFound, flags: 64 }); return; }

    let embed;
    if      (tab === 'bd') embed = buildBuildsEmbed(entry, season, format, data, lang, game);
    else if (tab === 'mv') embed = buildMovesEmbed(entry, season, format, data, lang, game);
    else if (tab === 'mt') embed = buildMatchupsEmbed(entry, season, format, data, lang, game);
    else                   embed = buildOverviewEmbed(entry, season, format, data, lang, game);

    await interaction.update({
      embeds:     [embed],
      components: buildComponents(tab, entry, season, format, lang, game),
    });
  },

  async handleSelectMenu(interaction) {
    if (interaction.customId.startsWith('up_mv_sel|')) return handleMoveSelect(interaction);
    if (interaction.customId.startsWith('up_ab_sel|')) return handleAbilitySelect(interaction);
    if (interaction.customId.startsWith('up_tr_sel|')) return handleTeraSelect(interaction);
  },
};
