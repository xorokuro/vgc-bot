'use strict';

const {
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const path = require('path');
const {
  getAvailableSeasons, getLatestSeason, loadSeasonData,
  getChampionSeasons, getLatestChampionSeason, loadChampionData,
  getChampRegSet,
} = require('../utils/usageData');
const { TYPE_EMOJI } = require('../utils/buildEmbed');
const { translateFromZh, LANG_CHOICES } = require('../utils/i18n');

const MOVES_DB  = require(path.join(__dirname, '../../data/moves_db.json'));
const MOVES_SVD = require(path.join(__dirname, '../../data/moves_sv_detailed.json'));

const GAME_CHOICES = [
  { name: '寶可夢朱/紫 (SV)', value: 'sv' },
  { name: 'Pokémon Champions', value: 'champ' },
];

const MAX_SHOWN = 20;

// ── Helpers ───────────────────────────────────────────────────────────────────

function moveTypeEmoji(zhMoveName) {
  const entry = MOVES_DB[zhMoveName];
  if (!entry?.type || entry.type === 'unknown') return '';
  const en = entry.type.charAt(0).toUpperCase() + entry.type.slice(1);
  return TYPE_EMOJI[en] ?? '';
}

function moveName(zh, lang) { return translateFromZh(zh, 'move', lang); }
function pokeName(zh, lang) { return translateFromZh(zh, 'pokemon', lang); }

function fmtLabel(format, lang) {
  const map = {
    zh: { doubles: '雙打', singles: '單打' },
    en: { doubles: 'Doubles', singles: 'Singles' },
    ja: { doubles: 'ダブル', singles: 'シングル' },
  };
  return (map[lang] ?? map.zh)[format === 'singles' ? 'singles' : 'doubles'];
}

function getMoveSpec(zhMoveName, lang) {
  const dbEntry = MOVES_DB[zhMoveName];
  if (!dbEntry?.name_en) return null;
  const detail = MOVES_SVD[dbEntry.name_en.toLowerCase()];
  if (!detail) return null;
  const parts = [];
  if (detail.type)                                parts.push(detail.type[lang] ?? detail.type.en);
  if (detail.category)                            parts.push(detail.category[lang] ?? detail.category.en);
  if (detail.power    && detail.power    !== '—') parts.push(lang === 'en' ? `Pow ${detail.power}`    : `威力 ${detail.power}`);
  if (detail.accuracy && detail.accuracy !== '—') parts.push(lang === 'en' ? `Acc ${detail.accuracy}` : `命中 ${detail.accuracy}`);
  return parts.join(' · ') || null;
}

// ── Labels ────────────────────────────────────────────────────────────────────

const LBL = {
  zh: {
    noResults:          (n) => `❌ 本賽季資料中沒有寶可夢使用「${n}」。`,
    notFound:           (n) => `❌ 找不到招式「${n}」。請透過自動補全選擇。`,
    notFoundSeason:     (s, f) => `❌ 找不到賽季 ${s} 的${f}資料。`,
    notFoundSeasonChamp:(s) => `❌ 找不到 Champions M-${s.slice(1)} 的資料。`,
    footer:             (s, f, count, game, page, totalPages) => {
      const fmt = fmtLabel(f, 'zh');
      const pg  = totalPages > 1 ? ` · 第 ${page + 1}/${totalPages} 頁` : '';
      return game === 'champ'
        ? `Reg. ${getChampRegSet(s)} · M-${s.slice(1)} ${fmt} · ${count} 隻寶可夢使用此招式${pg}`
        : `S${s} ${fmt} · ${count} 隻寶可夢使用此招式${pg}`;
    },
  },
  en: {
    noResults:          (n) => `❌ No Pokémon found using "${n}" in this season.`,
    notFound:           (n) => `❌ Move "${n}" not found. Please select via autocomplete.`,
    notFoundSeason:     (s, f) => `❌ No data for Season ${s} ${f}.`,
    notFoundSeasonChamp:(s) => `❌ No Champions M-${s.slice(1)} data.`,
    footer:             (s, f, count, game, page, totalPages) => {
      const fmt = fmtLabel(f, 'en');
      const pg  = totalPages > 1 ? ` · Page ${page + 1}/${totalPages}` : '';
      return game === 'champ'
        ? `Reg. ${getChampRegSet(s)} · M-${s.slice(1)} ${fmt} · ${count} Pokémon use this move${pg}`
        : `S${s} ${fmt} · ${count} Pokémon use this move${pg}`;
    },
  },
  ja: {
    noResults:          (n) => `❌ 「${n}」を使うポケモンがシーズンデータに見つかりません。`,
    notFound:           (n) => `❌ 「${n}」が見つかりません。オートコンプリートで選択してください。`,
    notFoundSeason:     (s, f) => `❌ シーズン ${s} ${f} のデータが見つかりません。`,
    notFoundSeasonChamp:(s) => `❌ Champions M-${s.slice(1)} のデータが見つかりません。`,
    footer:             (s, f, count, game, page, totalPages) => {
      const fmt = fmtLabel(f, 'ja');
      const pg  = totalPages > 1 ? ` · ${page + 1}/${totalPages} ページ` : '';
      return game === 'champ'
        ? `Reg. ${getChampRegSet(s)} · M-${s.slice(1)} ${fmt} · ${count} 匹がこのわざを使用${pg}`
        : `S${s} ${fmt} · ${count} 匹がこのわざを使用${pg}`;
    },
  },
};

// ── Core search ───────────────────────────────────────────────────────────────

function findPokemonByMove(data, zhMoveName) {
  const results = [];
  for (const entry of Object.values(data)) {
    if (!entry?.moves) continue;
    const m = entry.moves.find(mv => mv.name === zhMoveName);
    if (m) results.push({ entry, moveUsage: parseFloat(m.usage_percent) });
  }
  results.sort((a, b) => b.moveUsage - a.moveUsage);
  return results;
}

// ── Autocomplete helpers ──────────────────────────────────────────────────────

function getMovesFromData(data) {
  const seen = new Set();
  for (const entry of Object.values(data)) {
    if (!entry?.moves) continue;
    for (const m of entry.moves) { if (m.name) seen.add(m.name); }
  }
  return [...seen];
}

// ── Embed + components ────────────────────────────────────────────────────────

function buildEmbed(zhMove, results, season, format, lang, game, page) {
  const lbl        = LBL[lang] ?? LBL.zh;
  const emoji      = moveTypeEmoji(zhMove);
  const mName      = moveName(zhMove, lang);
  const spec       = getMoveSpec(zhMove, lang);
  const totalPages = Math.ceil(results.length / MAX_SHOWN);
  const start      = page * MAX_SHOWN;

  const title = `${emoji ? emoji + ' ' : ''}${mName}`.slice(0, 256);

  const lines = [];
  if (spec && page === 0) lines.push(spec, '');

  const shown = results.slice(start, start + MAX_SHOWN);
  for (let i = 0; i < shown.length; i++) {
    const { entry, moveUsage } = shown[i];
    const pos  = String(start + i + 1).padStart(3, ' ');
    const poke = pokeName(entry.full_name, lang);
    const tier = entry.rank ? ` [#${entry.rank}]` : '';
    const star = entry.rank && entry.rank <= 50 ? '★ ' : '';
    lines.push(`\`${pos}.\` ${star}${poke}${tier} — **${moveUsage.toFixed(1)}%**`);
  }

  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(lines.join('\n'))
    .setFooter({ text: lbl.footer(season, format, results.length, game, page, totalPages) })
    .setColor(0x4f86c6);
}

function buildComponents(page, totalPages, season, format, lang, game, zhMove) {
  if (totalPages <= 1) return [];
  const fmt  = format === 'singles' ? 's' : 'd';
  const g    = game === 'champ' ? 'c' : 'v';
  const base = `ms_page|PAGE|${season}|${fmt}|${lang}|${g}|${zhMove}`;

  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(base.replace('PAGE', page - 1))
      .setLabel('◀')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId('ms_noop')
      .setLabel(`${page + 1} / ${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(base.replace('PAGE', page + 1))
      .setLabel('▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1),
  )];
}

// ── Command ───────────────────────────────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName('movesearch')
    .setDescription('查詢使用某招式最多的寶可夢排名 / Rank Pokémon by move usage frequency')
    .addStringOption(o => o
      .setName('game')
      .setDescription('遊戲版本 / Game version')
      .setRequired(true)
      .addChoices(...GAME_CHOICES))
    .addStringOption(o => o
      .setName('season')
      .setDescription('賽季 / Season')
      .setRequired(true)
      .setAutocomplete(true))
    .addStringOption(o => o
      .setName('move')
      .setDescription('招式名稱 (中/英/日) / Move name (zh/en/ja)')
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
    const game      = interaction.options.getString('game');
    const seasonRaw = interaction.options.getString('season');
    const zhMove    = interaction.options.getString('move');
    const format    = interaction.options.getString('format') ?? 'doubles';
    const lang      = interaction.options.getString('lang') ?? 'zh';
    const lbl       = LBL[lang] ?? LBL.zh;

    let data, season;
    if (game === 'champ') {
      season = seasonRaw;
      data   = loadChampionData(season, format);
      if (!data) {
        await interaction.reply({ content: lbl.notFoundSeasonChamp(season), flags: 64 });
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

    const results = findPokemonByMove(data, zhMove);
    if (results.length === 0) {
      await interaction.reply({ content: lbl.noResults(moveName(zhMove, lang)), flags: 64 });
      return;
    }

    const totalPages = Math.ceil(results.length / MAX_SHOWN);
    await interaction.deferReply({ flags: 64 });
    await interaction.deleteReply();
    await interaction.channel.send({
      embeds:     [buildEmbed(zhMove, results, season, format, lang, game, 0)],
      components: buildComponents(0, totalPages, season, format, lang, game, zhMove),
    });
  },

  async handleButton(interaction) {
    const parts  = interaction.customId.split('|');
    const page   = parseInt(parts[1], 10);
    const season = parts[2];
    const format = parts[3] === 's' ? 'singles' : 'doubles';
    const lang   = parts[4];
    const game   = parts[5] === 'c' ? 'champ' : 'sv';
    const zhMove = parts.slice(6).join('|');

    const data = game === 'champ'
      ? loadChampionData(season, format)
      : loadSeasonData(parseInt(season, 10), format);

    if (!data) { await interaction.reply({ content: '❌', flags: 64 }); return; }

    const results    = findPokemonByMove(data, zhMove);
    const totalPages = Math.ceil(results.length / MAX_SHOWN);
    const safePage   = Math.max(0, Math.min(page, totalPages - 1));

    await interaction.update({
      embeds:     [buildEmbed(zhMove, results, game === 'champ' ? season : parseInt(season, 10), format, lang, game, safePage)],
      components: buildComponents(safePage, totalPages, game === 'champ' ? season : parseInt(season, 10), format, lang, game, zhMove),
    });
  },

  async autocomplete(interaction) {
    const focused   = interaction.options.getFocused(true);
    const game      = interaction.options.getString('game') ?? 'sv';
    const format    = interaction.options.getString('format') ?? 'doubles';
    const seasonRaw = interaction.options.getString('season');
    const lang      = interaction.options.getString('lang') ?? 'zh';

    if (focused.name === 'season') {
      const q = focused.value.trim().toLowerCase();
      if (game === 'champ') {
        const seasons  = getChampionSeasons().slice().reverse();
        const latest   = getLatestChampionSeason();
        const filtered = q ? seasons.filter(s => s.startsWith(q)) : seasons;
        const label    = lang === 'en'
          ? s => `Reg. ${getChampRegSet(s)} · Season M-${s.slice(1)}${s === latest ? ' (Latest)' : ''}`
          : lang === 'ja'
          ? s => `Reg. ${getChampRegSet(s)} · シーズン M-${s.slice(1)}${s === latest ? ' (最新)' : ''}`
          : s => `Reg. ${getChampRegSet(s)} · 賽季 M-${s.slice(1)}${s === latest ? ' (最新)' : ''}`;
        await interaction.respond(filtered.slice(0, 25).map(s => ({ name: label(s), value: s })));
      } else {
        const latest   = getLatestSeason();
        const seasons  = getAvailableSeasons().slice().reverse();
        const filtered = q ? seasons.filter(s => String(s).startsWith(q)) : seasons;
        const label    = lang === 'en'
          ? s => `Season ${s}${s === latest ? ' (Latest)' : ''}`
          : lang === 'ja'
          ? s => `シーズン ${s}${s === latest ? ' (最新)' : ''}`
          : s => `賽季 ${s}${s === latest ? ' (最新)' : ''}`;
        await interaction.respond(filtered.slice(0, 25).map(s => ({ name: label(s), value: String(s) })));
      }
      return;
    }

    if (focused.name === 'move') {
      const q = focused.value.toLowerCase();

      let zhMoves;
      if (seasonRaw) {
        const d = game === 'champ'
          ? loadChampionData(seasonRaw, format)
          : loadSeasonData(parseInt(seasonRaw, 10), format);
        if (d) zhMoves = getMovesFromData(d);
      }
      if (!zhMoves) zhMoves = Object.keys(MOVES_DB);

      const list = zhMoves.map(zh => {
        let en = translateFromZh(zh, 'move', 'en');
        let ja = translateFromZh(zh, 'move', 'ja');
        // Fallback: some game-data zh names differ from the official Traditional Chinese,
        // so the reverse map has no hit — use moves_db English name instead.
        if (en === zh && MOVES_DB[zh]?.name_en) en = MOVES_DB[zh].name_en;
        if (ja === zh && MOVES_DB[zh]?.name_en) ja = MOVES_DB[zh].name_en;
        const label = (en !== zh ? `${en} / ${zh}` : zh).slice(0, 100);
        return { label, value: zh, searchKey: `${zh} ${en.toLowerCase()} ${ja.toLowerCase()}` };
      });

      const filtered = q ? list.filter(m => m.searchKey.toLowerCase().includes(q)) : list;
      await interaction.respond(filtered.slice(0, 25).map(m => ({ name: m.label, value: m.value })));
    }
  },
};
