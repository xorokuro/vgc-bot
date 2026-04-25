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
const { translateFromZh, translateType, LANG_CHOICES } = require('../utils/i18n');

const POKEDEX = require(path.join(__dirname, '../../data/pokedex_db.json'));

const ALL_TYPES = [
  'Normal','Fire','Water','Electric','Grass','Ice','Fighting','Poison',
  'Ground','Flying','Psychic','Bug','Rock','Ghost','Dragon','Dark','Steel','Fairy',
];

const GAME_CHOICES = [
  { name: '寶可夢朱/紫 (SV)', value: 'sv' },
  { name: 'Pokémon Champions', value: 'champ' },
];

const MAX_SHOWN = 20;

// Reverse lookup: any language type name (lower-case, suffix-stripped) → English key
const _typeRevMap = (() => {
  const m = {};
  for (const t of ALL_TYPES) {
    for (const lang of ['en', 'zh', 'ja']) {
      const name = translateType(t, lang);
      if (name) m[name.toLowerCase()] = t;
    }
  }
  return m;
})();

function resolveTypeKey(input) {
  if (!input) return null;
  const s = input.toLowerCase().replace(/系$|タイプ$|[\s-]type$/i, '').trim();
  return _typeRevMap[s] ?? null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pokeName(zh, lang) { return translateFromZh(zh, 'pokemon', lang); }

function fmtLabel(format, lang) {
  const map = {
    zh: { doubles: '雙打', singles: '單打' },
    en: { doubles: 'Doubles', singles: 'Singles' },
    ja: { doubles: 'ダブル', singles: 'シングル' },
  };
  return (map[lang] ?? map.zh)[format === 'singles' ? 'singles' : 'doubles'];
}

function typeEmojis(types) {
  return types.map(t => {
    const key = t.charAt(0).toUpperCase() + t.slice(1);
    return TYPE_EMOJI[key] ?? '';
  }).filter(Boolean).join('');
}

// ── Labels ────────────────────────────────────────────────────────────────────

const LBL = {
  zh: {
    noResults:           (t) => `❌ 本賽季資料中沒有找到${t}屬性的寶可夢。`,
    notFound:            (t) => `❌ 找不到屬性「${t}」。請透過自動補全選擇。`,
    notFoundSeason:      (s, f) => `❌ 找不到賽季 ${s} 的${f}資料。`,
    notFoundSeasonChamp: (s) => `❌ 找不到 Champions M-${s.slice(1)} 的資料。`,
    footer:              (s, f, count, typeLabel, game, page, totalPages) => {
      const fmt = fmtLabel(f, 'zh');
      const pg  = totalPages > 1 ? ` · 第 ${page + 1}/${totalPages} 頁` : '';
      return game === 'champ'
        ? `Reg. ${getChampRegSet(s)} · M-${s.slice(1)} ${fmt} · ${count} 隻${typeLabel}系寶可夢${pg}`
        : `S${s} ${fmt} · ${count} 隻${typeLabel}系寶可夢${pg}`;
    },
  },
  en: {
    noResults:           (t) => `❌ No ${t}-type Pokémon found in this season's data.`,
    notFound:            (t) => `❌ Type "${t}" not found. Please select via autocomplete.`,
    notFoundSeason:      (s, f) => `❌ No data for Season ${s} ${f}.`,
    notFoundSeasonChamp: (s) => `❌ No Champions M-${s.slice(1)} data.`,
    footer:              (s, f, count, typeLabel, game, page, totalPages) => {
      const fmt = fmtLabel(f, 'en');
      const pg  = totalPages > 1 ? ` · Page ${page + 1}/${totalPages}` : '';
      return game === 'champ'
        ? `Reg. ${getChampRegSet(s)} · M-${s.slice(1)} ${fmt} · ${count} ${typeLabel}-type Pokémon${pg}`
        : `S${s} ${fmt} · ${count} ${typeLabel}-type Pokémon${pg}`;
    },
  },
  ja: {
    noResults:           (t) => `❌ 「${t}」タイプのポケモンがシーズンデータに見つかりません。`,
    notFound:            (t) => `❌ 「${t}」タイプが見つかりません。オートコンプリートで選択してください。`,
    notFoundSeason:      (s, f) => `❌ シーズン ${s} ${f} のデータが見つかりません。`,
    notFoundSeasonChamp: (s) => `❌ Champions M-${s.slice(1)} のデータが見つかりません。`,
    footer:              (s, f, count, typeLabel, game, page, totalPages) => {
      const fmt = fmtLabel(f, 'ja');
      const pg  = totalPages > 1 ? ` · ${page + 1}/${totalPages} ページ` : '';
      return game === 'champ'
        ? `Reg. ${getChampRegSet(s)} · M-${s.slice(1)} ${fmt} · ${count} 匹の${typeLabel}タイプ${pg}`
        : `S${s} ${fmt} · ${count} 匹の${typeLabel}タイプ${pg}`;
    },
  },
};

// ── Core search ───────────────────────────────────────────────────────────────

function findPokemonByType(data, typeKey) {
  const lowerType = typeKey.toLowerCase();
  const results = [];
  for (const [name, entry] of Object.entries(data)) {
    if (!entry?.rank) continue;
    const dex = POKEDEX[name];
    if (!dex?.types_en) continue;
    if (dex.types_en.includes(lowerType)) {
      results.push({ entry, types: dex.types_en });
    }
  }
  results.sort((a, b) => a.entry.rank - b.entry.rank);
  return results;
}

// ── Embed + components ────────────────────────────────────────────────────────

function buildEmbed(typeKey, results, season, format, lang, game, page) {
  const lbl        = LBL[lang] ?? LBL.zh;
  const emoji      = TYPE_EMOJI[typeKey] ?? '';
  const typeLabel  = translateType(typeKey, lang);
  const totalPages = Math.ceil(results.length / MAX_SHOWN);
  const start      = page * MAX_SHOWN;

  const title = `${emoji ? emoji + ' ' : ''}${typeLabel}`.slice(0, 256);

  const lines = [];
  for (let i = 0; i < Math.min(MAX_SHOWN, results.length - start); i++) {
    const { entry, types } = results[start + i];
    const pos  = String(start + i + 1).padStart(3, ' ');
    const poke = pokeName(entry.full_name, lang);
    const tier = entry.rank ? ` [#${entry.rank}]` : '';
    const star = entry.rank && entry.rank <= 50 ? '★ ' : '';
    lines.push(`\`${pos}.\` ${star}${poke}${tier} — ${typeEmojis(types)}`);
  }

  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(lines.join('\n'))
    .setFooter({ text: lbl.footer(season, format, results.length, typeLabel, game, page, totalPages) })
    .setColor(0x4f86c6);
}

function buildComponents(page, totalPages, season, format, lang, game, typeKey) {
  if (totalPages <= 1) return [];
  const fmt  = format === 'singles' ? 's' : 'd';
  const g    = game === 'champ' ? 'c' : 'v';
  const base = `ts_page|PAGE|${season}|${fmt}|${lang}|${g}|${typeKey}`;

  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(base.replace('PAGE', page - 1))
      .setLabel('◀')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId('ts_noop')
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
    .setName('typesearch')
    .setDescription('查詢某屬性寶可夢的使用率排名 / Rank Pokémon of a given type by usage')
    .addStringOption(o => o
      .setName('type')
      .setDescription('屬性 (中/英/日) / Type (zh/en/ja) — e.g. 幽靈、Ghost、ゴースト')
      .setRequired(true)
      .setAutocomplete(true))
    .addStringOption(o => o
      .setName('game')
      .setDescription('遊戲版本 / Game version (預設：Champions)')
      .addChoices(...GAME_CHOICES))
    .addStringOption(o => o
      .setName('season')
      .setDescription('賽季 / Season (預設：最新)')
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
    const game      = interaction.options.getString('game') ?? 'champ';
    const seasonRaw = interaction.options.getString('season') ?? (game === 'champ' ? getLatestChampionSeason() : String(getLatestSeason()));
    const typeInput = interaction.options.getString('type');
    const format    = interaction.options.getString('format') ?? 'doubles';
    const lang      = interaction.options.getString('lang') ?? 'zh';
    const lbl       = LBL[lang] ?? LBL.zh;

    const typeKey = resolveTypeKey(typeInput);
    if (!typeKey) {
      await interaction.reply({ content: lbl.notFound(typeInput), flags: 64 });
      return;
    }

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

    const results = findPokemonByType(data, typeKey);
    if (results.length === 0) {
      await interaction.reply({ content: lbl.noResults(translateType(typeKey, lang)), flags: 64 });
      return;
    }

    const totalPages = Math.ceil(results.length / MAX_SHOWN);
    await interaction.deferReply({ flags: 64 });
    await interaction.deleteReply();
    await interaction.channel.send({
      embeds:     [buildEmbed(typeKey, results, season, format, lang, game, 0)],
      components: buildComponents(0, totalPages, season, format, lang, game, typeKey),
    });
  },

  async handleButton(interaction) {
    const parts   = interaction.customId.split('|');
    const page    = parseInt(parts[1], 10);
    const season  = parts[2];
    const format  = parts[3] === 's' ? 'singles' : 'doubles';
    const lang    = parts[4];
    const game    = parts[5] === 'c' ? 'champ' : 'sv';
    const typeKey = parts[6];

    const data = game === 'champ'
      ? loadChampionData(season, format)
      : loadSeasonData(parseInt(season, 10), format);

    if (!data) { await interaction.reply({ content: '❌', flags: 64 }); return; }

    const results    = findPokemonByType(data, typeKey);
    const totalPages = Math.ceil(results.length / MAX_SHOWN);
    const safePage   = Math.max(0, Math.min(page, totalPages - 1));
    const s          = game === 'champ' ? season : parseInt(season, 10);

    await interaction.update({
      embeds:     [buildEmbed(typeKey, results, s, format, lang, game, safePage)],
      components: buildComponents(safePage, totalPages, s, format, lang, game, typeKey),
    });
  },

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    const game    = interaction.options.getString('game') ?? 'champ';
    const lang    = interaction.options.getString('lang') ?? 'zh';

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

    if (focused.name === 'type') {
      const q = focused.value.toLowerCase().replace(/系$|タイプ$|[\s-]type$/i, '').trim();
      const list = ALL_TYPES.map(t => {
        const zh = translateType(t, 'zh');
        const en = translateType(t, 'en');
        const ja = translateType(t, 'ja');
        const label = `${zh} / ${en}`.slice(0, 100);
        return { label, value: t, searchKey: `${zh} ${en.toLowerCase()} ${ja.toLowerCase()} ${t.toLowerCase()}` };
      });
      const filtered = q ? list.filter(m => m.searchKey.includes(q)) : list;
      await interaction.respond(filtered.slice(0, 25).map(m => ({ name: m.label, value: m.value })));
    }
  },
};
