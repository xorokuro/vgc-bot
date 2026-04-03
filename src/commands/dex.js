'use strict';

const {
  SlashCommandBuilder, EmbedBuilder, AttachmentBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const sharp = require('sharp');
const { searchPokemon, GAME_CONFIGS } = require('../utils/dexSearch');
const { translate }                   = require('../utils/i18n');
const { TYPE_EMOJI }                  = require('../utils/buildEmbed');

const PAGE_SIZE  = 25;
const COLOR      = 0x3B4CCA; // Pokémon blue
const CACHE_TTL  = 10 * 60 * 1000; // 10 minutes

// ── Result cache (keyed by interaction.id at search time) ─────────────────────
const _cache = new Map(); // cacheId → { results, gameId, query, showStats, expires }

function cacheStore(id, payload) {
  _cache.set(id, { ...payload, expires: Date.now() + CACHE_TTL });
  setTimeout(() => _cache.delete(id), CACHE_TTL);
}

// TYPE_EMOJI is imported from buildEmbed.js (custom Discord emoji IDs, Title-case keys)
// Helper: lowercase type name → sprite
function typeEmoji(t) {
  return TYPE_EMOJI[t[0].toUpperCase() + t.slice(1)] ?? '';
}

// ── Type effectiveness chart (Title-case keys) ────────────────────────────────
// TYPE_CHART[atk][def] = multiplier (omitted = 1×)
const TYPE_CHART = {
  Normal:   { Rock: 0.5,  Ghost: 0,   Steel: 0.5 },
  Fire:     { Fire: 0.5,  Water: 0.5, Grass: 2,   Ice: 2,   Bug: 2,   Rock: 0.5, Dragon: 0.5, Steel: 2 },
  Water:    { Fire: 2,    Water: 0.5, Grass: 0.5, Ground: 2, Rock: 2,  Dragon: 0.5 },
  Electric: { Water: 2,   Electric: 0.5, Grass: 0.5, Ground: 0, Flying: 2, Dragon: 0.5 },
  Grass:    { Fire: 0.5,  Water: 2,   Grass: 0.5, Poison: 0.5, Ground: 2, Flying: 0.5, Bug: 0.5, Rock: 2, Dragon: 0.5, Steel: 0.5 },
  Ice:      { Water: 0.5, Grass: 2,   Ice: 0.5,   Ground: 2, Flying: 2, Dragon: 2, Steel: 0.5 },
  Fighting: { Normal: 2,  Ice: 2,     Poison: 0.5, Flying: 0.5, Psychic: 0.5, Bug: 0.5, Rock: 2, Ghost: 0, Dark: 2, Steel: 2, Fairy: 0.5 },
  Poison:   { Grass: 2,   Poison: 0.5, Ground: 0.5, Rock: 0.5, Ghost: 0.5, Steel: 0, Fairy: 2 },
  Ground:   { Fire: 2,    Electric: 2, Grass: 0.5, Poison: 2, Flying: 0, Bug: 0.5, Rock: 2, Steel: 2 },
  Flying:   { Electric: 0.5, Grass: 2, Fighting: 2, Bug: 2, Rock: 0.5, Steel: 0.5 },
  Psychic:  { Fighting: 2, Poison: 2, Psychic: 0.5, Dark: 0, Steel: 0.5 },
  Bug:      { Fire: 0.5,  Grass: 2,   Fighting: 0.5, Flying: 0.5, Psychic: 2, Ghost: 0.5, Dark: 2, Steel: 0.5, Fairy: 0.5, Poison: 0.5 },
  Rock:     { Fire: 2,    Ice: 2,     Fighting: 0.5, Ground: 0.5, Flying: 2, Bug: 2, Steel: 0.5 },
  Ghost:    { Normal: 0,  Psychic: 2, Ghost: 2,   Dark: 0.5 },
  Dragon:   { Dragon: 2,  Steel: 0.5, Fairy: 0 },
  Dark:     { Fighting: 0.5, Psychic: 2, Ghost: 2, Dark: 0.5, Fairy: 0.5 },
  Steel:    { Fire: 0.5,  Water: 0.5, Electric: 0.5, Ice: 2, Rock: 2, Steel: 0.5, Fairy: 2 },
  Fairy:    { Fighting: 2, Poison: 0.5, Bug: 0.5, Dragon: 2, Dark: 2, Steel: 0.5 },
};

const ALL_TYPES = Object.keys(TYPE_CHART);

/**
 * Compute type effectiveness groups for a Pokémon with the given types.
 * @param {string[]} typesEn  e.g. ['fire', 'flying']
 * @returns {{ '4': string[], '2': string[], '0.5': string[], '0.25': string[], '0': string[] }}
 */
function calcWeaknesses(typesEn) {
  const result = { '4': [], '2': [], '0.5': [], '0.25': [], '0': [] };
  const defTypes = typesEn.map(t => t[0].toUpperCase() + t.slice(1)); // Title-case
  for (const atkType of ALL_TYPES) {
    const chart = TYPE_CHART[atkType] ?? {};
    let mult = 1;
    for (const def of defTypes) mult *= chart[def] ?? 1;
    if      (mult === 4)    result['4'].push(atkType);
    else if (mult === 2)    result['2'].push(atkType);
    else if (mult === 0.5)  result['0.5'].push(atkType);
    else if (mult === 0.25) result['0.25'].push(atkType);
    else if (mult === 0)    result['0'].push(atkType);
  }
  return result;
}

// ── Stat bar (20 chars wide, max 255) ─────────────────────────────────────────
function statBar(val, max = 255) {
  const filled = Math.round((val / max) * 20);
  return '█'.repeat(filled) + '░'.repeat(20 - filled);
}

// ── Stat labels per language ──────────────────────────────────────────────────
const STAT_KEYS = [
  { key: 'hp',              color: '#FF5959' },
  { key: 'attack',          color: '#F5AC78' },
  { key: 'defense',         color: '#FAE078' },
  { key: 'special-attack',  color: '#9DB7F5' },
  { key: 'special-defense', color: '#A7DB8D' },
  { key: 'speed',           color: '#FA92B2' },
];
const STAT_LABELS = {
  zh: ['HP', '攻擊', '防禦', '特攻', '特防', '速度'],
  ja: ['HP', '攻撃', '防御', '特攻', '特防', '素早'],
  en: ['HP', 'Atk', 'Def', 'SpA', 'SpD', 'Spe'],
};

// ── Stat chart image ─────────────────────────────────────────────────────────
async function buildStatImage(stats, bst, lang = 'zh') {
  const labels = STAT_LABELS[lang] ?? STAT_LABELS.zh;
  const W = 400, H = 258;
  const BAR_X = 100, BAR_W = 276, BAR_H = 14;
  const START_Y = 64, ROW_H = 32;

  const rows = STAT_KEYS.map((r, i) => {
    const label = labels[i];
    const val  = stats[r.key] ?? 0;
    const barW = Math.max(0, Math.round(val / 255 * BAR_W));
    const y    = START_Y + i * ROW_H;
    return `
      <text x="20" y="${y}" font-family="sans-serif" font-size="13" fill="#CCCCCC">${label}</text>
      <text x="${BAR_X - 8}" y="${y}" font-family="monospace" font-size="13" fill="#CCCCCC" text-anchor="end">${val}</text>
      <rect x="${BAR_X}" y="${y - 12}" width="${BAR_W}" height="${BAR_H}" fill="#2A2A3A" rx="3"/>
      ${barW > 0 ? `<rect x="${BAR_X}" y="${y - 12}" width="${barW}" height="${BAR_H}" fill="${r.color}" rx="3"/>` : ''}`;
  }).join('');

  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${W}" height="${H}" fill="#12121C" rx="10"/>
    <text x="20" y="24" font-family="sans-serif" font-size="13" fill="#888888">種族値　総計 ${bst}</text>
    <line x1="20" y1="34" x2="${W - 20}" y2="34" stroke="#333333" stroke-width="1"/>
    ${rows}
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

// ── Localised label tables ────────────────────────────────────────────────────
const DEX_LABELS = {
  zh: { type: '屬性', stats: '種族值', ability: '特性', weakness: '弱點・抗性', noWeak: '無特殊弱點', hidden: '〔隱藏特性〕' },
  ja: { type: 'タイプ', stats: '種族値', ability: '特性', weakness: '弱点・耐性', noWeak: '特殊な弱点なし', hidden: '〔隠れ特性〕' },
  en: { type: 'Type', stats: 'Base Stats', ability: 'Abilities', weakness: 'Weaknesses', noWeak: 'No special weaknesses', hidden: '[Hidden]' },
};

// ── Resolve display name for a Pokémon in the requested language ──────────────
// For zh: use name_zh (already includes form description in Chinese).
// For en: formatted English name (e.g. "Vulpix-Alola").
// For ja: translate the base species name via trilingual.json, then append the
//         form suffix in English if present (e.g. "ロコン (Alola)").
function getPokeDisplayName(poke, lang) {
  const nameEn    = poke.name_en || '';
  const speciesEn = poke.species_en_name || nameEn;
  const cap       = w => w.charAt(0).toUpperCase() + w.slice(1);

  if (lang === 'zh') return poke.name_zh || nameEn;

  const formattedEn = nameEn.split('-').map(cap).join('-');
  if (lang === 'en') return formattedEn;

  // Japanese: translate species, append form if any
  const speciesFormatted = speciesEn.split('-').map(cap).join(' ');
  const jaSpecies = translate(speciesFormatted, 'pokemon', 'ja');
  const hasForm   = nameEn.length > speciesEn.length && nameEn.startsWith(speciesEn + '-');
  if (!hasForm) return jaSpecies;
  const formStr = nameEn.slice(speciesEn.length + 1).split('-').map(cap).join(' ');
  return `${jaSpecies} (${formStr})`;
}

// ── Detail embed for one Pokémon ──────────────────────────────────────────────
function buildDetailEmbed(poke, lang = 'zh') {
  const L      = DEX_LABELS[lang] ?? DEX_LABELS.zh;
  const dexNum = poke.id ? `#${String(poke.id).padStart(4, '0')}` : '';
  const title  = `${getPokeDisplayName(poke, lang)}  ${dexNum}`;

  // Types
  const typeStr = (poke.types_en || []).map(t => typeEmoji(t)).join('  ');

  // Stats
  const s      = poke.stats ?? {};
  const bst    = Object.values(s).reduce((a, v) => a + (v || 0), 0);
  const sLabels = STAT_LABELS[lang] ?? STAT_LABELS.zh;
  const statVals = [
    s.hp ?? 0, s.attack ?? 0, s.defense ?? 0,
    s['special-attack'] ?? 0, s['special-defense'] ?? 0, s.speed ?? 0,
  ];
  const statLines = sLabels.map((lbl, i) =>
    `\`${lbl.padEnd(3)}\` \`${String(statVals[i]).padStart(3)}\``,
  ).join('\n');

  // Abilities
  const abilities = poke.abilities ?? [];
  const abilityLines = abilities.map(a => {
    const enKey = a.name.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
    const name  = translate(enKey, 'ability', lang) || enKey;
    const hidden = a.is_hidden ? ` ${L.hidden}` : '';
    return `${name}${hidden}`;
  }).join('\n');

  // Type weaknesses
  const weak = calcWeaknesses(poke.types_en ?? []);
  const weakRows = [
    ['4×', weak['4']], ['2×', weak['2']], ['½×', weak['0.5']],
    ['¼×', weak['0.25']], ['0×', weak['0']],
  ]
    .filter(([, arr]) => arr.length > 0)
    .map(([label, arr]) => `**${label}** ${arr.map(t => typeEmoji(t.toLowerCase())).join('')}`)
    .join('  ');

  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(title)
    .addFields(
      { name: `${L.type}`,                  value: typeStr || '—', inline: false },
      { name: `⚔️ ${L.stats}  BST: ${bst}`, value: statLines,   inline: false },
      { name: `💡 ${L.ability}`,            value: abilityLines || '—', inline: false },
      { name: `🛡️ ${L.weakness}`,           value: weakRows || L.noWeak, inline: false },
    );
}

// ── Build search-result embed ─────────────────────────────────────────────────
function buildEmbed(results, gameId, query, page, showStats, lang = 'zh') {
  const cfg        = GAME_CONFIGS[gameId];
  const totalPages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const slice      = results.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const lines = slice.map(p => {
    const name = getPokeDisplayName(p, lang);
    if (showStats && p.stats) {
      const s   = p.stats;
      const bst = Object.values(s).reduce((a, v) => a + (v || 0), 0);
      return `${name}　HP:${s.hp} 攻:${s.attack} 防:${s.defense} 特攻:${s['special-attack']} 特防:${s['special-defense']} 速:${s.speed} [${bst}]`;
    }
    return name;
  });

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(`🔍 寶可夢搜尋結果 (${cfg.labelZh})`)
    .setDescription(`查詢條件: ${query}\n共找到 **${results.length}** 筆結果：\n\n${lines.join('\n') || '—'}`)
    .setFooter({ text: `頁數: ${page + 1}/${totalPages}` });

  return { embed, slice };
}

// ── Dropdown: select a Pokémon from the current page to see its detail ────────
function buildDetailMenu(slice, gameId, lang, pub) {
  if (!slice.length) return null;
  const options = slice.map((p, i) => ({
    label: getPokeDisplayName(p, lang).slice(0, 100) || `#${i}`,
    value: p.name_en || String(i),
  }));
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`dex_detail|${gameId}|${lang}|${pub ? '1' : '0'}`)
      .setPlaceholder('🔎 查看詳細資料 / View Pokémon details')
      .addOptions(options),
  );
}

function makeNavRow(page, totalPages, cacheId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`dex_page|${cacheId}|${page - 1}`)
      .setLabel('← 上頁')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId(`dex_page|${cacheId}|${page + 1}`)
      .setLabel('下頁 →')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1),
  );
}

// ── Helper: build reply components for a page ─────────────────────────────────
function pageComponents(slice, gameId, page, totalPages, cacheId, lang, pub) {
  const rows = [];
  if (totalPages > 1) rows.push(makeNavRow(page, totalPages, cacheId));
  const menu = buildDetailMenu(slice, gameId, lang, pub);
  if (menu) rows.push(menu);
  return rows;
}

// ── Command definition ────────────────────────────────────────────────────────
module.exports = {
  data: new SlashCommandBuilder()
    .setName('pokemon_search')
    .setDescription('搜尋主系列寶可夢 / Search Pokémon by type, stats, moves, abilities')
    .addStringOption(o => o
      .setName('game')
      .setDescription('遊戲版本 / Game version')
      .setRequired(true)
      .addChoices(
        { name: '朱紫 (Scarlet/Violet)', value: 'scvi' },
        { name: '傳說Z-A (Legends: Z-A)', value: 'plza' },
      ))
    .addStringOption(o => o
      .setName('query')
      .setDescription('搜尋條件 / Query — e.g. 火系 AND 速度>=100 AND NOT 龍系　　(水系 OR 冰系) AND 速度>=110')
      .setRequired(true))
    .addBooleanOption(o => o
      .setName('show_stats')
      .setDescription('顯示種族值 / Show base stats in results (default: off)'))
    .addStringOption(o => o
      .setName('lang')
      .setDescription('詳細頁語言（預設：繁體中文）/ Language for detail card')
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
      const cfg = GAME_CONFIGS[gameId];
      await interaction.editReply({
        content: `在 **${cfg.labelZh} (${cfg.labelEn})** 中找不到符合條件的寶可夢。\n查詢：\`${query}\``,
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

  // ── dex_page| button ──────────────────────────────────────────────────────
  async handlePageButton(interaction) {
    const [, cacheId, pageStr] = interaction.customId.split('|');
    const page = parseInt(pageStr, 10);

    const cached = _cache.get(cacheId);
    if (!cached) {
      await interaction.reply({ content: '⏰ 搜尋結果已過期，請重新執行 `/pokemon_search`。', flags: 64 });
      return;
    }

    const { results, gameId, query, showStats, lang = 'zh', pub = false } = cached;
    const totalPages          = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
    const { embed, slice }    = buildEmbed(results, gameId, query, page, showStats, lang);
    await interaction.update({
      embeds:     [embed],
      components: pageComponents(slice, gameId, page, totalPages, cacheId, lang, pub),
    });
  },

  // ── dex_detail| select menu → detail card ────────────────────────────────
  async handleSelectMenu(interaction) {
    const parts  = interaction.customId.split('|');
    const gameId = parts[1];
    const lang   = parts[2] ?? 'zh';
    const pub    = parts[3] === '1';
    const nameEn = interaction.values[0];
    const cfg    = GAME_CONFIGS[gameId];
    if (!cfg) { await interaction.reply({ content: '❌ 無效遊戲。', flags: 64 }); return; }

    const { results } = searchPokemon(nameEn, gameId);
    const poke = results.find(p => p.name_en === nameEn);

    if (!poke) {
      await interaction.reply({ content: `❌ 找不到 ${nameEn} 的資料。`, flags: 64 });
      return;
    }

    const embed = buildDetailEmbed(poke, lang);
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
