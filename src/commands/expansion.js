'use strict';

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  AttachmentBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const fs     = require('fs');
const cardDb = require('../ptcgp/cardDb');
const { resolveImagePath } = cardDb;
const { getSetName } = require('../ptcgp/setNames');
const { typeSprite, typeText, raritySprite } = require('../ptcgp/sprites');

const PAGE_SIZE = 10;

// ── Lang helpers ──────────────────────────────────────────────────────────────

const LANG_LABELS = {
  tw: { nameKey: 'zh', label: '繁中' },
  jp: { nameKey: 'ja', label: '日本語' },
  en: { nameKey: 'en', label: 'English' },
};

const LANG_KEYS = { tw: 'zh_TW', jp: 'ja_JP', en: 'en_US' };

// ── Embed builder ─────────────────────────────────────────────────────────────

function buildEmbed(setId, page, display) {
  const cards = cardDb.getSetCards(setId);
  if (!cards.length) return null;

  const totalPages = Math.ceil(cards.length / PAGE_SIZE);
  page = Math.max(0, Math.min(page, totalPages - 1));

  const { nameKey } = LANG_LABELS[display] ?? LANG_LABELS.tw;
  const slice = cards.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const zhName = getSetName(setId, 'zh');
  const enName = getSetName(setId, 'en');
  const title  = zhName !== setId ? `${zhName} (${setId})` : `${enName} (${setId})`;

  const lines = slice.map(c => {
    const name = c.names[nameKey] || c.names.en || c.names.zh || '—';
    const type = typeSprite(c.type);
    const rar  = raritySprite(c.rarity);
    return `\`#${String(c.num).padStart(3)}\` ${type} ${name}  ${rar}`;
  });

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(lines.join('\n'))
    .addFields(
      { name: '系列 / Set',    value: enName,              inline: true },
      { name: '共 / Total',    value: `${cards.length} 張`, inline: true },
    )
    .setColor(0xE8C435)
    .setFooter({ text: `第 ${page + 1} / ${totalPages} 頁 · PTCGP · ${setId}` });

  return { embed, page, totalPages };
}

// ── Card select menu ──────────────────────────────────────────────────────────

function buildCardSelectRow(setId, page, display) {
  const cards = cardDb.getSetCards(setId);
  const { nameKey } = LANG_LABELS[display] ?? LANG_LABELS.tw;
  const slice = cards.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const options = slice.map(c => {
    const name  = c.names[nameKey] || c.names.en || c.names.zh || '—';
    const type  = typeText(c.type);
    const label = `#${String(c.num).padStart(3)} ${type} ${name}`.slice(0, 100);
    return { label, value: c.uid };
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`exp_card|${setId}|${page}|${display}`)
    .setPlaceholder('選卡查看圖片 / Select a card to view')
    .addOptions(options);

  return new ActionRowBuilder().addComponents(menu);
}

// ── Navigation row ────────────────────────────────────────────────────────────

function buildNavRow(setId, page, totalPages, display) {
  const prev = new ButtonBuilder()
    .setCustomId(`exp_page|${setId}|${page - 1}|${display}`)
    .setLabel('◀ 上一頁')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page === 0);

  const next = new ButtonBuilder()
    .setCustomId(`exp_page|${setId}|${page + 1}|${display}`)
    .setLabel('下一頁 ▶')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page >= totalPages - 1);

  const jump = new ButtonBuilder()
    .setCustomId(`exp_jump|${setId}|${display}`)
    .setLabel('跳頁 / Go to page')
    .setStyle(ButtonStyle.Primary);

  return new ActionRowBuilder().addComponents(prev, next, jump);
}

// ── Command definition ────────────────────────────────────────────────────────

const data = new SlashCommandBuilder()
  .setName('expansion')
  .setDescription('瀏覽 PTCGP 擴充包卡表 / Browse PTCGP set card list')
  .addStringOption(opt =>
    opt
      .setName('set')
      .setDescription('選擇擴充包 / Choose expansion (e.g. A2, B2)')
      .setRequired(true)
      .setAutocomplete(true),
  )
  .addStringOption(opt =>
    opt
      .setName('display')
      .setDescription('卡名語言 / Card name language (default: 繁中)')
      .setRequired(false)
      .addChoices(
        { name: '繁中 (Traditional Chinese)', value: 'tw' },
        { name: 'English',                    value: 'en' },
        { name: '日本語 (Japanese)',           value: 'jp' },
      ),
  );

// ── Autocomplete ──────────────────────────────────────────────────────────────

async function autocomplete(interaction) {
  const query = interaction.options.getFocused().toLowerCase();
  const sets  = cardDb.getSets();

  const matches = sets.filter(s => {
    if (s.id === 'P-A' || s.id === 'P-B') return false;
    const zh = getSetName(s.id, 'zh').toLowerCase();
    const en = getSetName(s.id, 'en').toLowerCase();
    return s.id.toLowerCase().includes(query) || zh.includes(query) || en.includes(query);
  });

  await interaction.respond(
    matches.slice(0, 25).map(s => {
      const zh    = getSetName(s.id, 'zh');
      const en    = getSetName(s.id, 'en');
      const label = zh !== s.id
        ? `${zh} / ${en} (${s.id})`
        : `${en} (${s.id})`;
      return { name: label.slice(0, 100), value: s.id };
    }),
  );
}

// ── Execute ───────────────────────────────────────────────────────────────────

async function execute(interaction) {
  if (!cardDb.isReady()) {
    return interaction.reply({ content: '⚠ Database not ready.', flags: 64 });
  }

  const raw     = interaction.options.getString('set');
  const sets    = cardDb.getSets();
  const matched = sets.find(s => s.id.toLowerCase() === raw.toLowerCase());
  const setId   = matched?.id ?? raw.toUpperCase();
  const display = interaction.options.getString('display') ?? 'tw';

  const result = buildEmbed(setId, 0, display);
  if (!result) {
    return interaction.reply({ content: `❌ 找不到擴充包 / Set not found: **${setId}**`, flags: 64 });
  }

  const { embed, totalPages, page } = result;
  const components = [
    ...(totalPages > 1 ? [buildNavRow(setId, page, totalPages, display)] : []),
    buildCardSelectRow(setId, page, display),
  ];
  await interaction.reply({ embeds: [embed], components });
}

// ── Button handler ────────────────────────────────────────────────────────────

async function handleButton(interaction) {
  const [, setId, pageStr, display] = interaction.customId.split('|');
  const page = parseInt(pageStr, 10);

  const result = buildEmbed(setId, page, display ?? 'tw');
  if (!result) {
    return interaction.reply({ content: '❌ Error loading page.', flags: 64 });
  }

  await interaction.deferUpdate();
  const { embed, totalPages, page: actualPage } = result;
  const disp = display ?? 'tw';
  const components = [
    ...(totalPages > 1 ? [buildNavRow(setId, actualPage, totalPages, disp)] : []),
    buildCardSelectRow(setId, actualPage, disp),
  ];
  await interaction.editReply({ embeds: [embed], components });
}

// ── Select menu handler ───────────────────────────────────────────────────────

async function handleSelectMenu(interaction) {
  const uid     = interaction.values[0];
  const display = interaction.customId.split('|')[3] ?? 'tw';
  const card    = cardDb.getCard(uid);

  if (!card) {
    return interaction.reply({ content: '❌ Card not found.', flags: 64 });
  }

  const langKey   = LANG_KEYS[display] ?? 'zh_TW';
  const imagePath = resolveImagePath(card.images?.[langKey] ?? Object.values(card.images ?? {})[0]);

  if (!imagePath || !fs.existsSync(imagePath)) {
    return interaction.reply({ content: '⚠ Image not found.', flags: 64 });
  }

  await interaction.deferReply({ flags: 64 });

  const { nameKey } = LANG_LABELS[display] ?? LANG_LABELS.tw;
  const mainName = card.names[nameKey] || card.names.en || card.names.zh || '(unknown)';
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

  const attachment = new AttachmentBuilder(imagePath, { name: 'card.png' });
  const embed = new EmbedBuilder()
    .setTitle(mainName)
    .setDescription(allNames || null)
    .addFields(
      { name: '系列 / Set',      value: setDisplay,      inline: false },
      { name: '卡號 / Number',   value: `#${String(card.num).padStart(3, '0')}`, inline: true },
      { name: '稀有度 / Rarity', value: card.raritySymbol ?? card.rarity ?? '—', inline: true },
      { name: '屬性 / Type',     value: typeSprite(card.type), inline: true },
    )
    .setImage('attachment://card.png')
    .setColor(0xE8C435)
    .setFooter({ text: `PTCGP · ${card.uid}` });

  await interaction.editReply({ embeds: [embed], files: [attachment] });
}

// ── Jump button handler ───────────────────────────────────────────────────────

async function handleJumpButton(interaction) {
  const [, setId, display] = interaction.customId.split('|');
  const cards = cardDb.getSetCards(setId);
  const totalPages = Math.ceil(cards.length / PAGE_SIZE);

  const modal = new ModalBuilder()
    .setCustomId(`exp_jump_modal|${setId}|${display}`)
    .setTitle('跳頁 / Go to page');
  const input = new TextInputBuilder()
    .setCustomId('exp_page_num')
    .setLabel(`頁碼 / Page number (1–${totalPages})`)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder(`1–${totalPages}`)
    .setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}

// ── Jump modal handler ────────────────────────────────────────────────────────

async function handleJumpModal(interaction) {
  const [, setId, display] = interaction.customId.split('|');
  const disp = display ?? 'tw';
  const raw = interaction.fields.getTextInputValue('exp_page_num').trim();
  const num = parseInt(raw, 10);

  const cards = cardDb.getSetCards(setId);
  const totalPages = Math.ceil(cards.length / PAGE_SIZE);

  if (isNaN(num) || num < 1 || num > totalPages) {
    return interaction.reply({
      content: `❌ 請輸入 1–${totalPages} 之間的頁碼 / Please enter a page number between 1 and ${totalPages}.`,
      flags: 64,
    });
  }

  const page = num - 1;
  const result = buildEmbed(setId, page, disp);
  if (!result) return interaction.reply({ content: '❌ Error loading page.', flags: 64 });

  await interaction.deferUpdate();
  const { embed, totalPages: tp, page: actualPage } = result;
  const components = [
    ...(tp > 1 ? [buildNavRow(setId, actualPage, tp, disp)] : []),
    buildCardSelectRow(setId, actualPage, disp),
  ];
  await interaction.editReply({ embeds: [embed], components });
}

// ── Export ────────────────────────────────────────────────────────────────────

module.exports = { data, autocomplete, execute, handleButton, handleJumpButton, handleJumpModal, handleSelectMenu };
