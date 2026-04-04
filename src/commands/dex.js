'use strict';

const {
  SlashCommandBuilder, EmbedBuilder, AttachmentBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const { searchPokemon, GAME_CONFIGS } = require('../utils/dexSearch');
const {
  buildStatImage, buildDetailEmbed, getPokeDisplayName,
  DEX_LABELS, STAT_LABELS, gameLabel,
} = require('../utils/pokedexUtils');

const PAGE_SIZE = 25;
const COLOR     = 0x3B4CCA;
const CACHE_TTL = 10 * 60 * 1000;

// ── Result cache ──────────────────────────────────────────────────────────────
const _cache = new Map();

function cacheStore(id, payload) {
  _cache.set(id, { ...payload, expires: Date.now() + CACHE_TTL });
  setTimeout(() => _cache.delete(id), CACHE_TTL);
}

// ── Search result embed ───────────────────────────────────────────────────────
function buildEmbed(results, gameId, query, page, showStats, lang = 'zh') {
  const L          = DEX_LABELS[lang] ?? DEX_LABELS.zh;
  const gLabel     = gameLabel(gameId, lang);
  const totalPages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const slice      = results.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const statLabels = STAT_LABELS[lang] ?? STAT_LABELS.zh;

  const lines = slice.map(p => {
    const name = getPokeDisplayName(p, lang);
    if (showStats && p.stats) {
      const s   = p.stats;
      const bst = Object.values(s).reduce((a, v) => a + (v || 0), 0);
      const [HP, Atk, Def, SpA, SpD, Spe] = statLabels;
      return `${name}　${HP}:${s.hp} ${Atk}:${s.attack} ${Def}:${s.defense} ${SpA}:${s['special-attack']} ${SpD}:${s['special-defense']} ${Spe}:${s.speed} [${bst}]`;
    }
    return name;
  });

  const titleStr   = `🔍 ${L.searchTitle} (${gLabel})`;
  const queryLabel = lang === 'en' ? `${L.query}: ${query}` : lang === 'ja' ? `${L.query}: ${query}` : `${L.query}: ${query}`;
  const countLabel = lang === 'en' ? `**${results.length}** ${L.found}` : lang === 'ja' ? `**${results.length}** ${L.found}` : `共找到 **${results.length}** ${L.found}`;

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(titleStr)
    .setDescription(`${queryLabel}\n${countLabel}\n\n${lines.join('\n') || '—'}`)
    .setFooter({ text: `${L.page}: ${page + 1}/${totalPages}` });

  return { embed, slice };
}

// ── Dropdown ──────────────────────────────────────────────────────────────────
function buildDetailMenu(slice, gameId, lang, pub) {
  if (!slice.length) return null;
  const L       = DEX_LABELS[lang] ?? DEX_LABELS.zh;
  const options = slice.map((p, i) => ({
    label: getPokeDisplayName(p, lang).slice(0, 100) || `#${i}`,
    value: p.name_en || String(i),
  }));
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`dex_detail|${gameId}|${lang}|${pub ? '1' : '0'}`)
      .setPlaceholder(`🔎 ${L.details}`)
      .addOptions(options),
  );
}

function makeNavRow(page, totalPages, cacheId, lang) {
  const L = DEX_LABELS[lang] ?? DEX_LABELS.zh;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`dex_page|${cacheId}|${page - 1}`)
      .setLabel(L.prevPage)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId(`dex_page|${cacheId}|${page + 1}`)
      .setLabel(L.nextPage)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1),
  );
}

function pageComponents(slice, gameId, page, totalPages, cacheId, lang, pub) {
  const rows = [];
  if (totalPages > 1) rows.push(makeNavRow(page, totalPages, cacheId, lang));
  const menu = buildDetailMenu(slice, gameId, lang, pub);
  if (menu) rows.push(menu);
  return rows;
}

// ── Command ────────────────────────────────────────────────────────────────────
module.exports = {
  data: new SlashCommandBuilder()
    .setName('pokemon_search')
    .setDescription('搜尋主系列寶可夢 / Search Pokémon by type, stats, moves, abilities')
    .addStringOption(o => o
      .setName('game')
      .setDescription('遊戲版本 / Game version')
      .setRequired(true)
      .addChoices(
        { name: '朱紫 (Scarlet/Violet)',      value: 'scvi' },
        { name: '傳說Z-A (Legends: Z-A)',     value: 'plza' },
      ))
    .addStringOption(o => o
      .setName('query')
      .setDescription('搜尋條件 / Query — e.g. 火系 AND 速度>=100 AND NOT 龍系')
      .setRequired(true))
    .addBooleanOption(o => o
      .setName('show_stats')
      .setDescription('顯示種族值 / Show base stats in results (default: off)'))
    .addStringOption(o => o
      .setName('lang')
      .setDescription('顯示語言（預設：繁體中文）/ Display language')
      .addChoices(
        { name: '繁體中文', value: 'zh' },
        { name: 'English',  value: 'en' },
        { name: '日本語',   value: 'ja' },
      ))
    .addBooleanOption(o => o
      .setName('public')
      .setDescription('公開顯示詳細資料（預設：僅自己可見）/ Show detail card publicly')),

  async execute(interaction) {
    const gameId    = interaction.options.getString('game');
    const rawQuery  = interaction.options.getString('query');
    const showStats = interaction.options.getBoolean('show_stats') ?? false;
    const lang      = interaction.options.getString('lang') ?? 'zh';
    const pub       = interaction.options.getBoolean('public') ?? false;

    await interaction.deferReply();

    let results, query;
    try {
      ({ results, query } = searchPokemon(rawQuery, gameId));
    } catch (err) {
      await interaction.editReply({ content: `❌ ${err.message}` });
      return;
    }

    if (!results.length) {
      const L      = DEX_LABELS[lang] ?? DEX_LABELS.zh;
      const gLabel = gameLabel(gameId, lang);
      await interaction.editReply({
        content: `**${gLabel}**: ${L.searchTitle} — ${query}\n0 ${L.found}`,
      });
      return;
    }

    const cacheId    = interaction.id;
    const totalPages = Math.ceil(results.length / PAGE_SIZE);
    cacheStore(cacheId, { results, gameId, query, showStats, lang, pub });

    const { embed, slice } = buildEmbed(results, gameId, query, 0, showStats, lang);
    await interaction.editReply({
      embeds:     [embed],
      components: pageComponents(slice, gameId, 0, totalPages, cacheId, lang, pub),
    });
  },

  async handlePageButton(interaction) {
    const [, cacheId, pageStr] = interaction.customId.split('|');
    const page = parseInt(pageStr, 10);

    const cached = _cache.get(cacheId);
    if (!cached) {
      const L = DEX_LABELS.zh;
      await interaction.reply({ content: `⏰ ${L.expired}`, flags: 64 });
      return;
    }

    const { results, gameId, query, showStats, lang = 'zh', pub = false } = cached;
    const totalPages       = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
    const { embed, slice } = buildEmbed(results, gameId, query, page, showStats, lang);
    await interaction.update({
      embeds:     [embed],
      components: pageComponents(slice, gameId, page, totalPages, cacheId, lang, pub),
    });
  },

  async handleSelectMenu(interaction) {
    const parts  = interaction.customId.split('|');
    const gameId = parts[1];
    const lang   = parts[2] ?? 'zh';
    const pub    = parts[3] === '1';
    const nameEn = interaction.values[0];
    const cfg    = GAME_CONFIGS[gameId];
    if (!cfg) { await interaction.reply({ content: '❌ Invalid game.', flags: 64 }); return; }

    const { results } = searchPokemon(nameEn, gameId);
    const poke = results.find(p => p.name_en === nameEn);

    if (!poke) {
      await interaction.reply({ content: `❌ ${nameEn} not found.`, flags: 64 });
      return;
    }

    const embed = buildDetailEmbed(poke, lang, COLOR);
    const s     = poke.stats ?? {};
    const bst   = Object.values(s).reduce((a, v) => a + (v || 0), 0);
    const flags = pub ? undefined : 64;

    try {
      const imgBuf = await buildStatImage(s, bst, lang);
      const file   = new AttachmentBuilder(imgBuf, { name: 'stats.png' });
      embed.setImage('attachment://stats.png');
      await interaction.reply({ embeds: [embed], files: [file], flags });
    } catch {
      await interaction.reply({ embeds: [embed], flags });
    }
  },
};
