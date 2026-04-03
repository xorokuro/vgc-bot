'use strict';

const {
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const { getAvailableSeasons, getLatestSeason, loadSeasonData, getRankedEntries } = require('../utils/usageData');

const PAGE_SIZE = 25;
const COLOR     = 0xEE1515;

function buildEmbed(ranked, season, format, page) {
  const fmt        = format === 'singles' ? '單打' : '雙打';
  const totalPages = Math.ceil(ranked.length / PAGE_SIZE);
  const slice      = ranked.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const lines      = slice.map(e => `\`#${String(e.rank).padStart(3)}\`  ${e.full_name}`).join('\n');

  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(`S${season} ${fmt} 使用率排行 Top 150`)
    .setDescription(lines || '—')
    .setFooter({ text: `頁數: ${page + 1}/${totalPages} · Pokémon HOME 使用率` });
}

function makePageRow(page, totalPages, season, format) {
  const f = format === 'singles' ? 's' : 'd';
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`tp|${page - 1}|${season}|${f}`)
      .setLabel('← 上頁')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId(`tp|${page + 1}|${season}|${f}`)
      .setLabel('下頁 →')
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
      .setAutocomplete(true)),

  async execute(interaction) {
    const format  = interaction.options.getString('format') ?? 'doubles';
    const latest  = getLatestSeason();
    const season  = parseInt(interaction.options.getString('season') ?? String(latest), 10);

    const data = loadSeasonData(season, format);
    if (!data) {
      await interaction.reply({ content: `❌ 找不到賽季 ${season} 的${format === 'doubles' ? '雙打' : '單打'}資料。`, flags: 64 });
      return;
    }

    const ranked     = getRankedEntries(data);
    const totalPages = Math.ceil(ranked.length / PAGE_SIZE);
    await interaction.reply({
      embeds:     [buildEmbed(ranked, season, format, 0)],
      components: [makePageRow(0, totalPages, season, format)],
    });
  },

  async autocomplete(interaction) {
    const latest   = getLatestSeason();
    const q        = interaction.options.getFocused().trim();
    const seasons  = getAvailableSeasons().slice().reverse();
    const filtered = q ? seasons.filter(s => String(s).startsWith(q)) : seasons;
    await interaction.respond(
      filtered.slice(0, 25).map(s => ({
        name:  `賽季 ${s}${s === latest ? ' (最新)' : ''}`,
        value: String(s),
      })),
    );
  },

  async handleButton(interaction) {
    const [, pageStr, seasonStr, f] = interaction.customId.split('|');
    const page   = parseInt(pageStr,   10);
    const season = parseInt(seasonStr, 10);
    const format = f === 's' ? 'singles' : 'doubles';

    const data = loadSeasonData(season, format);
    if (!data) { await interaction.reply({ content: '❌ 資料不存在。', flags: 64 }); return; }

    const ranked     = getRankedEntries(data);
    const totalPages = Math.ceil(ranked.length / PAGE_SIZE);
    await interaction.update({
      embeds:     [buildEmbed(ranked, season, format, page)],
      components: [makePageRow(page, totalPages, season, format)],
    });
  },
};
