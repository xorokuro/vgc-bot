'use strict';

/**
 * /search_card — Advanced filter search for PTCGP cards with paginated results.
 *
 * Supported syntax:
 *   type = Grass | hp >= 50 | rarity = SR | set = A1 | name = pikachu
 *   AND | OR (case-insensitive)
 *   Grouping with ( )
 *
 * Example: hp >= 70 AND (type = Dark OR type = Psychic)
 */

const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder } = require('discord.js');
const fs     = require('fs');
const cardDb = require('../ptcgp/cardDb');
const { typeSprite, raritySprite, rarityDisplay } = require('../ptcgp/sprites');
const { getSetName } = require('../ptcgp/setNames');

const PAGE_SIZE = 10;

// ── In-memory result cache (expires after 15 min) ─────────────────────────────

const resultCache = new Map(); // cacheId → { results, parsedDesc, expires }

function cacheResults(id, results, parsedDesc) {
  // Prune expired entries
  const now = Date.now();
  for (const [k, v] of resultCache) {
    if (v.expires < now) resultCache.delete(k);
  }
  resultCache.set(id, { results, parsedDesc, expires: now + 15 * 60 * 1000 });
}

// ── Type alias normalisation ──────────────────────────────────────────────────

const TYPE_ALIASES = {
  dark:      'Darkness',
  darkness:  'Darkness',
  '惡':      'Darkness',
  '悪':      'Darkness',
  fighting:  'Fighting',
  '鬥':      'Fighting',
  '闘':      'Fighting',
  lightning: 'Lightning',
  electric:  'Lightning',
  thunder:   'Lightning',
  '雷':      'Lightning',
  colorless: 'Colorless',
  normal:    'Colorless',
  '無色':    'Colorless',
  '無':      'Colorless',
  steel:     'Metal',
  metal:     'Metal',
  '鋼':      'Metal',
  dragon:    'Dragon',
  '龍':      'Dragon',
  psychic:   'Psychic',
  '超':      'Psychic',
  grass:     'Grass',
  '草':      'Grass',
  fire:      'Fire',
  '炎':      'Fire',
  '火':      'Fire',
  water:     'Water',
  '水':      'Water',
};

function normalizeType(raw) {
  return TYPE_ALIASES[raw.toLowerCase()] ?? TYPE_ALIASES[raw] ?? raw;
}

// ── Tokeniser ─────────────────────────────────────────────────────────────────

const TOKEN_RE = /\(|\)|AND|OR|!=|>=|<=|>|<|=|[\w\u4e00-\u9fff\u3040-\u30ff\u3400-\u4dbf\uff00-\uffef\u2600-\u26ff\u2700-\u27bff\u00c0-\u024f\u00e9\-\.]+/gi;

function tokenise(expr) {
  const tokens = [];
  let m;
  while ((m = TOKEN_RE.exec(expr)) !== null) {
    tokens.push(m[0]);
  }
  return tokens;
}

// ── Recursive-descent parser ──────────────────────────────────────────────────

class ParseError extends Error {}

function parse(expr) {
  const tokens = tokenise(expr);
  let pos = 0;

  function peek() { return tokens[pos]; }
  function consume() { return tokens[pos++]; }

  function parseExpr() {
    let left = parseTerm();
    while (peek() && /^(AND|OR)$/i.test(peek())) {
      const op    = consume().toUpperCase();
      const right = parseTerm();
      const lCopy = left;
      if (op === 'AND') {
        left = card => lCopy(card) && right(card);
        left._desc = `(${lCopy._desc} AND ${right._desc})`;
      } else {
        left = card => lCopy(card) || right(card);
        left._desc = `(${lCopy._desc} OR ${right._desc})`;
      }
    }
    return left;
  }

  function parseTerm() {
    if (peek() === '(') {
      consume();
      const inner = parseExpr();
      if (peek() !== ')') throw new ParseError('Expected ")"');
      consume();
      return inner;
    }
    return parseComparison();
  }

  function parseComparison() {
    const field = consume();
    if (!field) throw new ParseError('Expected field name');
    const op = consume();
    if (!op || !/^(=|!=|>=|<=|>|<)$/.test(op)) {
      throw new ParseError(`Expected operator after "${field}", got "${op ?? 'end of input'}"`);
    }
    const val = consume();
    if (!val) throw new ParseError(`Expected value after "${field} ${op}"`);
    return buildPredicate(field.toLowerCase(), op, val);
  }

  const predFn = parseExpr();
  if (pos < tokens.length) throw new ParseError(`Unexpected token: "${tokens[pos]}"`);
  return predFn;
}

// ── Predicate builder ─────────────────────────────────────────────────────────

const RARITY_ORDER = { C:1, U:2, R:3, RR:4, AR:5, SR:6, SAR:7, IM:8, S:9, SSR:10, UR:11 };

function buildPredicate(field, op, rawVal) {
  const val = rawVal.toLowerCase();

  function numCmp(cardNum) {
    const n = parseFloat(rawVal);
    if (isNaN(n)) throw new ParseError(`"${rawVal}" is not a number`);
    switch (op) {
      case '=':  return cardNum === n;
      case '!=': return cardNum !== n;
      case '>':  return cardNum > n;
      case '>=': return cardNum >= n;
      case '<':  return cardNum < n;
      case '<=': return cardNum <= n;
      default:   return false;
    }
  }

  function strEq(a, b) {
    if (op === '=')  return a.toLowerCase() === b.toLowerCase();
    if (op === '!=') return a.toLowerCase() !== b.toLowerCase();
    throw new ParseError(`Operator "${op}" is not valid for text comparison`);
  }

  let pred, desc;

  switch (field) {
    case 'type': {
      const canonical = normalizeType(rawVal);
      pred = card => {
        if (!card.type) return strEq('Trainer', rawVal) || strEq('Trainer', canonical);
        return strEq(card.type, canonical);
      };
      desc = `type ${op} ${canonical}`;
      break;
    }
    case 'hp': {
      pred = card => { const hp = card.hp ?? null; if (hp === null) return false; return numCmp(hp); };
      desc = `hp ${op} ${rawVal}`;
      break;
    }
    case 'rarity': {
      const valUpper = rawVal.toUpperCase();
      if (op === '=' || op === '!=') {
        pred = card => strEq(card.rarity ?? '', valUpper);
      } else {
        const rank = RARITY_ORDER[valUpper];
        if (!rank) throw new ParseError(`Unknown rarity: "${rawVal}"`);
        pred = card => { const cr = RARITY_ORDER[card.rarity ?? '']; if (!cr) return false; return numCmp(cr); };
      }
      desc = `rarity ${op} ${valUpper}`;
      break;
    }
    case 'set': {
      pred = card => strEq(card.set ?? '', rawVal);
      desc = `set ${op} ${rawVal.toUpperCase()}`;
      break;
    }
    case 'name': {
      pred = card => {
        const q = val;
        const { zh='', ja='', en='' } = card.names;
        if (op === '=')  return zh.toLowerCase().includes(q) || ja.toLowerCase().includes(q) || en.toLowerCase().includes(q);
        if (op === '!=') return !zh.toLowerCase().includes(q) && !ja.toLowerCase().includes(q) && !en.toLowerCase().includes(q);
        throw new ParseError(`Operator "${op}" is not valid for name`);
      };
      desc = `name ${op} ${rawVal}`;
      break;
    }
    case 'num':
    case 'number': {
      pred = card => numCmp(card.num ?? 0);
      desc = `num ${op} ${rawVal}`;
      break;
    }
    case 'category': {
      pred = card => strEq((card.category ?? '').toLowerCase(), rawVal.toLowerCase());
      desc = `category ${op} ${rawVal}`;
      break;
    }
    default:
      throw new ParseError(`Unknown field: "${field}". Valid fields: type, hp, rarity, set, name, num, category`);
  }

  pred._desc = desc;
  return pred;
}

// ── Display helpers ───────────────────────────────────────────────────────────

function formatCardLine(card) {
  const typeStr = typeSprite(card.type);
  const rarStr  = raritySprite(card.rarity);
  const name    = card.names.zh || card.names.en || '(unknown)';
  const hpStr   = card.hp != null ? ` HP:${card.hp}` : '';
  return `\`${card.uid}\` ${typeStr} **${name}**  ${rarStr} ${card.rarity}${hpStr}`;
}

// ── Embed / nav builders ──────────────────────────────────────────────────────

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

  // Nav row (only when multiple pages)
  if (totalPages > 1) {
    const prev = new ButtonBuilder()
      .setCustomId(`sc_page|${cacheId}|${page - 1}`)
      .setLabel('◀ 上一頁')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0);
    const next = new ButtonBuilder()
      .setCustomId(`sc_page|${cacheId}|${page + 1}`)
      .setLabel('下一頁 ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1);
    const jump = new ButtonBuilder()
      .setCustomId(`sc_jump|${cacheId}`)
      .setLabel('跳頁 / Go to page')
      .setStyle(ButtonStyle.Primary);
    components.push(new ActionRowBuilder().addComponents(prev, next, jump));
  }

  // Card select menu
  const options = slice.map(c => {
    const name  = c.names.zh || c.names.en || '—';
    const type  = typeSprite(c.type);
    const rar   = raritySprite(c.rarity);
    const label = `${c.uid} ${name}  ${c.rarity}`.slice(0, 100);
    const description = (card => {
      const parts = [];
      if (card.hp != null) parts.push(`HP ${card.hp}`);
      if (card.weakness) parts.push(`弱點 ${card.weakness.type} ${card.weakness.value}`);
      return parts.join(' · ') || undefined;
    })(c);
    return { label, value: c.uid, description };
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`sc_card|${cacheId}`)
    .setPlaceholder('選卡查看詳情 / Select a card to view details')
    .addOptions(options);
  components.push(new ActionRowBuilder().addComponents(menu));

  return { embed, components, page, totalPages };
}

// ── Command definition ────────────────────────────────────────────────────────

const data = new SlashCommandBuilder()
  .setName('search_card')
  .setDescription('進階搜尋 PTCGP 卡牌 / Advanced card filter search')
  .addStringOption(opt =>
    opt
      .setName('query')
      .setDescription('篩選條件 / Filter expression (e.g. type = Grass AND rarity = R)')
      .setRequired(true),
  );

// ── Execute ───────────────────────────────────────────────────────────────────

async function execute(interaction) {
  if (!cardDb.isReady()) {
    return interaction.reply({ content: '⚠ Database not ready.', flags: 64 });
  }

  const raw = interaction.options.getString('query');

  let predFn, parsedDesc;
  try {
    predFn     = parse(raw);
    parsedDesc = predFn._desc ?? raw;
  } catch (err) {
    const embed = new EmbedBuilder()
      .setTitle('❌ 語法錯誤 / Query Syntax Error')
      .setDescription([
        `**Error:** ${err.message}`,
        '',
        '**Examples:**',
        '`type = Grass`',
        '`hp >= 70`',
        '`rarity = SR`',
        '`set = A1`',
        '`name = pikachu`',
        '`hp >= 70 AND (type = Darkness OR type = Psychic)`',
        '',
        '**Fields:** `type`, `hp`, `rarity`, `set`, `name`, `num`, `category`',
        '**Operators:** `=` `!=` `>` `>=` `<` `<=`',
        '**Logic:** `AND` `OR`, grouping with `( )`',
      ].join('\n'))
      .setColor(0xFF4444);
    return interaction.reply({ embeds: [embed], flags: 64 });
  }

  await interaction.deferReply();

  const results = cardDb.filterCards(predFn, 9999);

  if (results.length === 0) {
    const embed = new EmbedBuilder()
      .setTitle('找不到符合條件的卡牌 / No cards match your filter.')
      .setDescription('請調整搜尋條件後再試。')
      .setColor(0xFF4444)
      .setFooter({ text: `Query: ${parsedDesc}` });
    return interaction.editReply({ embeds: [embed] });
  }

  // Single result — show card image
  if (results.length === 1) {
    const card      = results[0];
    const imagePath = card.images?.zh_TW ?? card.images?.en_US ?? Object.values(card.images ?? {})[0];
    const embed = new EmbedBuilder()
      .setTitle('找到 1 張卡牌 / 1 card found')
      .setDescription(formatCardLine(card))
      .setColor(0xE8C435)
      .setFooter({ text: `Query: ${parsedDesc}` });
    if (imagePath && fs.existsSync(imagePath)) {
      const attachment = new AttachmentBuilder(imagePath, { name: 'card.png' });
      embed.setThumbnail('attachment://card.png');
      return interaction.editReply({ embeds: [embed], files: [attachment] });
    }
    return interaction.editReply({ embeds: [embed] });
  }

  // Multiple results — paginate
  const cacheId = interaction.id;
  cacheResults(cacheId, results, parsedDesc);
  const { embed, components } = buildPage(results, 0, parsedDesc, cacheId);
  return interaction.editReply({ embeds: [embed], components });
}

// ── Button handler ────────────────────────────────────────────────────────────

async function handleButton(interaction) {
  const [, cacheId, pageStr] = interaction.customId.split('|');
  const page  = parseInt(pageStr, 10);
  const entry = resultCache.get(cacheId);

  if (!entry) {
    return interaction.reply({
      content: '⏰ 搜尋結果已過期，請重新使用 `/search_card`。\nSearch expired — please run `/search_card` again.',
      flags: 64,
    });
  }

  await interaction.deferUpdate();
  const { embed, components } = buildPage(entry.results, page, entry.parsedDesc, cacheId);
  await interaction.editReply({ embeds: [embed], components });
}

// ── Select menu handler — card detail (ephemeral) ─────────────────────────────

async function handleSelectMenu(interaction) {
  const uid  = interaction.values[0];
  const card = cardDb.getCard(uid);
  if (!card) return interaction.reply({ content: '❌ Card not found.', flags: 64 });

  const imagePath = card.images?.zh_TW ?? card.images?.en_US ?? Object.values(card.images ?? {})[0];
  if (!imagePath || !fs.existsSync(imagePath)) {
    return interaction.reply({ content: '⚠ Image not found.', flags: 64 });
  }

  await interaction.deferReply({ flags: 64 });

  const allNames = [
    card.names.zh ? `繁中: **${card.names.zh}**` : null,
    card.names.en ? `EN: **${card.names.en}**`   : null,
    card.names.ja ? `JP: **${card.names.ja}**`   : null,
  ].filter(Boolean).join('\n');

  const zhSetName = getSetName(card.set, 'zh');
  const enSetName = getSetName(card.set, 'en');
  const setDisplay = zhSetName !== card.set
    ? `${zhSetName} / ${enSetName} (${card.set})`
    : `${enSetName} (${card.set})`;

  const weakStr = (card.weakness && card.weakness.type !== 'Colorless')
    ? `${typeSprite(card.weakness.type)} ${card.weakness.value}`
    : '—';

  const attachment = new AttachmentBuilder(imagePath, { name: 'card.png' });
  const embed = new EmbedBuilder()
    .setTitle(card.names.zh || card.names.en || uid)
    .setDescription(allNames || null)
    .addFields(
      { name: '系列 / Set',      value: setDisplay,                                      inline: false },
      { name: '卡號 / Number',   value: `#${String(card.num).padStart(3, '0')}`,         inline: true },
      { name: '稀有度 / Rarity', value: rarityDisplay(card),                              inline: true },
      { name: '屬性 / Type',     value: typeSprite(card.type),                            inline: true },
      { name: 'HP',              value: card.hp != null ? `${card.hp}` : '—',            inline: true },
      { name: '弱點 / Weakness', value: weakStr,                                          inline: true },
    )
    .setImage('attachment://card.png')
    .setColor(0xE8C435)
    .setFooter({ text: `PTCGP · ${card.uid}` });

  await interaction.editReply({ embeds: [embed], files: [attachment] });
}

// ── Jump button handler — shows a modal ───────────────────────────────────────

async function handleJumpButton(interaction) {
  const [, cacheId] = interaction.customId.split('|');
  const entry = resultCache.get(cacheId);
  if (!entry) {
    return interaction.reply({
      content: '⏰ 搜尋結果已過期，請重新使用 `/search_card`。\nSearch expired — please run `/search_card` again.',
      flags: 64,
    });
  }

  const totalPages = Math.ceil(entry.results.length / PAGE_SIZE);
  const modal = new ModalBuilder()
    .setCustomId(`sc_jump_modal|${cacheId}`)
    .setTitle(`跳頁 / Go to Page (1–${totalPages})`);
  const input = new TextInputBuilder()
    .setCustomId('page_num')
    .setLabel(`頁碼 / Page number (1–${totalPages})`)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder(`1–${totalPages}`)
    .setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}

// ── Jump modal submit handler ─────────────────────────────────────────────────

async function handleJumpModal(interaction) {
  const [, cacheId] = interaction.customId.split('|');
  const entry = resultCache.get(cacheId);
  if (!entry) {
    return interaction.reply({
      content: '⏰ 搜尋結果已過期，請重新使用 `/search_card`。\nSearch expired — please run `/search_card` again.',
      flags: 64,
    });
  }

  const totalPages = Math.ceil(entry.results.length / PAGE_SIZE);
  const raw  = interaction.fields.getTextInputValue('page_num').trim();
  const page = parseInt(raw, 10) - 1; // convert to 0-indexed

  if (isNaN(page) || page < 0 || page >= totalPages) {
    return interaction.reply({
      content: `❌ 無效頁碼 / Invalid page — enter a number between 1 and ${totalPages}.`,
      flags: 64,
    });
  }

  await interaction.deferUpdate();
  const { embed, components } = buildPage(entry.results, page, entry.parsedDesc, cacheId);
  await interaction.editReply({ embeds: [embed], components });
}

// ── Export ─────────────────────────────────────────────────────────────────────

module.exports = { data, execute, handleButton, handleSelectMenu, handleJumpButton, handleJumpModal };
