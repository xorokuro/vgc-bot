'use strict';

const {
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const { getAvailableSeasons, getLatestSeason, loadSeasonData, getRankedEntries } = require('../utils/usageData');
const { LANG_CHOICES } = require('../utils/i18n');

const PAGE_SIZE = 25;
const COLOR     = 0xEE1515;

const L = {
  zh: {
    doubles: '雙打', singles: '單打',
    title:   (s, fmt) => `S${s} ${fmt} 使用率排行 Top 150`,
    footer:  (p, t)   => `頁數: ${p}/${t} · Pokémon HOME 使用率`,
    prev: '← 上頁', next: '下頁 →',
    season: (s, latest) => `賽季 ${s}${s === latest ? ' (最新)' : ''}`,
    notFound: (s, fmt) => `❌ 找不到賽季 ${s} 的${fmt}資料。`,
    noData: '❌ 資料不存在。',
  },
  en: {
    doubles: 'Doubles', singles: 'Singles',
    title:   (s, fmt) => `S${s} ${fmt} Usage Top 150`,
    footer:  (p, t)   => `Page: ${p}/${t} · Pokémon HOME Usage`,
    prev: '← Prev', next: 'Next →',
    season: (s, latest) => `Season ${s}${s === latest ? ' (Latest)' : ''}`,
    notFound: (s, fmt) => `❌ No data for Season ${s} ${fmt}.`,
    noData: '❌ Data not found.',
  },
  ja: {
    doubles: 'ダブル', singles: 'シングル',
    title:   (s, fmt) => `S${s} ${fmt} 使用率 Top 150`,
    footer:  (p, t)   => `ページ: ${p}/${t} · Pokémon HOME 使用率`,
    prev: '← 前', next: '次 →',
    season: (s, latest) => `シーズン ${s}${s === latest ? ' (最新)' : ''}`,
    notFound: (s, fmt) => `❌ シーズン ${s} ${fmt} のデータが見つかりません。`,
    noData: '❌ データが存在しません。',
  },
};

function fmtLabel(format, lang) {
  return (L[lang] ?? L.zh)[format === 'singles' ? 'singles' : 'doubles'];
}

function buildEmbed(ranked, season, format, page, lang = 'zh') {
  const lbl        = L[lang] ?? L.zh;
  const fmt        = fmtLabel(format, lang);
  const totalPages = Math.ceil(ranked.length / PAGE_SIZE);
  const slice      = ranked.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const lines      = slice.map(e => `\`#${String(e.rank).padStart(3)}\`  ${e.full_name}`).join('\n');

  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(lbl.title(season, fmt))
    .setDescription(lines || '—')
    .setFooter({ text: lbl.footer(page + 1, totalPages) });
}

function makePageRow(page, totalPages, season, format, lang = 'zh') {
  const lbl = L[lang] ?? L.zh;
  const f   = format === 'singles' ? 's' : 'd';
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`tp|${page - 1}|${season}|${f}|${lang}`)
      .setLabel(lbl.prev)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId(`tp|${page + 1}|${season}|${f}|${lang}`)
      .setLabel(lbl.next)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1),
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('top')
    .setDescription('查看 Pokémon HOME 賽季使用率排行榜 Top 150')
    .addStringOption(o => o
      .setName('format')
      .setDescription('賽制 (預設：雙打)')
      .addChoices(
        { name: '雙打 (Doubles)', value: 'doubles' },
        { name: '單打 (Singles)', value: 'singles' },
      ))
    .addStringOption(o => o
      .setName('season')
      .setDescription('賽季 (預設：最新)')
      .setAutocomplete(true))
    .addStringOption(o => o
      .setName('lang')
      .setDescription('顯示語言 / Display language (預設：繁體中文)')
      .addChoices(...LANG_CHOICES)),

  async execute(interaction) {
    const format = interaction.options.getString('format') ?? 'doubles';
    const latest = getLatestSeason();
    const season = parseInt(interaction.options.getString('season') ?? String(latest), 10);
    const lang   = interaction.options.getString('lang') ?? 'zh';
    const lbl    = L[lang] ?? L.zh;

    const data = loadSeasonData(season, format);
    if (!data) {
      await interaction.reply({ content: lbl.notFound(season, fmtLabel(format, lang)), flags: 64 });
      return;
    }

    const ranked     = getRankedEntries(data);
    const totalPages = Math.ceil(ranked.length / PAGE_SIZE);
    await interaction.reply({
      embeds:     [buildEmbed(ranked, season, format, 0, lang)],
      components: [makePageRow(0, totalPages, season, format, lang)],
    });
  },

  async autocomplete(interaction) {
    const latest  = getLatestSeason();
    const lang    = interaction.options.getString('lang') ?? 'zh';
    const lbl     = L[lang] ?? L.zh;
    const q       = interaction.options.getFocused().trim();
    const seasons = getAvailableSeasons().slice().reverse();
    const filtered = q ? seasons.filter(s => String(s).startsWith(q)) : seasons;
    await interaction.respond(
      filtered.slice(0, 25).map(s => ({
        name:  lbl.season(s, latest),
        value: String(s),
      })),
    );
  },

  async handleButton(interaction) {
    const parts  = interaction.customId.split('|');
    const page   = parseInt(parts[1], 10);
    const season = parseInt(parts[2], 10);
    const format = parts[3] === 's' ? 'singles' : 'doubles';
    const lang   = parts[4] ?? 'zh';
    const lbl    = L[lang] ?? L.zh;

    const data = loadSeasonData(season, format);
    if (!data) { await interaction.reply({ content: lbl.noData, flags: 64 }); return; }

    const ranked     = getRankedEntries(data);
    const totalPages = Math.ceil(ranked.length / PAGE_SIZE);
    await interaction.update({
      embeds:     [buildEmbed(ranked, season, format, page, lang)],
      components: [makePageRow(page, totalPages, season, format, lang)],
    });
  },
};
