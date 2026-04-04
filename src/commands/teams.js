'use strict';

/**
 * /teams  — Browse Pokémon VGC team articles from pokedb.tokyo
 *
 * Main view:  5 teams per embed (text list) with navigation buttons + jump modal.
 * Preview:    Select a team from the dropdown → image reply (ephemeral or public).
 *
 * Button ID:  tms|{gameId}|{f}|{sp}|{dp}|{pub}    (f=d/s, pub=0/1)
 *             tms|{gameId}|{f}|{sp}|{dp}|{pub}|p  (page-skip variant)
 * Jump:       tms_jump|{gameId}|{f}|{totalSitePages}|{pub}
 * Jump modal: tms_jump_modal|{gameId}|{f}|{totalSitePages}|{pub}
 * Preview:    tms_preview|{gameId}|{f}|{sp}|{dp}|{pub}
 */

const {
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, AttachmentBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const { fetchTeamPage, SITE_CONFIGS, cfgLabel, fmtLabel } = require('../utils/teamScraper');
const { buildTeamImage, buildTeamsListImage }              = require('../utils/teamImage');
const { translateByDexClass, translateItemByJa,
        translateTeraType, LANG_CHOICES }                 = require('../utils/i18n');

const TEAMS_PER_VIEW = 5;
const FMT_CODE = { doubles: 'd', singles: 's' };

// Derive a PS HOME sprite URL from a dexClass string ("dex-NNNN-FF")
// without fetching — good enough for embed thumbnails.
function dexSpriteUrl(dexClass) {
  const m = (dexClass ?? '').match(/dex-(\d+)-(\d+)/);
  if (!m) return null;
  const num    = parseInt(m[1], 10);
  const form   = m[2].padStart(2, '0');
  const numPad = m[1].padStart(4, '0');
  if (form === '00') return `https://play.pokemonshowdown.com/sprites/home/${num}.png`;
  // Non-base forms: use Pokémon HOME CDN (preserves correct form)
  return `https://resource.pokemon-home.com/battledata/img/pokei128/poke_icon_${numPad}_${form}_n_00000000_f_n.png`;
}

function rankBadge(rank) {
  if (rank === 1)  return '🥇';
  if (rank === 2)  return '🥈';
  if (rank === 3)  return '🥉';
  if (rank != null && rank <= 10) return '🏅';
  return '📋';
}
const CODE_FMT = { d: 'doubles', s: 'singles' };
const VALID_LANGS = new Set(['zh', 'en', 'ja']);

// Season list for SV (value = season number, reg = regulation letter)
// Source: sv.pokedb.tokyo season_start select options
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
// Pre-built autocomplete entries (most recent first, max 25 shown by default)
const SEASON_AC = SV_SEASONS.slice().reverse().map(s => ({
  name:  `S${s.n} · Reg.${s.reg}`,
  value: String(s.n),
}));

// Translate a member's Pokémon name; falls back to the original Japanese name.
function _pokeName(member, lang) {
  if (lang === 'ja') return member.name;
  return translateByDexClass(member.dexClass, lang) ?? member.name;
}
// Translate a member's held item; falls back to the original Japanese name.
function _itemName(member, lang) {
  if (!member.itemName) return '';
  if (lang === 'ja') return member.itemName;
  return translateItemByJa(member.itemName, lang);
}
// Translate a member's tera type; falls back to the original Japanese name.
function _teraName(member, lang) {
  if (!member.teraTypeName) return '';
  return translateTeraType(member.teraTypeName, lang);
}

// ── Text embed (list of TEAMS_PER_VIEW teams) ─────────────────────────────────
async function buildListEmbed(teams, totalCount, sitePage, totalSitePages, discPage, gameId, format, lang, season) {
  const cfg          = SITE_CONFIGS[gameId];
  const fmt          = cfg.formats[format];
  const totalDisc    = Math.ceil(teams.length / TEAMS_PER_VIEW);
  const dp           = Math.min(discPage, Math.max(0, totalDisc - 1));
  const slice        = teams.slice(dp * TEAMS_PER_VIEW, (dp + 1) * TEAMS_PER_VIEW);

  const seasonTag  = season ? ` S${season}` : '';
  const titleSuffix = lang === 'en' ? 'Team Articles' : lang === 'ja' ? 'チーム記事' : '隊伍分享文章';
  const embed = new EmbedBuilder()
    .setColor(cfg.color)
    .setTitle(`${cfgLabel(cfg, lang)} ${fmtLabel(fmt, lang)}${seasonTag} ${titleSuffix}`)
    .setURL(`${cfg.baseUrl}/article/search?rule=${fmt.rule}${season ? `&season_start=${season}&season_end=${season}` : ''}&page=${sitePage}#search-results`);

  // Thumbnail: lead Pokémon sprite of the top team on this page
  const topTeam = slice.find(t => t.members?.[0]?.dexClass);
  if (topTeam) {
    const url = dexSpriteUrl(topTeam.members[0].dexClass);
    if (url) embed.setThumbnail(url);
  }

  const fields = slice.map((t, i) => {
    const badge     = rankBadge(t.rank);
    const rankStr   = t.rank != null ? `#${t.rank}` : '—';
    const ratingStr = t.rating ? `⭐ ${t.rating}` : '';
    const regStr    = t.regulation ? `Reg.${t.regulation}` : '';
    const metaLine  = [t.season, regStr, ratingStr].filter(Boolean).join('  ·  ');

    // Field name: row number + badge + rank + player name
    const fieldName = `${i + 1}. ${badge} ${rankStr}  ${t.player || '—'}`.slice(0, 256);

    // Article link only — Pokémon names visible in sprite image below
    const linkLine = t.articleUrl
      ? `[${(t.articleTitle || '記事を読む').slice(0, 180)}](${t.articleUrl})`
      : t.articleTitle || '';

    return {
      name:  fieldName,
      value: [metaLine, linkLine].filter(Boolean).join('\n').slice(0, 1024) || '—',
      inline: false,
    };
  });

  if (fields.length) embed.addFields(fields);
  else embed.setDescription(lang === 'en' ? 'No teams on this page.' : lang === 'ja' ? 'このページにはチームがありません。' : '此頁沒有隊伍。');

  const footerPage  = lang === 'en' ? `Page ${sitePage}/${totalSitePages}` : lang === 'ja' ? `ページ ${sitePage}/${totalSitePages}` : `第 ${sitePage}/${totalSitePages} 頁`;
  const footerGroup = lang === 'en' ? `Group ${dp + 1}/${totalDisc}` : lang === 'ja' ? `グループ ${dp + 1}/${totalDisc}` : `組 ${dp + 1}/${totalDisc}`;
  const footerTotal = lang === 'en' ? `${totalCount} articles` : lang === 'ja' ? `計 ${totalCount} 件` : `共 ${totalCount} 篇`;
  embed.setFooter({ text: `${footerPage}  ·  ${footerGroup}  ·  ${footerTotal}` });

  // Generate sprite grid image (5 rows numbered to match fields above)
  let imgBuf = null;
  if (slice.length && slice.some(t => t.members?.length)) {
    try {
      imgBuf = await buildTeamsListImage(slice.map(t => t.members || []));
      embed.setImage('attachment://teams_list.png');
    } catch (e) {
      console.warn('[teams list image]', e.message);
    }
  }

  return { embed, discPage: dp, totalDiscPages: totalDisc, slice, imgBuf };
}

// ── Navigation row (◀◀  ◀  ▶  ▶▶  跳頁) ─────────────────────────────────────
function buildNavRow(gameId, format, sitePage, totalSitePages, discPage, totalDiscPages, pub, lang, season) {
  const f    = FMT_CODE[format];
  const p    = pub ? '1' : '0';
  const s    = season || 0;
  const id   = (sp, dp)      => `tms|${gameId}|${f}|${sp}|${dp}|${p}|${lang}|${s}`;
  const idPP = (sp, dp, dir) => `tms|${gameId}|${f}|${sp}|${dp}|${p}|${lang}|${s}|p${dir}`;

  const atFirst = discPage === 0 && sitePage <= 1;
  const atLast  = discPage >= totalDiscPages - 1 && sitePage >= totalSitePages;

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(idPP(Math.max(1, sitePage - 1), 0, 0))
      .setLabel(lang === 'en' ? '◀◀ Prev' : lang === 'ja' ? '◀◀ 前頁' : '◀◀ 前頁')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(sitePage <= 1),
    new ButtonBuilder()
      .setCustomId(
        discPage > 0 ? id(sitePage, discPage - 1) : id(Math.max(1, sitePage - 1), 99),
      )
      .setLabel(lang === 'en' ? '◀ Prev' : lang === 'ja' ? '◀ 前グループ' : '◀ 上組')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(atFirst),
    new ButtonBuilder()
      .setCustomId(
        discPage < totalDiscPages - 1
          ? id(sitePage, discPage + 1)
          : id(Math.min(totalSitePages, sitePage + 1), 0),
      )
      .setLabel(lang === 'en' ? 'Next ▶' : lang === 'ja' ? '次グループ ▶' : '下組 ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(atLast),
    new ButtonBuilder()
      .setCustomId(idPP(Math.min(totalSitePages, sitePage + 1), 0, 1))
      .setLabel(lang === 'en' ? 'Next ▶▶' : lang === 'ja' ? '次頁 ▶▶' : '後頁 ▶▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(sitePage >= totalSitePages),
    new ButtonBuilder()
      .setCustomId(`tms_jump|${gameId}|${f}|${totalSitePages}|${p}|${lang}|${s}`)
      .setLabel(lang === 'en' ? 'Go to Page' : lang === 'ja' ? 'ページ移動' : '跳頁')
      .setStyle(ButtonStyle.Primary),
  );
}

// ── Preview select menu ───────────────────────────────────────────────────────
function buildPreviewMenu(slice, gameId, format, sitePage, discPage, pub, lang, season) {
  const f       = FMT_CODE[format];
  const p       = pub ? '1' : '0';
  const s       = season || 0;
  const options = slice.map((t, i) => {
    const rank   = t.rank != null ? `#${t.rank} ` : '';
    const label  = `${rank}${t.player || '—'} | ${t.season} Reg.${t.regulation}`.slice(0, 100);
    return { label, value: String(i) };
  });
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`tms_preview|${gameId}|${f}|${sitePage}|${discPage}|${p}|${lang}|${s}`)
      .setPlaceholder(lang === 'en' ? '👁 Preview a team' : lang === 'ja' ? '👁 チームをプレビュー' : '👁 查看隊伍預覽')
      .addOptions(options),
  );
}

// ── Shared render logic ───────────────────────────────────────────────────────
async function renderPage(gameId, format, sitePage, discPage, pub, lang, season) {
  const { teams, totalCount, totalPages: totalSitePages } =
    await fetchTeamPage(gameId, format, sitePage, season);

  const { embed, discPage: dp, totalDiscPages, slice, imgBuf } =
    await buildListEmbed(teams, totalCount, sitePage, totalSitePages, discPage, gameId, format, lang, season);

  const navRow     = buildNavRow(gameId, format, sitePage, totalSitePages, dp, totalDiscPages, pub, lang, season);
  const previewRow = buildPreviewMenu(slice, gameId, format, sitePage, dp, pub, lang, season);

  const payload = { embeds: [embed], components: [navRow, previewRow] };
  if (imgBuf) payload.files = [new AttachmentBuilder(imgBuf, { name: 'teams_list.png' })];
  return payload;
}

// ── Command definition ────────────────────────────────────────────────────────
module.exports = {
  data: new SlashCommandBuilder()
    .setName('teams')
    .setDescription('瀏覽寶可夢對戰隊伍分享文章')
    .addStringOption(o => o
      .setName('game')
      .setDescription('遊戲版本（預設：朱紫）')
      .addChoices(
        { name: '朱紫 (Scarlet/Violet)', value: 'sv' },
      ))
    .addStringOption(o => o
      .setName('format')
      .setDescription('賽制（預設：雙打）')
      .addChoices(
        { name: '雙打 (Doubles)', value: 'doubles' },
        { name: '單打 (Singles)', value: 'singles' },
      ))
    .addStringOption(o => o
      .setName('season')
      .setDescription('篩選賽季 / Filter by season (e.g. S40, or type "Reg.I" to see all Reg.I seasons)')
      .setAutocomplete(true))
    .addIntegerOption(o => o
      .setName('page')
      .setDescription('從第幾頁開始（預設：1）')
      .setMinValue(1))
    .addBooleanOption(o => o
      .setName('public')
      .setDescription('公開顯示結果給所有人（預設：僅自己可見）/ Show results publicly (default: only you)'))
    .addStringOption(o => o
      .setName('lang')
      .setDescription('寶可夢和道具名稱的語言（預設：繁體中文）/ Language for Pokémon & item names (default: 繁體中文)')
      .addChoices(
        { name: '繁體中文', value: 'zh' },
        { name: 'English',  value: 'en' },
        { name: '日本語',   value: 'ja' },
      )),

  async execute(interaction) {
    const gameId   = interaction.options.getString('game')    ?? 'sv';
    const format   = interaction.options.getString('format')  ?? 'doubles';
    const season   = parseInt(interaction.options.getString('season') ?? '0', 10) || 0;
    const sitePage = interaction.options.getInteger('page')   ?? 1;
    const pub      = interaction.options.getBoolean('public') ?? false;
    const lang     = interaction.options.getString('lang')    ?? 'zh';

    const cfg = SITE_CONFIGS[gameId];
    const fmt = cfg?.formats[format];
    if (!cfg || !fmt) {
      await interaction.reply({ content: '❌ Invalid game or format.', flags: 64 });
      return;
    }
    if (!fmt.available) {
      const unavail = lang === 'en' ? `❌ ${cfgLabel(cfg, lang)} ${fmtLabel(fmt, lang)} is not yet available.`
                    : lang === 'ja' ? `❌ ${cfgLabel(cfg, lang)} ${fmtLabel(fmt, lang)} はまだ利用できません。`
                    :                 `❌ ${cfgLabel(cfg, lang)} ${fmtLabel(fmt, lang)} 尚未開放，請稍後再試。`;
      await interaction.reply({ content: unavail, flags: 64 });
      return;
    }

    await interaction.deferReply(pub ? {} : { flags: 64 });
    try {
      await interaction.editReply(await renderPage(gameId, format, sitePage, 0, pub, lang, season));
    } catch (err) {
      console.error('[teams]', err);
      await interaction.editReply({ content: `❌ 無法載入隊伍資料：${err.message}` });
    }
  },

  // ── Autocomplete: season option ──────────────────────────────────────────────
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().trim().toLowerCase();
    let results;
    if (!focused) {
      // Default: show most recent 25 seasons
      results = SEASON_AC.slice(0, 25);
    } else {
      // Match season number (e.g. "40", "4") OR regulation letter (e.g. "I", "reg.i", "regi")
      const regQuery = focused.replace(/^reg\.?/i, '').toUpperCase();
      results = SEASON_AC.filter(s =>
        s.value.startsWith(focused.replace(/\D/g, '')) ||   // numeric prefix match
        s.name.toLowerCase().includes(focused)           ||   // general substring match
        s.name.includes(`Reg.${regQuery}`)                    // regulation match
      ).slice(0, 25);
    }
    await interaction.respond(results);
  },

  // ── tms| nav button ───────────────────────────────────────────────────────────
  async handleButton(interaction) {
    const parts     = interaction.customId.split('|');
    const gameId    = parts[1];
    const fmtCode   = parts[2];
    const sitePage  = parseInt(parts[3], 10);
    const discPage  = parseInt(parts[4], 10);
    const pub       = parts[5] === '1';
    const lang      = VALID_LANGS.has(parts[6]) ? parts[6] : 'zh';
    const season    = parseInt(parts[7], 10) || 0;
    const format    = CODE_FMT[fmtCode] ?? 'doubles';

    await interaction.deferUpdate();
    try {
      await interaction.editReply(await renderPage(gameId, format, sitePage, discPage, pub, lang, season));
    } catch (err) {
      console.error('[teams btn]', err);
      await interaction.followUp({ content: `❌ ${err.message}`, flags: 64 });
    }
  },

  // ── tms_jump| → show modal ────────────────────────────────────────────────────
  async handleJumpButton(interaction) {
    const parts   = interaction.customId.split('|');
    const gameId  = parts[1];
    const fmtCode = parts[2];
    const total   = parseInt(parts[3], 10);
    const pub     = parts[4] ?? '0';
    const lang    = VALID_LANGS.has(parts[5]) ? parts[5] : 'zh';
    const season  = parseInt(parts[6], 10) || 0;

    const modal = new ModalBuilder()
      .setCustomId(`tms_jump_modal|${gameId}|${fmtCode}|${total}|${pub}|${lang}|${season}`)
      .setTitle('跳頁 / Go to page');
    const input = new TextInputBuilder()
      .setCustomId('tms_page_num')
      .setLabel(`頁碼 (1–${total})`)
      .setStyle(TextInputStyle.Short)
      .setPlaceholder(`1–${total}`)
      .setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
  },

  // ── tms_jump_modal| submit ────────────────────────────────────────────────────
  async handleJumpModal(interaction) {
    const parts   = interaction.customId.split('|');
    const gameId  = parts[1];
    const fmtCode = parts[2];
    const total   = parseInt(parts[3], 10);
    const pub     = parts[4] === '1';
    const lang    = VALID_LANGS.has(parts[5]) ? parts[5] : 'zh';
    const season  = parseInt(parts[6], 10) || 0;
    const format  = CODE_FMT[fmtCode] ?? 'doubles';
    const raw     = interaction.fields.getTextInputValue('tms_page_num').trim();
    const page    = parseInt(raw, 10);

    if (isNaN(page) || page < 1 || page > total) {
      await interaction.reply({ content: `❌ 請輸入 1–${total} 之間的頁碼。`, flags: 64 });
      return;
    }

    await interaction.deferUpdate();
    try {
      await interaction.editReply(await renderPage(gameId, format, page, 0, pub, lang, season));
    } catch (err) {
      console.error('[teams jump]', err);
      await interaction.followUp({ content: `❌ ${err.message}`, flags: 64 });
    }
  },

  // ── tms_preview| select menu → image reply ───────────────────────────────────
  async handlePreview(interaction) {
    const parts     = interaction.customId.split('|');
    const gameId    = parts[1];
    const fmtCode   = parts[2];
    const sitePage  = parseInt(parts[3], 10);
    const discPage  = parseInt(parts[4], 10);
    const pub       = parts[5] === '1';
    const lang      = VALID_LANGS.has(parts[6]) ? parts[6] : 'zh';
    const season    = parseInt(parts[7], 10) || 0;
    const format    = CODE_FMT[fmtCode] ?? 'doubles';
    const offset    = parseInt(interaction.values[0], 10);
    const teamIdx   = discPage * TEAMS_PER_VIEW + offset;

    await interaction.deferReply(pub ? {} : { flags: 64 });

    try {
      const { teams } = await fetchTeamPage(gameId, format, sitePage, season);
      const team = teams[teamIdx];
      if (!team) {
        await interaction.editReply({ content: '❌ 找不到該隊伍。' });
        return;
      }

      // Generate sprite image
      const imgBuf = await buildTeamImage(team.members);
      const attach = new AttachmentBuilder(imgBuf, { name: 'team.png' });

      // Build preview embed
      const cfg = SITE_CONFIGS[gameId];
      const rankStr   = team.rank   != null ? `#${team.rank}` : '—';
      const ratingStr = team.rating ? ` · ⭐${team.rating}` : '';
      const metaStr   = `${team.season} Reg.${team.regulation}${ratingStr}`;

      const embed = new EmbedBuilder()
        .setColor(cfg.color)
        .setTitle(`${rankStr} ${team.player}`)
        .setDescription(metaStr)
        .setImage('attachment://team.png');

      // Pokemon + item list (translated)
      const teraLabel  = lang === 'en' ? 'Tera' : lang === 'ja' ? 'テラ' : '太晶';
      const teamLabel  = lang === 'en' ? 'Team' : lang === 'ja' ? 'チーム' : '隊伍';
      const lines = team.members.map((m, i) => {
        const pokeName = _pokeName(m, lang);
        const itemStr  = m.itemName  ? ` @ ${_itemName(m, lang)}`                        : '';
        const teraStr  = m.teraTypeName ? ` [${teraLabel}: ${_teraName(m, lang)}]`       : '';
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

      await interaction.editReply({ embeds: [embed], files: [attach] });
    } catch (err) {
      console.error('[teams preview]', err);
      await interaction.editReply({ content: `❌ 圖片生成失敗：${err.message}` });
    }
  },
};
