'use strict';

/**
 * /card — Unified PTCGP card search.
 *
 * Two modes, auto-detected from the query:
 *
 *  Name/UID mode  (no operators)
 *    /card pikachu          → autocomplete → single card + image
 *    /card A1-094           → direct uid → single card + image
 *
 *  Filter mode  (query contains = > < AND OR …)
 *    /card hp >= 100 AND type = Fire  → paginated list with select menu
 *    /card rarity = IM                → paginated list
 */

const {
  SlashCommandBuilder, EmbedBuilder, AttachmentBuilder,
  ButtonBuilder, ButtonStyle, ActionRowBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const fs     = require('fs');
const cardDb = require('../ptcgp/cardDb');
const { getSetName }                              = require('../ptcgp/setNames');
const { typeSprite, raritySprite, rarityDisplay } = require('../ptcgp/sprites');

// ── Mode detection ────────────────────────────────────────────────────────────

const FILTER_RE = /[=><]|!=|\bAND\b|\bOR\b/i;
const isFilter  = raw => FILTER_RE.test(raw);

// ── In-memory result cache (expires after 15 min) ─────────────────────────────

const resultCache = new Map();

function cacheResults(id, results, parsedDesc) {
  const now = Date.now();
  for (const [k, v] of resultCache) if (v.expires < now) resultCache.delete(k);
  resultCache.set(id, { results, parsedDesc, expires: now + 15 * 60 * 1000 });
}

// ── Type alias normalisation ──────────────────────────────────────────────────

const TYPE_ALIASES = {
  dark: 'Darkness', darkness: 'Darkness', '惡': 'Darkness', '悪': 'Darkness',
  fighting: 'Fighting', '鬥': 'Fighting', '闘': 'Fighting',
  lightning: 'Lightning', electric: 'Lightning', thunder: 'Lightning', '雷': 'Lightning',
  colorless: 'Colorless', normal: 'Colorless', '無色': 'Colorless', '無': 'Colorless',
  steel: 'Metal', metal: 'Metal', '鋼': 'Metal',
  dragon: 'Dragon', '龍': 'Dragon',
  psychic: 'Psychic', '超': 'Psychic',
  grass: 'Grass', '草': 'Grass',
  fire: 'Fire', '炎': 'Fire', '火': 'Fire',
  water: 'Water', '水': 'Water',
};
const normalizeType = raw => TYPE_ALIASES[raw.toLowerCase()] ?? TYPE_ALIASES[raw] ?? raw;

// ── Tokeniser + parser ────────────────────────────────────────────────────────

const TOKEN_RE = /\(|\)|AND|OR|!=|>=|<=|>|<|=|[\w\u4e00-\u9fff\u3040-\u30ff\u3400-\u4dbf\uff00-\uffef\u2600-\u26ff\u2700-\u27bff\u00c0-\u024f\u00e9\-\.]+/gi;

class ParseError extends Error {}

function parse(expr) {
  const tokens = [];
  let m;
  while ((m = TOKEN_RE.exec(expr)) !== null) tokens.push(m[0]);
  let pos = 0;
  const peek    = () => tokens[pos];
  const consume = () => tokens[pos++];

  function parseExpr() {
    let left = parseTerm();
    while (peek() && /^(AND|OR)$/i.test(peek())) {
      const op = consume().toUpperCase(), right = parseTerm(), lc = left;
      if (op === 'AND') { left = c => lc(c) && right(c); left._desc = `(${lc._desc} AND ${right._desc})`; }
      else              { left = c => lc(c) || right(c); left._desc = `(${lc._desc} OR ${right._desc})`;  }
    }
    return left;
  }
  function parseTerm() {
    if (peek() === '(') {
      consume();
      const inner = parseExpr();
      if (peek() !== ')') throw new ParseError('Expected ")"');
      consume(); return inner;
    }
    return parseComparison();
  }
  function parseComparison() {
    const field = consume(); if (!field) throw new ParseError('Expected field name');
    const op    = consume(); if (!op || !/^(=|!=|>=|<=|>|<)$/.test(op)) throw new ParseError(`Expected operator after "${field}", got "${op ?? 'end'}"`);
    const val   = consume(); if (!val) throw new ParseError(`Expected value after "${field} ${op}"`);
    return buildPredicate(field.toLowerCase(), op, val);
  }

  const fn = parseExpr();
  if (pos < tokens.length) throw new ParseError(`Unexpected token: "${tokens[pos]}"`);
  return fn;
}

// ── Predicate builder ─────────────────────────────────────────────────────────

const RARITY_ORDER = { C:1, U:2, R:3, RR:4, AR:5, SR:6, SAR:7, IM:8, S:9, SSR:10, UR:11 };

const FIELD_ALIASES = {
  // HP
  '血量': 'hp', '血': 'hp', 'ｈｐ': 'hp',
  'hp': 'hp',
  // type
  '屬性': 'type', '属性': 'type', '類型': 'type', '系': 'type',
  'タイプ': 'type', 'てタイプ': 'type',
  // rarity
  '稀有度': 'rarity', '稀有': 'rarity', '罕見度': 'rarity',
  'レアリティ': 'rarity', 'レア': 'rarity',
  // set
  '系列': 'set', '套牌': 'set', '擴充包': 'set', '扩充包': 'set',
  'セット': 'set', '拡張': 'set',
  // name
  '名稱': 'name', '名字': 'name', '名前': 'name', '名称': 'name',
  // num
  '編號': 'num', '号码': 'num', '編号': 'num', '番号': 'num', 'no': 'num',
  // category
  '分類': 'category', '分类': 'category', 'カテゴリ': 'category',
};

function buildPredicate(field, op, rawVal) {
  field = FIELD_ALIASES[field] ?? field;
  const val = rawVal.toLowerCase();

  function numCmp(n) {
    const v = parseFloat(rawVal); if (isNaN(v)) throw new ParseError(`"${rawVal}" is not a number`);
    return op==='='?n===v:op==='!='?n!==v:op==='>'?n>v:op==='>='?n>=v:op==='<'?n<v:op==='<='?n<=v:false;
  }
  function strEq(a, b) {
    if (op==='=')  return a.toLowerCase()===b.toLowerCase();
    if (op==='!=') return a.toLowerCase()!==b.toLowerCase();
    throw new ParseError(`Operator "${op}" not valid for text`);
  }

  let pred, desc;
  switch (field) {
    case 'type': {
      const canonical = normalizeType(rawVal);
      pred = c => c.type ? strEq(c.type, canonical) : strEq('Trainer', rawVal)||strEq('Trainer', canonical);
      desc = `type ${op} ${canonical}`; break;
    }
    case 'hp':
      pred = c => { const h = c.hp??null; return h!==null && numCmp(h); };
      desc = `hp ${op} ${rawVal}`; break;
    case 'rarity': {
      const up = rawVal.toUpperCase();
      if (op==='='||op==='!=') { pred = c => strEq(c.rarity??'', up); }
      else { const rank=RARITY_ORDER[up]; if(!rank) throw new ParseError(`Unknown rarity: "${rawVal}"`); pred = c => { const cr=RARITY_ORDER[c.rarity??'']; return !!cr&&numCmp(cr); }; }
      desc = `rarity ${op} ${up}`; break;
    }
    case 'set':
      pred = c => strEq(c.set??'', rawVal);
      desc = `set ${op} ${rawVal.toUpperCase()}`; break;
    case 'name':
      pred = c => {
        const {zh='',ja='',en=''} = c.names;
        if (op==='=')  return zh.toLowerCase().includes(val)||ja.toLowerCase().includes(val)||en.toLowerCase().includes(val);
        if (op==='!=') return !zh.toLowerCase().includes(val)&&!ja.toLowerCase().includes(val)&&!en.toLowerCase().includes(val);
        throw new ParseError(`Operator "${op}" not valid for name`);
      };
      desc = `name ${op} ${rawVal}`; break;
    case 'num': case 'number':
      pred = c => numCmp(c.num??0); desc = `num ${op} ${rawVal}`; break;
    case 'category':
      pred = c => strEq((c.category??'').toLowerCase(), rawVal.toLowerCase());
      desc = `category ${op} ${rawVal}`; break;
    default:
      throw new ParseError(`Unknown field: "${field}". Valid: type/屬性, hp/血量, rarity/稀有度, set/系列, name/名稱, num/編號, category/分類`);
  }
  pred._desc = desc;
  return pred;
}

// ── Shared helpers ────────────────────────────────────────────────────────────

const PAGE_SIZE = 10;

const LANG_LABELS = {
  tw: { key: 'zh_TW', label: '繁中', nameKey: 'zh' },
  jp: { key: 'ja_JP', label: '日本語', nameKey: 'ja' },
  en: { key: 'en_US', label: 'English', nameKey: 'en' },
};

function primaryName(card, display) {
  const { nameKey } = LANG_LABELS[display] ?? LANG_LABELS.tw;
  return card.names[nameKey] || card.names.zh || card.names.en || card.names.ja || '(unknown)';
}

function autocompleteLabel(card) {
  const parts = [];
  if (card.names.zh) parts.push(card.names.zh);
  if (card.names.en && card.names.en !== card.names.zh) parts.push(card.names.en);
  return `${parts.join(' / ') || '(unknown)'} — ${card.set} #${card.num}`.slice(0, 100);
}

function formatCardLine(card) {
  const name  = card.names.zh || card.names.en || '(unknown)';
  const hpStr = card.hp != null ? ` HP:${card.hp}` : '';
  return `\`${card.uid}\` ${typeSprite(card.type)} **${name}**  ${raritySprite(card.rarity)} ${card.rarity}${hpStr}`;
}

function buildCardDetailEmbed(card, display, imageName = 'card.png') {
  const allNames = [
    card.names.zh ? `繁中: **${card.names.zh}**` : null,
    card.names.en ? `EN: **${card.names.en}**`   : null,
    card.names.ja ? `JP: **${card.names.ja}**`   : null,
  ].filter(Boolean).join('\n');

  const zhSetName  = getSetName(card.set, 'zh');
  const enSetName  = getSetName(card.set, 'en');
  const setDisplay = zhSetName !== card.set
    ? `${zhSetName} / ${enSetName} (${card.set})`
    : `${enSetName} (${card.set})`;

  const weakStr = (card.weakness && card.weakness.type !== 'Colorless')
    ? `${typeSprite(card.weakness.type)} ${card.weakness.value}`
    : '—';

  return new EmbedBuilder()
    .setTitle(primaryName(card, display))
    .setDescription(allNames || null)
    .addFields(
      { name: '系列 / Set',      value: setDisplay,                                inline: false },
      { name: '卡號 / Number',   value: `#${String(card.num).padStart(3, '0')}`,  inline: true  },
      { name: '稀有度 / Rarity', value: rarityDisplay(card),                       inline: true  },
      { name: '屬性 / Type',     value: typeSprite(card.type),                     inline: true  },
      { name: 'HP',              value: card.hp != null ? `${card.hp}` : '—',     inline: true  },
      { name: '弱點 / Weakness', value: weakStr,                                   inline: true  },
      { name: '分類 / Category', value: card.category === 'Pokémon' ? '寶可夢' : '訓練師', inline: true },
    )
    .setImage(`attachment://${imageName}`)
    .setColor(0xE8C435)
    .setFooter({ text: `PTCGP · ${card.uid}` });
}

// ── Paginated list builders ───────────────────────────────────────────────────

function buildPage(results, page, parsedDesc, cacheId) {
  const totalPages = Math.ceil(results.length / PAGE_SIZE);
  page = Math.max(0, Math.min(page, totalPages - 1));
  const slice = results.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const embed = new EmbedBuilder()
    .setTitle(`找到 ${results.length} 張卡牌 / ${results.length} cards found`)
    .setDescription(slice.map(formatCardLine).join('\n'))
    .setColor(0xE8C435)
    .setFooter({ text: `第 ${page + 1} / ${totalPages} 頁 · ${parsedDesc}` });

  const components = [];

  if (totalPages > 1) {
    const prev = new ButtonBuilder()
      .setCustomId(`sc_page|${cacheId}|${page - 1}`)
      .setLabel('◀ 上一頁').setStyle(ButtonStyle.Secondary).setDisabled(page === 0);
    const next = new ButtonBuilder()
      .setCustomId(`sc_page|${cacheId}|${page + 1}`)
      .setLabel('下一頁 ▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1);
    const jump = new ButtonBuilder()
      .setCustomId(`sc_jump|${cacheId}`)
      .setLabel('跳頁 / Go to page').setStyle(ButtonStyle.Primary);
    components.push(new ActionRowBuilder().addComponents(prev, next, jump));
  }

  const options = slice.map(c => {
    const label = `${c.uid} ${c.names.zh || c.names.en || '—'}  ${c.rarity}`.slice(0, 100);
    const parts = [];
    if (c.hp != null) parts.push(`HP ${c.hp}`);
    if (c.weakness)   parts.push(`弱點 ${c.weakness.type} ${c.weakness.value}`);
    return { label, value: c.uid, description: parts.join(' · ') || undefined };
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`sc_card|${cacheId}`)
    .setPlaceholder('選卡查看詳情 / Select a card to view details')
    .addOptions(options);
  components.push(new ActionRowBuilder().addComponents(menu));

  return { embed, components };
}

// ── Command definition ────────────────────────────────────────────────────────

const data = new SlashCommandBuilder()
  .setName('search_card')
  .setDescription('搜尋 PTCGP 卡牌 / Search PTCGP cards — name, UID, or filter expression')
  .addStringOption(opt =>
    opt.setName('query')
      .setDescription('卡名/卡號 或篩選條件 / Name, UID, or filter (e.g. hp >= 100 AND type = Fire)')
      .setRequired(true)
      .setAutocomplete(true),
  )
  .addStringOption(opt =>
    opt.setName('display')
      .setDescription('顯示語言 / Display language — single card only (default: 繁中)')
      .setRequired(false)
      .addChoices(
        { name: '繁中 (Traditional Chinese)', value: 'tw' },
        { name: 'English',                    value: 'en' },
        { name: '日本語 (Japanese)',           value: 'jp' },
      ),
  );

// ── Autocomplete ───────────────────────────────────────────────────────────────

async function autocomplete(interaction) {
  if (!cardDb.isReady()) return interaction.respond([]);
  const query = interaction.options.getFocused();

  if (isFilter(query)) {
    // Show a hint instead of name suggestions
    const hint = query.length <= 90 ? query : query.slice(0, 87) + '…';
    return interaction.respond([{ name: `🔍 篩選: ${hint}`, value: query }]);
  }

  const matches = cardDb.search(query, 25);
  await interaction.respond(matches.map(c => ({ name: autocompleteLabel(c), value: c.uid })));
}

// ── Execute ───────────────────────────────────────────────────────────────────

async function execute(interaction) {
  if (!cardDb.isReady()) {
    return interaction.reply({ content: '⚠ Database not ready.', flags: 64 });
  }

  const raw     = interaction.options.getString('query');
  const display = interaction.options.getString('display') ?? 'tw';

  // ── Filter mode ───────────────────────────────────────────────────────────
  if (isFilter(raw)) {
    let predFn, parsedDesc;
    try {
      predFn     = parse(raw);
      parsedDesc = predFn._desc ?? raw;
    } catch (err) {
      const embed = new EmbedBuilder()
        .setTitle('❌ 語法錯誤 / Query Syntax Error')
        .setDescription([
          `**Error:** ${err.message}`, '',
          '**Examples:**',
          '`type = Grass`', '`hp >= 70`', '`rarity = SR`', '`set = A1`',
          '`name = pikachu`', '`hp >= 70 AND (type = Darkness OR type = Psychic)`', '',
          '**Fields:** `type`/`屬性` · `hp`/`血量` · `rarity`/`稀有度` · `set`/`系列` · `name`/`名稱` · `num`/`編號` · `category`/`分類`',
          '**Operators:** `=` `!=` `>` `>=` `<` `<=`',
          '**Logic:** `AND` `OR` — group with `( )`',
        ].join('\n'))
        .setColor(0xFF4444);
      return interaction.reply({ embeds: [embed], flags: 64 });
    }

    await interaction.deferReply();
    const results = cardDb.filterCards(predFn, 9999);

    if (results.length === 0) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle('找不到符合條件的卡牌 / No cards match.')
          .setDescription('請調整搜尋條件後再試。')
          .setColor(0xFF4444)
          .setFooter({ text: `Query: ${parsedDesc}` })],
      });
    }

    if (results.length === 1) {
      const card      = results[0];
      const imagePath = card.images?.zh_TW ?? card.images?.en_US ?? Object.values(card.images ?? {})[0];
      const embed     = buildCardDetailEmbed(card, display);
      embed.setTitle(`找到 1 張 / ${card.names.zh || card.names.en || card.uid}`);
      if (imagePath && fs.existsSync(imagePath)) {
        const att = new AttachmentBuilder(imagePath, { name: 'card.png' });
        return interaction.editReply({ embeds: [embed], files: [att] });
      }
      return interaction.editReply({ embeds: [embed] });
    }

    const cacheId = interaction.id;
    cacheResults(cacheId, results, parsedDesc);
    const { embed, components } = buildPage(results, 0, parsedDesc, cacheId);
    return interaction.editReply({ embeds: [embed], components });
  }

  // ── Name / UID mode ───────────────────────────────────────────────────────
  let card = cardDb.getCard(raw);
  if (!card) {
    // Handle autocomplete-label format: "葉子 / Leaf — A1a #82"
    // Extract the SET #num part to construct a UID, falling back to name-only search
    let searchQuery = raw;
    const dashIdx = raw.indexOf(' \u2014 '); // em-dash separator in autocomplete labels
    if (dashIdx !== -1) {
      const setNumPart  = raw.slice(dashIdx + 3).trim();           // "A1a #82"
      const setNumMatch = setNumPart.match(/^(\S+)\s+#(\d+)$/);
      if (setNumMatch) card = cardDb.getCard(`${setNumMatch[1]}-${setNumMatch[2]}`);
      if (!card) searchQuery = raw.slice(0, dashIdx).trim();       // "葉子 / Leaf" → "葉子"
    }
    if (!card) {
      // If query has " / " (multi-lang label), try each part
      const parts = searchQuery.split(' / ');
      for (const part of parts) {
        const results = cardDb.search(part.trim(), 1);
        if (results[0]) { card = results[0]; break; }
      }
    }
  }

  if (!card) {
    return interaction.reply({ content: '❌ 找不到卡牌 / Card not found.', flags: 64 });
  }

  const langKey   = LANG_LABELS[display]?.key ?? 'zh_TW';
  const imagePath = card.images?.[langKey] ?? Object.values(card.images ?? {})[0];

  if (!imagePath || !fs.existsSync(imagePath)) {
    return interaction.reply({
      content: `⚠ Image not found for **${primaryName(card, display)}** (${card.uid}).`,
      flags: 64,
    });
  }

  await interaction.deferReply();
  const attachment = new AttachmentBuilder(imagePath, { name: 'card.png' });
  const embed      = buildCardDetailEmbed(card, display);
  await interaction.editReply({ embeds: [embed], files: [attachment] });
}

// ── Button: page nav ──────────────────────────────────────────────────────────

async function handleButton(interaction) {
  const [, cacheId, pageStr] = interaction.customId.split('|');
  const entry = resultCache.get(cacheId);
  if (!entry) {
    return interaction.reply({
      content: '⏰ 搜尋結果已過期，請重新搜尋。\nSearch expired — please search again.',
      flags: 64,
    });
  }
  await interaction.deferUpdate();
  const { embed, components } = buildPage(entry.results, parseInt(pageStr, 10), entry.parsedDesc, cacheId);
  await interaction.editReply({ embeds: [embed], components });
}

// ── Button: jump (opens modal) ────────────────────────────────────────────────

async function handleJumpButton(interaction) {
  const [, cacheId] = interaction.customId.split('|');
  const entry = resultCache.get(cacheId);
  if (!entry) {
    return interaction.reply({
      content: '⏰ 搜尋結果已過期，請重新搜尋。\nSearch expired — please search again.',
      flags: 64,
    });
  }
  const totalPages = Math.ceil(entry.results.length / PAGE_SIZE);
  const modal = new ModalBuilder()
    .setCustomId(`sc_jump_modal|${cacheId}`)
    .setTitle(`跳頁 / Go to Page (1–${totalPages})`);
  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder()
      .setCustomId('page_num')
      .setLabel(`頁碼 / Page number (1–${totalPages})`)
      .setStyle(TextInputStyle.Short)
      .setPlaceholder(`1–${totalPages}`)
      .setRequired(true),
  ));
  await interaction.showModal(modal);
}

// ── Modal: jump submit ────────────────────────────────────────────────────────

async function handleJumpModal(interaction) {
  const [, cacheId] = interaction.customId.split('|');
  const entry = resultCache.get(cacheId);
  if (!entry) {
    return interaction.reply({
      content: '⏰ 搜尋結果已過期，請重新搜尋。\nSearch expired — please search again.',
      flags: 64,
    });
  }
  const totalPages = Math.ceil(entry.results.length / PAGE_SIZE);
  const page = parseInt(interaction.fields.getTextInputValue('page_num').trim(), 10) - 1;
  if (isNaN(page) || page < 0 || page >= totalPages) {
    return interaction.reply({
      content: `❌ 無效頁碼 / Invalid page — enter 1–${totalPages}.`,
      flags: 64,
    });
  }
  await interaction.deferUpdate();
  const { embed, components } = buildPage(entry.results, page, entry.parsedDesc, cacheId);
  await interaction.editReply({ embeds: [embed], components });
}

// ── Select menu: card detail (ephemeral) ──────────────────────────────────────

async function handleSelectMenu(interaction) {
  const uid  = interaction.values[0];
  const card = cardDb.getCard(uid);
  if (!card) return interaction.reply({ content: '❌ Card not found.', flags: 64 });

  const imagePath = card.images?.zh_TW ?? card.images?.en_US ?? Object.values(card.images ?? {})[0];
  if (!imagePath || !fs.existsSync(imagePath)) {
    return interaction.reply({ content: '⚠ Image not found.', flags: 64 });
  }

  await interaction.deferReply({ flags: 64 });
  const attachment = new AttachmentBuilder(imagePath, { name: 'card.png' });
  const embed      = buildCardDetailEmbed(card, 'tw');
  await interaction.editReply({ embeds: [embed], files: [attachment] });
}

// ── Export ────────────────────────────────────────────────────────────────────

module.exports = { data, autocomplete, execute, handleButton, handleJumpButton, handleJumpModal, handleSelectMenu };
