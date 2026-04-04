'use strict';

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { fetchMetaDecks, fetchDeckDetail, fetchDecklist, deckUrl, cacheAge } = require('../ptcgp/metaScraper');
const { getSetName } = require('../ptcgp/setNames');
const { typeSprite } = require('../ptcgp/sprites');
const cardDb = require('../ptcgp/cardDb');
const { resolveImagePath } = cardDb;

const PAGE_SIZE = 10;

// ── Embed builder ─────────────────────────────────────────────────────────────

function buildListEmbed(decks, page, setId) {
  const totalPages = Math.ceil(decks.length / PAGE_SIZE);
  page = Math.max(0, Math.min(page, totalPages - 1));
  const slice = decks.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const setLabel = setId
    ? (() => {
        const zh = getSetName(setId, 'zh');
        const en = getSetName(setId, 'en');
        return zh !== setId ? `${zh} / ${en} (${setId})` : `${en} (${setId})`;
      })()
    : 'Standard';

  const lines = slice.map(d => {
    const rec = `${d.w}-${d.l}-${d.t}`;
    return `**${d.rank}.** ${d.name}\n` +
           `\`${String(d.count).padStart(4)} 場 · ${d.share.padEnd(6)} · Win ${d.winRate} (${rec})\``;
  });

  const embed = new EmbedBuilder()
    .setTitle(`📊 PTCGP Meta · ${setLabel}`)
    .setDescription(lines.join('\n\n') || '（無資料）')
    .setColor(0xE8C435)
    .setFooter({ text: `第 ${page + 1} / ${totalPages} 頁 · 資料更新: ${cacheAge(setId)} · Limitless TCG` })
    .setURL(`https://play.limitlesstcg.com/decks?game=pocket${setId ? `&set=${setId}` : ''}`);

  return { embed, page, totalPages };
}

// ── Select menu ───────────────────────────────────────────────────────────────

function buildDeckSelectRow(decks, page, cacheId) {
  const slice = decks.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const options = slice.map(d => ({
    label: `#${d.rank} ${d.name}`.slice(0, 100),
    description: `${d.share} · Win ${d.winRate} (${d.w}-${d.l}-${d.t})`.slice(0, 100),
    value: `${cacheId}::${d.slug}`,
  }));

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`mp_deck|${cacheId}`)
    .setPlaceholder('選擇牌組查看詳情 / Select a deck for details')
    .addOptions(options);

  return new ActionRowBuilder().addComponents(menu);
}

// ── Nav row ───────────────────────────────────────────────────────────────────

function buildNavRow(cacheId, page, totalPages) {
  const prev = new ButtonBuilder()
    .setCustomId(`mp_page|${cacheId}|${page - 1}`)
    .setLabel('◀ 上一頁').setStyle(ButtonStyle.Secondary).setDisabled(page === 0);
  const next = new ButtonBuilder()
    .setCustomId(`mp_page|${cacheId}|${page + 1}`)
    .setLabel('下一頁 ▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1);
  const jump = new ButtonBuilder()
    .setCustomId(`mp_jump|${cacheId}`)
    .setLabel('跳頁 / Go to page').setStyle(ButtonStyle.Primary);
  return new ActionRowBuilder().addComponents(prev, next, jump);
}

// ── Result cache ──────────────────────────────────────────────────────────────

// cacheId → { decks, setId, fetchedAt }
const resultCache = new Map();
const RESULT_TTL  = 15 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of resultCache) {
    if (now - v.fetchedAt > RESULT_TTL) resultCache.delete(k);
  }
}, 5 * 60 * 1000);

// ── Command ───────────────────────────────────────────────────────────────────

const data = new SlashCommandBuilder()
  .setName('meta_pocket')
  .setDescription('PTCGP 當前強勢牌組 / Browse PTCGP meta decks from Limitless TCG')
  .addStringOption(opt =>
    opt.setName('set')
      .setDescription('賽制篩選 / Filter by set (e.g. B2b, A4b) — default: current standard')
      .setRequired(false)
      .setAutocomplete(true),
  )
  .addStringOption(opt =>
    opt.setName('lang')
      .setDescription('卡牌語言 / Card language for names & images — default: CHT')
      .setRequired(false)
      .addChoices(
        { name: '繁體中文 (CHT)', value: 'zh' },
        { name: '日本語 (JPN)',   value: 'ja' },
        { name: 'English (EN)',   value: 'en' },
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
      const zh = getSetName(s.id, 'zh');
      const en = getSetName(s.id, 'en');
      const label = zh !== s.id ? `${zh} / ${en} (${s.id})` : `${en} (${s.id})`;
      return { name: label.slice(0, 100), value: s.id };
    }),
  );
}

// ── Execute ───────────────────────────────────────────────────────────────────

async function execute(interaction) {
  // Guard against stale interactions (Discord's 3-second window)
  if (Date.now() - interaction.createdTimestamp > 2500) return;
  try {
    await interaction.deferReply();
  } catch (err) {
    if (err.code === 10062) return; // Unknown interaction — already expired
    throw err;
  }

  const setId = interaction.options.getString('set') ?? null;
  const lang  = interaction.options.getString('lang') ?? 'zh';

  let decks;
  try {
    decks = await fetchMetaDecks(setId);
  } catch (err) {
    console.error('[meta_pocket]', err);
    return interaction.editReply({ content: '❌ 無法取得資料，請稍後再試。/ Failed to fetch meta data.' });
  }

  if (!decks.length) {
    return interaction.editReply({ content: `❌ 找不到資料 / No data found${setId ? ` for set ${setId}` : ''}.` });
  }

  const cacheId = interaction.id;
  resultCache.set(cacheId, { decks, setId, lang, fetchedAt: Date.now() });

  const { embed, page, totalPages } = buildListEmbed(decks, 0, setId);
  const components = [
    ...(totalPages > 1 ? [buildNavRow(cacheId, page, totalPages)] : []),
    buildDeckSelectRow(decks, page, cacheId),
  ];
  await interaction.editReply({ embeds: [embed], components });
}

// ── Button handler (pagination) ───────────────────────────────────────────────

async function handleButton(interaction) {
  const [, cacheId, pageStr] = interaction.customId.split('|');
  const cached = resultCache.get(cacheId);
  if (!cached) {
    return interaction.reply({ content: '⏰ 結果已過期，請重新執行指令。/ Results expired, please run the command again.', flags: 64 });
  }

  const page = parseInt(pageStr, 10);
  const { decks, setId } = cached;
  const { embed, page: actualPage, totalPages } = buildListEmbed(decks, page, setId);
  const components = [
    ...(totalPages > 1 ? [buildNavRow(cacheId, actualPage, totalPages)] : []),
    buildDeckSelectRow(decks, actualPage, cacheId),
  ];
  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [embed], components });
}

// ── Jump button handler ───────────────────────────────────────────────────────

async function handleJumpButton(interaction) {
  const [, cacheId] = interaction.customId.split('|');
  const cached = resultCache.get(cacheId);
  if (!cached) {
    return interaction.reply({ content: '⏰ 結果已過期。/ Results expired.', flags: 64 });
  }
  const totalPages = Math.ceil(cached.decks.length / PAGE_SIZE);
  const modal = new ModalBuilder()
    .setCustomId(`mp_jump_modal|${cacheId}`)
    .setTitle('跳頁 / Go to page');
  const input = new TextInputBuilder()
    .setCustomId('mp_page_num')
    .setLabel(`頁碼 / Page number (1–${totalPages})`)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder(`1–${totalPages}`)
    .setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}

// ── Jump modal handler ────────────────────────────────────────────────────────

async function handleJumpModal(interaction) {
  const [, cacheId] = interaction.customId.split('|');
  const cached = resultCache.get(cacheId);
  if (!cached) {
    return interaction.reply({ content: '⏰ 結果已過期。/ Results expired.', flags: 64 });
  }

  const { decks, setId } = cached;
  const totalPages = Math.ceil(decks.length / PAGE_SIZE);
  const raw = interaction.fields.getTextInputValue('mp_page_num').trim();
  const num = parseInt(raw, 10);

  if (isNaN(num) || num < 1 || num > totalPages) {
    return interaction.reply({
      content: `❌ 請輸入 1–${totalPages} 之間的頁碼。/ Enter a page between 1 and ${totalPages}.`,
      flags: 64,
    });
  }

  const page = num - 1;
  const { embed, page: actualPage } = buildListEmbed(decks, page, setId);
  const components = [
    ...(totalPages > 1 ? [buildNavRow(cacheId, actualPage, totalPages)] : []),
    buildDeckSelectRow(decks, actualPage, cacheId),
  ];
  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [embed], components });
}

// ── Select menu handler (deck detail) ─────────────────────────────────────────

async function handleSelectMenu(interaction) {
  const value = interaction.values[0]; // '{cacheId}::{slug}'
  const sepIdx = value.indexOf('::');
  const cacheId = value.slice(0, sepIdx);
  const slug    = value.slice(sepIdx + 2);
  const cached  = resultCache.get(cacheId);
  const setId   = cached?.setId ?? null;
  const lang    = cached?.lang ?? 'zh';

  await interaction.deferReply();

  let detail;
  try {
    detail = await fetchDeckDetail(slug, setId);
  } catch (err) {
    console.error('[meta_pocket detail]', err);
    return interaction.editReply({ content: '❌ 無法取得牌組詳情。/ Failed to fetch deck detail.' });
  }

  const deck = cached?.decks.find(d => d.slug === slug);
  const title = deck?.name ?? slug;
  const url   = deckUrl(slug, setId);

  const { summary, results } = detail;

  // Fetch top result's decklist and enrich with cardDb
  const topResult = results.find(r => r.decklistUrl);
  let decklistPath = null;
  if (topResult?.decklistUrl) {
    try { decklistPath = new URL(topResult.decklistUrl).pathname; } catch { /* ignore */ }
  }

  // enriched card entries: { uid, count, type, displayName, set, num }
  let enriched = [];
  if (decklistPath) {
    try {
      const cards = await fetchDecklist(decklistPath);
      for (const c of cards) {
        const uid    = `${c.set}-${c.num}`;
        const dbCard = cardDb.getCard(uid);
        const names  = dbCard?.names ?? {};
        const displayName = names[lang] ?? names.zh ?? names.en ?? c.name;
        enriched.push({
          uid,
          count:       c.count,
          type:        dbCard?.type ?? null,
          displayName,
          set:         c.set,
          num:         c.num,
        });
      }
    } catch (e) {
      console.error('[meta_pocket decklist]', e.message);
    }
  }

  const pokeCards     = enriched.filter(c => c.type !== null);
  const trainerCards  = enriched.filter(c => c.type === null);

  const pokeLines    = pokeCards.map(c => `${c.count}× ${typeSprite(c.type)} ${c.displayName} \`${c.uid}\``);
  const trainerLines = trainerCards.map(c => `${c.count}× ${c.displayName} \`${c.uid}\``);

  const statsLine = summary
    ? `${summary.wins}勝 ${summary.losses}敗 ${summary.ties}平 · Win **${summary.winRate}**`
    : '—';

  const resultLines = results.slice(0, 4).map((r, i) => {
    const link = r.decklistUrl ? `[${r.player}](${r.decklistUrl})` : r.player;
    return `${i + 1}. ${link} · **${r.placement}** · ${r.record}`;
  });

  const fields = [
    { name: '總成績 / Overall', value: statsLine || '—', inline: false },
  ];
  if (pokeLines.length)    fields.push({ name: `寶可夢 / Pokémon (${pokeCards.length})`,    value: pokeLines.join('\n').slice(0, 1024),    inline: true });
  if (trainerLines.length) fields.push({ name: `訓練師 / Trainers (${trainerCards.length})`, value: trainerLines.join('\n').slice(0, 1024), inline: true });

  const resultsLabel = topResult
    ? `最近賽績 / Recent Results (${topResult.player} 的牌組)`
    : '最近賽績 / Recent Results';
  fields.push({ name: resultsLabel, value: (resultLines.join('\n') || '—').slice(0, 1024), inline: false });

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setURL(url)
    .setColor(0xE8C435)
    .addFields(...fields)
    .setFooter({ text: 'Limitless TCG · PTCGP' });

  // Card select menu — lets user pick any card to view its image
  const components = [];
  if (enriched.length) {
    const options = enriched.slice(0, 25).map(c => ({
      label: `${c.count}× ${c.displayName} (${c.uid})`.slice(0, 100),
      value: c.uid,
    }));
    const menu = new StringSelectMenuBuilder()
      .setCustomId('mp_cardview')
      .setPlaceholder('選卡查看圖片 / Select a card to view image')
      .addOptions(options);
    components.push(new ActionRowBuilder().addComponents(menu));
  }

  // Generate card grid image if we have a decklist
  let deckImgAttachment = null;
  if (enriched.length) {
    try {
      const imgBuf = await buildDeckImage(enriched, lang);
      deckImgAttachment = new AttachmentBuilder(imgBuf, { name: 'deck.png' });
      embed.setImage('attachment://deck.png');
    } catch (e) {
      console.error('[meta_pocket deckImage]', e.message);
    }
  }

  const replyPayload = { embeds: [embed], components };
  if (deckImgAttachment) replyPayload.files = [deckImgAttachment];
  await interaction.editReply(replyPayload);
}

// ── Card image viewer (from decklist dropdown) ────────────────────────────────

const fs = require('fs');
const { AttachmentBuilder } = require('discord.js');
const { rarityDisplay } = require('../ptcgp/sprites');
const { buildDeckImage } = require('../ptcgp/deckImage');

async function handleCardView(interaction) {
  const uid  = interaction.values[0];
  const card = cardDb.getCard(uid);
  if (!card) return interaction.reply({ content: '❌ Card not found.', flags: 64 });

  // Pick image — try zh_TW first
  const LANG_ORDER = ['zh_TW', 'en_US', 'ja_JP'];
  const imagePath = LANG_ORDER.map(l => resolveImagePath(card.images?.[l])).find(p => p && fs.existsSync(p));
  if (!imagePath) return interaction.reply({ content: '⚠ Image not found.', flags: 64 });

  await interaction.deferReply({ flags: 64 });

  const zhSet = getSetName(card.set, 'zh');
  const enSet = getSetName(card.set, 'en');
  const setDisplay = zhSet !== card.set ? `${zhSet} / ${enSet} (${card.set})` : `${enSet} (${card.set})`;

  const allNames = [
    card.names.zh ? `繁中: **${card.names.zh}**` : null,
    card.names.en ? `EN: **${card.names.en}**`   : null,
    card.names.ja ? `JP: **${card.names.ja}**`   : null,
  ].filter(Boolean).join('\n');

  const attachment = new AttachmentBuilder(imagePath, { name: 'card.png' });
  const embed = new EmbedBuilder()
    .setTitle(card.names.zh || card.names.en || uid)
    .setDescription(allNames || null)
    .addFields(
      { name: '系列 / Set',      value: setDisplay,      inline: false },
      { name: '卡號 / Number',   value: `#${String(card.num).padStart(3, '0')}`, inline: true },
      { name: '稀有度 / Rarity', value: rarityDisplay(card), inline: true },
      { name: '屬性 / Type',     value: typeSprite(card.type), inline: true },
    )
    .setImage('attachment://card.png')
    .setColor(0xE8C435)
    .setFooter({ text: `PTCGP · ${card.uid}` });

  await interaction.editReply({ embeds: [embed], files: [attachment] });
}

// ── Export ────────────────────────────────────────────────────────────────────

module.exports = { data, autocomplete, execute, handleButton, handleJumpButton, handleJumpModal, handleSelectMenu, handleCardView };
