'use strict';

const {
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
} = require('discord.js');
const path = require('path');
const {
  getAvailableSeasons, getLatestSeason, loadSeasonData,
  getSpriteUrl, findPokemon,
} = require('../utils/usageData');
const { TYPE_EMOJI } = require('../utils/buildEmbed');
const { getTypeWeaknesses } = require('../utils/pokeData');

// ── Static data ───────────────────────────────────────────────────────────────

const zhHant  = require(path.join(__dirname, '../../data/zh-Hant.json'));
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

// ── Format helpers ────────────────────────────────────────────────────────────

/** "• name\n(usage%)" × n, as shown in the original bot */
function fmtCol(arr, n, labelFn) {
  if (!arr?.length) return '—';
  return arr.slice(0, n).map(e => `${labelFn(e)}\n(${e.usage_percent}%)`).join('\n');
}

function fmtAbilities(arr, n = 3) {
  return fmtCol(arr, n, e => `• ${e.name}`);
}
function fmtItems(arr, n = 3) {
  return fmtCol(arr, n, e => `• ${e.name}`);
}
function fmtNatures(arr, n = 3) {
  return fmtCol(arr, n, e => `• ${e.name}`);
}
function fmtTera(arr, n = 3) {
  return fmtCol(arr, n, e => `${typeEmoji(e.name)} ${e.name}`);
}
function fmtMoves(arr, n = 3) {
  return fmtCol(arr, n, e => `${moveTypeEmoji(e.name)} ${e.name}`);
}

function fmtFullList(arr, labelFn) {
  if (!arr?.length) return '—';
  return arr.map((e, i) => `${i + 1}. ${labelFn(e)} **${e.usage_percent}%**`).join('\n');
}

function fmtNameList(arr, n = 5) {
  if (!arr?.length) return '—';
  return arr.slice(0, n).map((e, i) => `${i + 1}. ${e.full_name}`).join('\n');
}

function relativeTime(data) {
  if (!data?.last_updated) return '';
  return `資料更新於: <t:${data.last_updated}:R>`;
}

function footer(season, format) {
  return `S${season} ${format === 'singles' ? '單打' : '雙打'} · Pokémon HOME 使用率`;
}

// ── Embed builders ────────────────────────────────────────────────────────────

function buildOverviewEmbed(entry, season, format, data) {
  const fmt = format === 'singles' ? '單打' : '雙打';
  return new EmbedBuilder()
    .setColor(0xEE1515)
    .setTitle(`S${season} ${fmt} · ${entry.full_name} (排名 #${entry.rank})`)
    .setDescription(`資料來源為 Pokémon HOME 級別對戰。\n${relativeTime(data)}`)
    .setThumbnail(getSpriteUrl(entry))
    .setFooter({ text: footer(season, format) })
    .addFields(
      { name: '特性 (Top 3)',     value: fmtAbilities(entry.abilities,  3), inline: true },
      { name: '持有道具 (Top 3)', value: fmtItems(entry.held_items,     3), inline: true },
      { name: '性格 (Top 3)',     value: fmtNatures(entry.natures,      3), inline: true },
      { name: '太晶屬性 (Top 3)', value: fmtTera(entry.tera_types,      3), inline: true },
      { name: '常用招式 (Top 3)', value: fmtMoves(entry.moves,          3), inline: true },
      { name: '常用隊友 (Top 3)', value: fmtNameList(entry.teammates,   3), inline: true },
    );
}

function buildBuildsEmbed(entry, season, format, data) {
  const fmt = format === 'singles' ? '單打' : '雙打';
  return new EmbedBuilder()
    .setColor(0x4A90D9)
    .setTitle(`S${season} ${fmt} · ${entry.full_name} — 配置`)
    .setThumbnail(getSpriteUrl(entry))
    .setFooter({ text: footer(season, format) })
    .addFields(
      { name: '💎 特性',     value: fmtFullList(entry.abilities,  e => e.name),                   inline: true  },
      { name: '🌿 性格',     value: fmtFullList(entry.natures,    e => e.name),                   inline: true  },
      { name: '✨ 太晶屬性', value: fmtFullList(entry.tera_types, e => `${typeEmoji(e.name)} ${e.name}`), inline: true },
      { name: '🎒 持有道具', value: fmtFullList(entry.held_items, e => e.name),                   inline: false },
    );
}

function buildMovesEmbed(entry, season, format, data) {
  const fmt = format === 'singles' ? '單打' : '雙打';
  const fmtMoveList = (arr, n) =>
    !arr?.length ? '—' :
    arr.slice(0, n).map((e, i) =>
      `${i + 1}. ${moveTypeEmoji(e.name)} ${e.name} **${e.usage_percent}%**`,
    ).join('\n');

  return new EmbedBuilder()
    .setColor(0xEE9900)
    .setTitle(`S${season} ${fmt} · ${entry.full_name} — 招式`)
    .setThumbnail(getSpriteUrl(entry))
    .setFooter({ text: footer(season, format) })
    .addFields(
      { name: '🎯 常用招式 (Top 10)', value: fmtMoveList(entry.moves,      10), inline: false },
      { name: '✅ 勝利招式 (Top 5)',  value: fmtMoveList(entry.win_moves,   5),  inline: true  },
      { name: '❌ 落敗招式 (Top 5)',  value: fmtMoveList(entry.lose_moves,  5),  inline: true  },
    );
}

function buildMatchupsEmbed(entry, season, format, data) {
  const fmt = format === 'singles' ? '單打' : '雙打';
  return new EmbedBuilder()
    .setColor(0x57C87A)
    .setTitle(`S${season} ${fmt} · ${entry.full_name} — 對位`)
    .setThumbnail(getSpriteUrl(entry))
    .setFooter({ text: footer(season, format) })
    .addFields(
      { name: '🤝 常見隊友 (Top 5)',  value: fmtNameList(entry.teammates,         5), inline: true },
      { name: '🏆 較常獲勝 (Top 5)',  value: fmtNameList(entry.most_wins_against, 5), inline: true },
      { name: '💀 較常落敗 (Top 5)',  value: fmtNameList(entry.most_defeated_by,  5), inline: true },
    );
}

// ── Component builders ────────────────────────────────────────────────────────

const TABS = [
  { id: 'ov', label: '概覽' },
  { id: 'bd', label: '配置' },
  { id: 'mv', label: '招式' },
  { id: 'mt', label: '對位' },
];

function makeTabRow(activeTab, season, format, pokemonName) {
  const f = format === 'singles' ? 's' : 'd';
  return new ActionRowBuilder().addComponents(
    TABS.map(t => new ButtonBuilder()
      .setCustomId(`up|${t.id}|${season}|${f}|${pokemonName}`)
      .setLabel(t.label)
      .setStyle(t.id === activeTab ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(t.id === activeTab),
    ),
  );
}

function makeMoveSelectRow(entry, season, format) {
  const f = format === 'singles' ? 's' : 'd';
  const moves = (entry.moves ?? []).slice(0, 10);
  if (!moves.length) return null;
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`up_mv_sel|${season}|${f}|${entry.full_name}`)
    .setPlaceholder('查詢招式詳情...')
    .addOptions(moves.map(m => {
      const dbEntry = MOVES_DB[m.name];
      const enType  = dbEntry?.type ? dbEntry.type.charAt(0).toUpperCase() + dbEntry.type.slice(1) : null;
      const emoji   = enType ? parseEmojiObj(TYPE_EMOJI[enType]) : null;
      const opt = new StringSelectMenuOptionBuilder()
        .setLabel(`${m.name}  ${m.usage_percent}%`)
        .setValue(m.name);
      if (emoji) opt.setEmoji(emoji);
      return opt;
    }));
  return new ActionRowBuilder().addComponents(menu);
}

function makeAbilitySelectRow(entry, season, format) {
  const f = format === 'singles' ? 's' : 'd';
  const abilities = (entry.abilities ?? []).slice(0, 10);
  if (!abilities.length) return null;
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`up_ab_sel|${season}|${f}|${entry.full_name}`)
    .setPlaceholder('查詢特性詳情...')
    .addOptions(abilities.map(a =>
      new StringSelectMenuOptionBuilder()
        .setLabel(`${a.name}  ${a.usage_percent}%`)
        .setValue(a.name),
    ));
  return new ActionRowBuilder().addComponents(menu);
}

function makeTeraSelectRow(entry, season, format) {
  const f = format === 'singles' ? 's' : 'd';
  const teras = (entry.tera_types ?? []).slice(0, 10);
  if (!teras.length) return null;
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`up_tr_sel|${season}|${f}|${entry.full_name}`)
    .setPlaceholder('查詢太晶屬性相剋...')
    .addOptions(teras.map(t => {
      const emoji = parseEmojiObj(typeEmoji(t.name));
      const opt = new StringSelectMenuOptionBuilder()
        .setLabel(`${t.name}  ${t.usage_percent}%`)
        .setValue(t.name);
      if (emoji) opt.setEmoji(emoji);
      return opt;
    }));
  return new ActionRowBuilder().addComponents(menu);
}

function buildComponents(activeTab, entry, season, format) {
  const rows = [makeTabRow(activeTab, season, format, entry.full_name)];
  const moveRow  = makeMoveSelectRow(entry, season, format);
  const abilRow  = makeAbilitySelectRow(entry, season, format);
  const teraRow  = makeTeraSelectRow(entry, season, format);
  if (moveRow)  rows.push(moveRow);
  if (abilRow)  rows.push(abilRow);
  if (teraRow)  rows.push(teraRow);
  return rows;
}

// ── Select menu response handlers ─────────────────────────────────────────────

async function handleMoveSelect(interaction) {
  const moveName = interaction.values[0];
  const db = MOVES_DB[moveName];
  const lines = [];
  if (db?.type && db.type !== 'unknown') {
    const en = db.type.charAt(0).toUpperCase() + db.type.slice(1);
    lines.push(`**屬性**: ${TYPE_EMOJI[en] ?? ''} ${en}`);
  }
  if (db?.category && db.category !== 'unknown') {
    const catLabel = { physical: '物理', special: '特殊', status: '變化' }[db.category] ?? db.category;
    lines.push(`**分類**: ${catLabel}`);
  }
  if (db?.power) {
    lines.push(`**威力**: ${db.power}`);
  }
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`招式詳情: ${moveName}`)
    .setDescription(lines.length ? lines.join('\n') : '暫無詳細資料');
  await interaction.reply({ embeds: [embed], flags: 64 });
}

async function handleAbilitySelect(interaction) {
  const [, seasonStr, f, ...nameParts] = interaction.customId.split('|');
  const pokemonName = nameParts.join('|');
  const format  = f === 's' ? 'singles' : 'doubles';
  const season  = parseInt(seasonStr, 10);
  const abilityName = interaction.values[0];

  const data  = loadSeasonData(season, format);
  const entry = data ? findPokemon(data, pokemonName) : null;
  const abil  = entry?.abilities?.find(a => a.name === abilityName);

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`特性詳情: ${abilityName}`)
    .setDescription(abil ? `使用率: **${abil.usage_percent}%**` : '暫無資料');
  await interaction.reply({ embeds: [embed], flags: 64 });
}

async function handleTeraSelect(interaction) {
  const zhTypeName = interaction.values[0];
  const enType = ZH_TO_EN_TYPE[zhTypeName];
  if (!enType || enType === '???') {
    await interaction.reply({ content: '無法查詢此屬性的相剋資訊。', flags: 64 });
    return;
  }

  // getTypeWeaknesses needs a Pokemon name; pass any pokemon and override with teraType
  const matchups = getTypeWeaknesses('Pikachu', enType);
  if (!matchups) {
    await interaction.reply({ content: '計算失敗。', flags: 64 });
    return;
  }

  const fmtTypes = types =>
    types.length ? types.map(t => `${TYPE_EMOJI[t] ?? ''} ${t}`).join('  ') : '—';

  const emojiStr = typeEmoji(zhTypeName);
  const fields = [];
  if (matchups['4'].length)    fields.push({ name: '4× 弱點', value: fmtTypes(matchups['4']),    inline: true });
  if (matchups['2'].length)    fields.push({ name: '2× 弱點', value: fmtTypes(matchups['2']),    inline: true });
  if (matchups['0.5'].length)  fields.push({ name: '½× 抗性', value: fmtTypes(matchups['0.5']),  inline: true });
  if (matchups['0.25'].length) fields.push({ name: '¼× 抗性', value: fmtTypes(matchups['0.25']), inline: true });
  if (matchups['0'].length)    fields.push({ name: '免疫',     value: fmtTypes(matchups['0']),    inline: true });
  if (!fields.length)          fields.push({ name: '相剋',     value: '此屬性無特殊相剋關係',       inline: false });

  const embed = new EmbedBuilder()
    .setColor(0xEE1515)
    .setTitle(`${emojiStr} ${zhTypeName} 太晶屬性相剋`)
    .addFields(...fields)
    .setFooter({ text: 'Pokémon HOME 使用率 · 太晶屬性相剋' });
  await interaction.reply({ embeds: [embed], flags: 64 });
}

// ── Command ───────────────────────────────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName('usage')
    .setDescription('查詢 Pokémon HOME 賽季個別寶可夢使用率數據')
    .addStringOption(o => o
      .setName('season')
      .setDescription('賽季 (請先選擇賽季)')
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
      )),

  async execute(interaction) {
    const format  = interaction.options.getString('format') ?? 'doubles';
    const season  = parseInt(interaction.options.getString('season'), 10);
    const pokemonQuery = interaction.options.getString('pokemon');

    const data = loadSeasonData(season, format);
    if (!data) {
      await interaction.reply({ content: `❌ 找不到賽季 ${season} 的${format === 'doubles' ? '雙打' : '單打'}資料。`, flags: 64 });
      return;
    }
    const entry = pokemonQuery ? findPokemon(data, pokemonQuery) : null;
    if (!entry) {
      await interaction.reply({ content: `❌ 找不到「${pokemonQuery}」的資料。請透過自動補全選擇寶可夢。`, flags: 64 });
      return;
    }

    await interaction.reply({
      embeds:     [buildOverviewEmbed(entry, season, format, data)],
      components: buildComponents('ov', entry, season, format),
    });
  },

  async autocomplete(interaction) {
    const focused    = interaction.options.getFocused(true);
    const format     = interaction.options.getString('format') ?? 'doubles';
    const latest     = getLatestSeason();
    const seasonRaw  = interaction.options.getString('season');
    const season     = parseInt(seasonRaw ?? String(latest), 10);

    if (focused.name === 'season') {
      const q       = focused.value.trim();
      const seasons = getAvailableSeasons().slice().reverse();
      const filtered = q
        ? seasons.filter(s => String(s).startsWith(q))
        : seasons;
      await interaction.respond(
        filtered.slice(0, 25).map(s => ({
          name:  `賽季 ${s}${s === latest ? ' (最新)' : ''}`,
          value: String(s),
        })),
      );
      return;
    }

    if (focused.name === 'pokemon') {
      if (!seasonRaw) { await interaction.respond([]); return; }
      const q      = focused.value.toLowerCase();
      const data   = loadSeasonData(season, format);
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
    const [, tab, seasonStr, f, ...nameParts] = interaction.customId.split('|');
    const pokemonName = nameParts.join('|');
    const format = f === 's' ? 'singles' : 'doubles';
    const season = parseInt(seasonStr, 10);

    const data  = loadSeasonData(season, format);
    const entry = data ? findPokemon(data, pokemonName) : null;
    if (!entry) { await interaction.reply({ content: '❌ 資料不存在。', flags: 64 }); return; }

    let embed;
    if      (tab === 'bd') embed = buildBuildsEmbed(entry, season, format, data);
    else if (tab === 'mv') embed = buildMovesEmbed(entry, season, format, data);
    else if (tab === 'mt') embed = buildMatchupsEmbed(entry, season, format, data);
    else                   embed = buildOverviewEmbed(entry, season, format, data);

    await interaction.update({
      embeds:     [embed],
      components: buildComponents(tab, entry, season, format),
    });
  },

  async handleSelectMenu(interaction) {
    if (interaction.customId.startsWith('up_mv_sel|')) return handleMoveSelect(interaction);
    if (interaction.customId.startsWith('up_ab_sel|')) return handleAbilitySelect(interaction);
    if (interaction.customId.startsWith('up_tr_sel|')) return handleTeraSelect(interaction);
  },
};
