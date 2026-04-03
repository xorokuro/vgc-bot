'use strict';

/**
 * /team_search — Search VGC team articles for teams containing specific Pokémon.
 *
 * Fetches BATCH_SIZE site pages in parallel and filters client-side.
 * Multi-form Pokémon (Ogerpon, Urshifu, Calyrex, …):
 *   Selecting the base name (e.g. "Ogerpon") matches any form.
 *   Selecting a specific form (e.g. "Ogerpon-Hearthflame") matches only that form.
 *
 * Button ID: tms_s|{gameId}|{fmt}|{batchStart}|{discPage}|{pub}|{lang}|{season}|{must}|{excl}
 * Preview:   tms_s_pre|{gameId}|{fmt}|{batchStart}|{discPage}|{pub}|{lang}|{season}|{must}|{excl}
 *
 * must/excl are comma-joined query values; excl is "_" when empty.
 */

const {
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, AttachmentBuilder,
} = require('discord.js');
const { fetchTeamPage, SITE_CONFIGS }                     = require('../utils/teamScraper');
const { buildTeamImage }                                   = require('../utils/teamImage');
const {
  translateByDexClass, translateItemByJa, translateTeraType,
  getPokemonSearchList, memberMatchesPokemonQuery,
}                                                          = require('../utils/i18n');

const BATCH_SIZE     = 5;    // site pages fetched per navigation step
const TEAMS_PER_VIEW = 5;
const FMT_CODE = { doubles: 'd', singles: 's' };
const CODE_FMT = { d: 'doubles', s: 'singles' };
const VALID_LANGS = new Set(['zh', 'en', 'ja']);

// ── Season list (mirrors teams.js) ────────────────────────────────────────────
const SV_SEASONS = [
  { n:  1, reg: 'A' }, { n:  2, reg: 'A' }, { n:  3, reg: 'B' }, { n:  4, reg: 'B' },
  { n:  5, reg: 'C' }, { n:  6, reg: 'C' }, { n:  7, reg: 'C' },
  { n:  8, reg: 'D' }, { n:  9, reg: 'D' }, { n: 10, reg: 'D+'},
  { n: 11, reg: 'E' }, { n: 12, reg: 'E' }, { n: 13, reg: 'E' },
  { n: 14, reg: 'F' }, { n: 15, reg: 'F' }, { n: 16, reg: 'F' }, { n: 17, reg: 'F' },
  { n: 18, reg: 'G' }, { n: 19, reg: 'G' }, { n: 20, reg: 'G' }, { n: 21, reg: 'G' },
  { n: 22, reg: 'H' }, { n: 23, reg: 'H' }, { n: 24, reg: 'H' }, { n: 25, reg: 'H' },
  { n: 26, reg: 'G' }, { n: 27, reg: 'G' }, { n: 28, reg: 'G' }, { n: 29, reg: 'G' },
  { n: 30, reg: 'I' }, { n: 31, reg: 'I' }, { n: 32, reg: 'I' }, { n: 33, reg: 'I' },
  { n: 34, reg: 'J' }, { n: 35, reg: 'J' }, { n: 36, reg: 'J' }, { n: 37, reg: 'J' },
  { n: 38, reg: 'I' }, { n: 39, reg: 'I' }, { n: 40, reg: 'I' }, { n: 41, reg: 'I' },
];
const SEASON_AC = SV_SEASONS.slice().reverse().map(s => ({
  name:  `S${s.n} · Reg.${s.reg}`,
  value: String(s.n),
}));

// ── Member display helpers ────────────────────────────────────────────────────
function _pokeName(member, lang) {
  if (lang === 'ja') return member.name;
  return translateByDexClass(member.dexClass, lang) ?? member.name;
}
function _itemName(member, lang) {
  if (!member.itemName) return '';
  if (lang === 'ja') return member.itemName;
  return translateItemByJa(member.itemName, lang);
}
function _teraName(member, lang) {
  if (!member.teraTypeName) return '';
  return translateTeraType(member.teraTypeName, lang);
}

// ── Query encoding / decoding ─────────────────────────────────────────────────
const encodeMust = queries => queries.join(',');
const encodeExcl = queries => queries.length ? queries.join(',') : '_';
const decodeMust = str     => str.split(',').filter(Boolean);
const decodeExcl = str     => str === '_' ? [] : str.split(',').filter(Boolean);

// ── Human-readable label for a query value ────────────────────────────────────
// Used in embed descriptions to show filter criteria in the right language.
let _queryLabelMap = null;
function queryToLabel(query, lang) {
  if (!_queryLabelMap) {
    _queryLabelMap = new Map(getPokemonSearchList().map(e => [e.value, e.label]));
  }
  const label = _queryLabelMap.get(query);
  if (!label) return query;
  const parts = label.split(' / ');
  return lang === 'zh' ? (parts[1] || parts[0]) : parts[0];
}

// ── Core batch-search ─────────────────────────────────────────────────────────
/**
 * Fetch BATCH_SIZE site pages starting at batchStart (in parallel),
 * then filter by must/exclude Pokémon queries.
 */
async function fetchFilteredBatch(gameId, format, batchStart, season, mustQueries, excludeQueries) {
  const pageNums = Array.from({ length: BATCH_SIZE }, (_, i) => batchStart + i);

  const results = await Promise.all(
    pageNums.map(p => fetchTeamPage(gameId, format, p, season).catch(() => null)),
  );

  const totalSitePages = results.find(r => r?.totalPages != null)?.totalPages
    ?? Math.max(batchStart - 1, 0);

  const allTeams = results.filter(r => r != null).flatMap(r => r.teams ?? []);

  const filtered = allTeams.filter(team => {
    const members = team.members ?? [];
    if (!mustQueries.every(q => members.some(m => memberMatchesPokemonQuery(m, q)))) return false;
    if (excludeQueries.some(q => members.some(m => memberMatchesPokemonQuery(m, q))))  return false;
    return true;
  });

  const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, totalSitePages);
  return { filtered, totalSitePages, batchEnd };
}

// ── Embed builder ─────────────────────────────────────────────────────────────
function buildSearchEmbed(
  filtered, batchStart, batchEnd, discPage, totalSitePages,
  gameId, format, lang, season, mustQueries, excludeQueries,
) {
  const cfg = SITE_CONFIGS[gameId];
  const fmt = cfg.formats[format];

  const totalDiscPages = Math.max(1, Math.ceil(filtered.length / TEAMS_PER_VIEW));
  const dp    = Math.min(discPage, totalDiscPages - 1);
  const slice = filtered.slice(dp * TEAMS_PER_VIEW, (dp + 1) * TEAMS_PER_VIEW);

  const seasonTag = season ? ` S${season}` : '';
  const mustLabel = mustQueries.map(q => queryToLabel(q, lang)).join(' + ');
  const exclLabel = excludeQueries.length
    ? `　排除：${excludeQueries.map(q => queryToLabel(q, lang)).join('、')}`
    : '';

  const embed = new EmbedBuilder()
    .setColor(cfg.color)
    .setTitle(`${cfg.labelZh} ${fmt.labelZh}${seasonTag} 隊伍搜索`)
    .setDescription(`包含：**${mustLabel}**${exclLabel}`);

  if (filtered.length === 0) {
    embed.addFields({
      name:  '找不到符合條件的隊伍',
      value: `網站頁 ${batchStart}–${batchEnd} 中沒有匹配的隊伍，請繼續翻頁搜索。`,
      inline: false,
    });
  } else {
    const fields = slice.map(t => {
      const rankStr   = t.rank   != null ? `#${t.rank}` : '—';
      const ratingStr = t.rating ? `⭐${t.rating}` : '';
      const metaStr   = [t.season, t.regulation ? `Reg.${t.regulation}` : '', ratingStr]
        .filter(Boolean).join(' · ');
      const fieldName = `${rankStr} ${t.player || '—'}  |  ${metaStr}`.slice(0, 256);
      const pokeList  = (t.members ?? []).length
        ? t.members.map(m => _pokeName(m, lang)).join('・')
        : (t.pokemon?.join('・') || '—');
      const linkLine  = t.articleUrl
        ? `[${(t.articleTitle || '記事を読む').slice(0, 180)}](${t.articleUrl})`
        : t.articleTitle || '';
      return {
        name:   fieldName,
        value:  [pokeList, linkLine].filter(Boolean).join('\n').slice(0, 1024) || '—',
        inline: false,
      };
    });
    embed.addFields(fields);
  }

  embed.setFooter({
    text: `網站頁 ${batchStart}–${batchEnd}/${totalSitePages}　·　找到 ${filtered.length} 支　·　組 ${dp + 1}/${totalDiscPages}`,
  });

  return { embed, discPage: dp, totalDiscPages, slice };
}

// ── Navigation row ────────────────────────────────────────────────────────────
function buildNavRow(
  gameId, format, batchStart, batchEnd, discPage, totalDiscPages, totalSitePages,
  pub, lang, season, mustStr, exclStr,
) {
  const f = FMT_CODE[format];
  const p = pub ? '1' : '0';
  const s = season || 0;
  const id = (bs, dp) =>
    `tms_s|${gameId}|${f}|${bs}|${dp}|${p}|${lang}|${s}|${mustStr}|${exclStr}`;

  const atStart = batchStart <= 1 && discPage === 0;
  const atEnd   = batchEnd >= totalSitePages && discPage >= totalDiscPages - 1;

  // Going backward: previous disc page, or the last disc page of the previous batch.
  const prevId = discPage > 0
    ? id(batchStart, discPage - 1)
    : id(Math.max(1, batchStart - BATCH_SIZE), 99); // 99 is clamped to last disc page on render

  // Going forward: next disc page, or the first disc page of the next batch.
  const nextId = discPage < totalDiscPages - 1
    ? id(batchStart, discPage + 1)
    : id(batchEnd + 1, 0);

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(prevId)
      .setLabel('◀ 上組')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(atStart),
    new ButtonBuilder()
      .setCustomId(nextId)
      .setLabel('下組 ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(atEnd),
  );
}

// ── Preview select menu ───────────────────────────────────────────────────────
function buildPreviewMenu(slice, gameId, format, batchStart, discPage, pub, lang, season, mustStr, exclStr) {
  if (!slice.length) return null;
  const f = FMT_CODE[format];
  const p = pub ? '1' : '0';
  const s = season || 0;
  const options = slice.map((t, i) => {
    const rank  = t.rank != null ? `#${t.rank} ` : '';
    const label = `${rank}${t.player || '—'} | ${t.season} Reg.${t.regulation}`.slice(0, 100);
    return { label, value: String(i) };
  });
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`tms_s_pre|${gameId}|${f}|${batchStart}|${discPage}|${p}|${lang}|${s}|${mustStr}|${exclStr}`)
      .setPlaceholder('👁 查看隊伍預覽 / Preview a team')
      .addOptions(options),
  );
}

// ── Shared render ─────────────────────────────────────────────────────────────
async function renderSearch(gameId, format, batchStart, discPage, pub, lang, season, mustQueries, excludeQueries) {
  const mustStr = encodeMust(mustQueries);
  const exclStr = encodeExcl(excludeQueries);

  const { filtered, totalSitePages, batchEnd } =
    await fetchFilteredBatch(gameId, format, batchStart, season, mustQueries, excludeQueries);

  const { embed, discPage: dp, totalDiscPages, slice } =
    buildSearchEmbed(
      filtered, batchStart, batchEnd, discPage, totalSitePages,
      gameId, format, lang, season, mustQueries, excludeQueries,
    );

  const navRow     = buildNavRow(
    gameId, format, batchStart, batchEnd, dp, totalDiscPages, totalSitePages,
    pub, lang, season, mustStr, exclStr,
  );
  const previewRow = buildPreviewMenu(slice, gameId, format, batchStart, dp, pub, lang, season, mustStr, exclStr);

  return { embeds: [embed], components: previewRow ? [navRow, previewRow] : [navRow] };
}

// ── Preview image helper (shared with handlePreview) ─────────────────────────
async function buildPreviewReply(team, gameId, lang, pub) {
  const imgBuf = await buildTeamImage(team.members);
  const attach = new AttachmentBuilder(imgBuf, { name: 'team.png' });

  const cfg = SITE_CONFIGS[gameId];
  const rankStr   = team.rank   != null ? `#${team.rank}` : '—';
  const ratingStr = team.rating ? ` · ⭐${team.rating}` : '';
  const metaStr   = `${team.season} Reg.${team.regulation}${ratingStr}`;

  const embed = new EmbedBuilder()
    .setColor(cfg.color)
    .setTitle(`${rankStr} ${team.player}`)
    .setDescription(metaStr)
    .setImage('attachment://team.png');

  const teraLabel  = lang === 'en' ? 'Tera'  : lang === 'ja' ? 'テラ' : '太晶';
  const teamLabel  = lang === 'en' ? 'Team'  : lang === 'ja' ? 'チーム' : '隊伍';
  const lines = team.members.map((m, i) => {
    const pokeName = _pokeName(m, lang);
    const itemStr  = m.itemName     ? ` @ ${_itemName(m, lang)}`               : '';
    const teraStr  = m.teraTypeName ? ` [${teraLabel}: ${_teraName(m, lang)}]` : '';
    return `**${i + 1}.** ${pokeName}${itemStr}${teraStr}`;
  });
  if (lines.length) embed.addFields({ name: teamLabel, value: lines.join('\n'), inline: false });

  if (team.articleUrl) {
    const articleLabel = lang === 'en' ? '📝 Article' : lang === 'ja' ? '📝 記事' : '📝 文章';
    const movesNote    = lang === 'en' ? 'Moves listed in the article'
                       : lang === 'ja' ? '技の詳細は記事を参照'
                       : '招式資訊請參閱文章';
    embed.addFields({
      name:  articleLabel,
      value: `[${(team.articleTitle || '記事を読む').slice(0, 200)}](${team.articleUrl})\n-# ${movesNote}`,
      inline: false,
    });
  }

  return { embeds: [embed], files: [attach] };
}

// ── Command definition ────────────────────────────────────────────────────────
module.exports = {
  data: new SlashCommandBuilder()
    .setName('team_search')
    .setDescription('搜索包含特定寶可夢的隊伍 / Search teams by Pokémon (include & exclude)')
    .addStringOption(o => o
      .setName('pokemon1')
      .setDescription('必須包含的寶可夢 / Pokémon that must be on the team')
      .setRequired(true)
      .setAutocomplete(true))
    .addStringOption(o => o
      .setName('pokemon2')
      .setDescription('也必須包含（AND） / Second Pokémon that must also be on the team')
      .setAutocomplete(true))
    .addStringOption(o => o
      .setName('pokemon3')
      .setDescription('也必須包含（AND） / Third Pokémon that must also be on the team')
      .setAutocomplete(true))
    .addStringOption(o => o
      .setName('exclude')
      .setDescription('排除含有此寶可夢的隊伍 / Exclude teams that contain this Pokémon')
      .setAutocomplete(true))
    .addStringOption(o => o
      .setName('game')
      .setDescription('遊戲版本（預設：朱紫）')
      .addChoices({ name: '朱紫 (Scarlet/Violet)', value: 'sv' }))
    .addStringOption(o => o
      .setName('format')
      .setDescription('賽制（預設：雙打）')
      .addChoices(
        { name: '雙打 (Doubles)', value: 'doubles' },
        { name: '單打 (Singles)', value: 'singles' },
      ))
    .addStringOption(o => o
      .setName('season')
      .setDescription('篩選賽季（例：S40 或 Reg.I）/ Filter by season')
      .setAutocomplete(true))
    .addBooleanOption(o => o
      .setName('public')
      .setDescription('公開顯示結果（預設：僅自己可見）/ Show results publicly'))
    .addStringOption(o => o
      .setName('lang')
      .setDescription('名稱語言（預設：繁體中文）/ Language for Pokémon names')
      .addChoices(
        { name: '繁體中文', value: 'zh' },
        { name: 'English',  value: 'en' },
        { name: '日本語',   value: 'ja' },
      )),

  // ── /team_search execute ───────────────────────────────────────────────────
  async execute(interaction) {
    const p1     = interaction.options.getString('pokemon1');
    const p2     = interaction.options.getString('pokemon2');
    const p3     = interaction.options.getString('pokemon3');
    const excl   = interaction.options.getString('exclude');
    const gameId = interaction.options.getString('game')    ?? 'sv';
    const format = interaction.options.getString('format')  ?? 'doubles';
    const season = parseInt(interaction.options.getString('season') ?? '0', 10) || 0;
    const pub    = interaction.options.getBoolean('public') ?? false;
    const lang   = interaction.options.getString('lang')    ?? 'zh';

    const cfg = SITE_CONFIGS[gameId];
    const fmt = cfg?.formats[format];
    if (!cfg || !fmt) {
      await interaction.reply({ content: '❌ 無效的遊戲或賽制。', flags: 64 });
      return;
    }
    if (!fmt.available) {
      await interaction.reply({ content: `❌ ${cfg.labelZh} ${fmt.labelZh} 尚未開放。`, flags: 64 });
      return;
    }

    const mustQueries    = [p1, p2, p3].filter(Boolean);
    const excludeQueries = excl ? [excl] : [];

    await interaction.deferReply(pub ? {} : { flags: 64 });
    try {
      await interaction.editReply(
        await renderSearch(gameId, format, 1, 0, pub, lang, season, mustQueries, excludeQueries),
      );
    } catch (err) {
      console.error('[team_search]', err);
      await interaction.editReply({ content: `❌ 搜索失敗：${err.message}` });
    }
  },

  // ── Autocomplete ───────────────────────────────────────────────────────────
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);

    if (['pokemon1', 'pokemon2', 'pokemon3', 'exclude'].includes(focused.name)) {
      const q    = focused.value.toLowerCase().trim();
      const list = getPokemonSearchList();

      let results;
      if (!q) {
        // No input: show first 25 entries (dex order 1–25)
        results = list.slice(0, 25);
      } else {
        const matched = list.filter(e => e.searchKey.includes(q));
        // Rank: entries whose label starts with the query come first.
        matched.sort((a, b) => {
          const aFirst = a.label.toLowerCase().startsWith(q) ? 0 : 1;
          const bFirst = b.label.toLowerCase().startsWith(q) ? 0 : 1;
          return aFirst - bFirst;
        });
        results = matched.slice(0, 25);
      }
      await interaction.respond(results.map(e => ({ name: e.label.slice(0, 100), value: e.value })));
      return;
    }

    if (focused.name === 'season') {
      const q        = interaction.options.getFocused().trim().toLowerCase();
      const regQuery = q.replace(/^reg\.?/i, '').toUpperCase();
      const results  = !q
        ? SEASON_AC.slice(0, 25)
        : SEASON_AC.filter(s =>
            s.value.startsWith(q.replace(/\D/g, '')) ||
            s.name.toLowerCase().includes(q)         ||
            s.name.includes(`Reg.${regQuery}`)
          ).slice(0, 25);
      await interaction.respond(results);
    }
  },

  // ── tms_s| navigation button ───────────────────────────────────────────────
  async handleButton(interaction) {
    const parts          = interaction.customId.split('|');
    const gameId         = parts[1];
    const fmtCode        = parts[2];
    const batchStart     = parseInt(parts[3], 10);
    const discPage       = parseInt(parts[4], 10);
    const pub            = parts[5] === '1';
    const lang           = VALID_LANGS.has(parts[6]) ? parts[6] : 'zh';
    const season         = parseInt(parts[7], 10) || 0;
    const mustStr        = parts[8] || '';
    const exclStr        = parts[9] || '_';
    const format         = CODE_FMT[fmtCode] ?? 'doubles';
    const mustQueries    = decodeMust(mustStr);
    const excludeQueries = decodeExcl(exclStr);

    await interaction.deferUpdate();
    try {
      await interaction.editReply(
        await renderSearch(gameId, format, batchStart, discPage, pub, lang, season, mustQueries, excludeQueries),
      );
    } catch (err) {
      console.error('[team_search btn]', err);
      await interaction.followUp({ content: `❌ ${err.message}`, flags: 64 });
    }
  },

  // ── tms_s_pre| select menu → image preview ────────────────────────────────
  async handlePreview(interaction) {
    const parts          = interaction.customId.split('|');
    const gameId         = parts[1];
    const fmtCode        = parts[2];
    const batchStart     = parseInt(parts[3], 10);
    const discPage       = parseInt(parts[4], 10);
    const pub            = parts[5] === '1';
    const lang           = VALID_LANGS.has(parts[6]) ? parts[6] : 'zh';
    const season         = parseInt(parts[7], 10) || 0;
    const mustStr        = parts[8] || '';
    const exclStr        = parts[9] || '_';
    const format         = CODE_FMT[fmtCode] ?? 'doubles';
    const mustQueries    = decodeMust(mustStr);
    const excludeQueries = decodeExcl(exclStr);
    const offset         = parseInt(interaction.values[0], 10);

    await interaction.deferReply(pub ? {} : { flags: 64 });
    try {
      const { filtered } =
        await fetchFilteredBatch(gameId, format, batchStart, season, mustQueries, excludeQueries);

      const totalDiscPages = Math.max(1, Math.ceil(filtered.length / TEAMS_PER_VIEW));
      const dp   = Math.min(discPage, totalDiscPages - 1);
      const team = filtered[dp * TEAMS_PER_VIEW + offset];

      if (!team) {
        await interaction.editReply({ content: '❌ 找不到該隊伍。' });
        return;
      }

      await interaction.editReply(await buildPreviewReply(team, gameId, lang, pub));
    } catch (err) {
      console.error('[team_search preview]', err);
      await interaction.editReply({ content: `❌ 圖片生成失敗：${err.message}` });
    }
  },
};
