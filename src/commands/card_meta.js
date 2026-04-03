'use strict';

/**
 * /card_meta — Find which meta decks contain a specific card.
 *
 * Flow:
 *  1. User types card name → autocomplete from cardDb
 *  2. Bot shows card image + "Search Meta Decks" button (+ optional set filter)
 *  3. User clicks button → bot scans top meta decks, shows matched archetypes
 *     with a select menu to open full deck detail (card grid image, like /meta_pocket)
 */

const {
  SlashCommandBuilder, EmbedBuilder, AttachmentBuilder,
  ButtonBuilder, ButtonStyle, ActionRowBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');
const fs      = require('fs');
const cardDb  = require('../ptcgp/cardDb');
const { getSetName }    = require('../ptcgp/setNames');
const { typeSprite, rarityDisplay } = require('../ptcgp/sprites');
const { buildDeckImage }            = require('../ptcgp/deckImage');
const {
  fetchMetaDecks, fetchDeckDetail, fetchDecklist, deckUrl,
} = require('../ptcgp/metaScraper');

const MAX_DECKS         = 25;  // used for single-set search
const MAX_DECKS_PER_SET = 8;   // used for all-expansions search

const SKIP_SETS_ALL = new Set(['A4b']);
const ALL_SET_IDS   = cardDb.getSets()
  .map(s => s.id)
  .filter(id => !/^P-/.test(id) && !SKIP_SETS_ALL.has(id))
  .reverse(); // newest first

// ── Caches ────────────────────────────────────────────────────────────────────

// Pending confirm state: interactionId → { uid, setId, expires }
const pending = new Map();

// Results cache: interactionId → { matches, setId, lang, expires }
const resultsCache = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pending)      if (v.expires < now) pending.delete(k);
  for (const [k, v] of resultsCache) if (v.expires < now) resultsCache.delete(k);
}, 5 * 60 * 1000);

// ── Helpers ───────────────────────────────────────────────────────────────────

function cardDisplayName(card) {
  return card.names.zh || card.names.en || card.uid;
}

function setLabel(setId) {
  if (!setId) return 'Standard';
  const zh = getSetName(setId, 'zh');
  const en = getSetName(setId, 'en');
  return zh !== setId ? `${zh} / ${en} (${setId})` : `${en} (${setId})`;
}

const LANG_IMAGE_KEY = { zh: 'zh_TW', en: 'en_US', ja: 'ja_JP' };

function buildCardEmbed(card, lang = 'zh') {
  const names = [
    card.names.zh ? `繁中: **${card.names.zh}**` : null,
    card.names.en ? `EN: **${card.names.en}**`   : null,
    card.names.ja ? `JP: **${card.names.ja}**`   : null,
  ].filter(Boolean).join('\n');

  const displayName = card.names[lang] || card.names.zh || card.names.en || card.uid;

  return new EmbedBuilder()
    .setTitle(`${displayName} (${card.uid})`)
    .setDescription(names || null)
    .addFields(
      { name: '系列 / Set',  value: setLabel(card.set),                    inline: true },
      { name: '屬性 / Type', value: typeSprite(card.type),                 inline: true },
      { name: 'HP',          value: card.hp != null ? `${card.hp}` : '—', inline: true },
    )
    .setImage('attachment://card.png')
    .setColor(0xE8C435)
    .setFooter({ text: 'PTCGP · 確認後點擊按鈕搜尋 / Confirm and click to search' });
}

// ── Canonical card resolution ─────────────────────────────────────────────────

const SKIP_SETS = new Set(['A4b']); // reprint-only sets, excluded from search

/**
 * Return ALL versions of a card across every set (one lowest-num per set),
 * so the decklist match works regardless of which set version Limitless references.
 * - Trainer cards: all sets including promos (Limitless may reference any version)
 * - Pokémon cards: one per non-promo set (promos don't appear in booster metas)
 */
function getSearchVariants(card) {
  const targetName = card.names.en || card.names.zh || '';
  if (!targetName) return [{ set: card.set, num: card.num }];

  const isTrainer = card.type === null;
  const bySet = new Map();

  for (const { id: setId } of cardDb.getSets()) {
    if (SKIP_SETS.has(setId)) continue;
    if (!isTrainer && /^P-/.test(setId)) continue; // promos don't appear in Pokémon booster metas
    const hits = cardDb.getSetCards(setId).filter(c =>
      c.type === card.type &&
      (isTrainer || c.hp === card.hp) &&
      (c.names.en || c.names.zh || '') === targetName,
    );
    if (!hits.length) continue;
    hits.sort((a, b) => a.num - b.num);
    bySet.set(setId, { set: setId, num: hits[0].num });
  }

  return bySet.size ? [...bySet.values()] : [{ set: card.set, num: card.num }];
}

// ── Meta deck search ──────────────────────────────────────────────────────────

// Search ALL expansion metas (same approach as deck_search.js)
async function searchAllExpansions(variants) {
  const setDecks = await Promise.all(
    ALL_SET_IDS.map(async setId => {
      try {
        const decks = await fetchMetaDecks(setId);
        return { setId, decks: decks.slice(0, MAX_DECKS_PER_SET) };
      } catch { return { setId, decks: [] }; }
    }),
  );

  const slugFirstSet = new Map();
  const allEntries   = [];
  for (const { setId, decks } of setDecks) {
    for (const d of decks) {
      allEntries.push({ rank: d.rank, name: d.name, slug: d.slug, winRate: d.winRate, share: d.share, setId });
      if (!slugFirstSet.has(d.slug)) slugFirstSet.set(d.slug, setId);
    }
  }

  const slugToCards = new Map();
  await Promise.all(
    [...slugFirstSet.entries()].map(async ([slug, setId]) => {
      try {
        const detail = await fetchDeckDetail(slug, setId);
        const first  = detail?.results?.find(r => r.decklistUrl);
        if (!first?.decklistUrl) return;
        const cards = await fetchDecklist(new URL(first.decklistUrl).pathname).catch(() => null);
        if (cards) slugToCards.set(slug, cards);
      } catch { /* skip */ }
    }),
  );

  const dlHas = (dl, vars) => vars.some(v => dl.some(c => c.set === v.set && c.num === v.num));

  const matches = [];
  for (const entry of allEntries) {
    const dl = slugToCards.get(entry.slug);
    if (!dl || !dlHas(dl, variants)) continue;
    const hit = dl.find(c => variants.some(v => c.set === v.set && c.num === v.num));
    matches.push({ ...entry, count: hit?.count ?? 1 });
  }

  const setsWithData = setDecks.filter(s => s.decks.length > 0).length;
  return { matches, scanned: allEntries.length, setsSearched: setsWithData };
}

// Search a single meta set — variants = [{ set, num }, ...] — match any of these in a decklist
async function searchMetaDecks(variants, metaSetId) {
  const decks = await fetchMetaDecks(metaSetId);
  const top   = decks.slice(0, MAX_DECKS);

  const details = await Promise.all(
    top.map(d => fetchDeckDetail(d.slug, metaSetId).catch(() => null)),
  );

  const decklists = await Promise.all(
    details.map(detail => {
      const first = detail?.results?.find(r => r.decklistUrl);
      if (!first?.decklistUrl) return Promise.resolve(null);
      try {
        const pathname = new URL(first.decklistUrl).pathname;
        return fetchDecklist(pathname).catch(() => null);
      } catch { return Promise.resolve(null); }
    }),
  );

  const dlHas = (dl, vars) => vars.some(v => dl.some(c => c.set === v.set && c.num === v.num));

  const matches = [];
  for (let i = 0; i < top.length; i++) {
    const dl = decklists[i];
    if (!dl) continue;
    const entry = dlHas(dl, variants)
      ? dl.find(c => variants.some(v => c.set === v.set && c.num === v.num))
      : null;
    if (entry) {
      matches.push({
        rank:    top[i].rank,
        name:    top[i].name,
        slug:    top[i].slug,
        count:   entry.count,
        winRate: top[i].winRate,
        share:   top[i].share,
      });
    }
  }
  return { matches, scanned: top.length };
}

// ── Command definition ────────────────────────────────────────────────────────

const data = new SlashCommandBuilder()
  .setName('card_meta')
  .setDescription('尋找含有某張卡的主流牌組 / Find meta decks containing a specific card')
  .addStringOption(opt =>
    opt.setName('card')
      .setDescription('搜尋卡牌名稱或ID / Search card name or UID (e.g. Gengar, A3a-046)')
      .setRequired(true)
      .setAutocomplete(true),
  )
  .addStringOption(opt =>
    opt.setName('set')
      .setDescription('賽制篩選 / Filter meta by set (e.g. B2b) — default: All Expansions')
      .setRequired(false)
      .setAutocomplete(true),
  )
  .addStringOption(opt =>
    opt.setName('display')
      .setDescription('卡名語言 / Card name language in results (default: 繁中)')
      .setRequired(false)
      .addChoices(
        { name: '繁中 (Traditional Chinese)', value: 'zh' },
        { name: 'English',                    value: 'en' },
        { name: '日本語 (Japanese)',           value: 'ja' },
      ),
  );

// ── Autocomplete ──────────────────────────────────────────────────────────────

async function autocomplete(interaction) {
  const focused = interaction.options.getFocused(true);

  if (focused.name === 'card') {
    const query   = focused.value.toLowerCase();
    const results = cardDb.search(query, 25);
    const isLatin = /[a-zA-Z]/.test(focused.value);
    await interaction.respond(
      results.map(c => {
        const primary = isLatin
          ? (c.names.en || c.names.zh || c.uid)
          : (c.names.zh || c.names.en || c.uid);
        return { name: `${primary} (${c.uid})`.slice(0, 100), value: c.uid };
      }),
    );
    return;
  }

  if (focused.name === 'set') {
    const query   = focused.value.toLowerCase();
    const matched = cardDb.getSets().filter(s => {
      if (/^P-/.test(s.id) || s.id === 'A4b') return false;
      const zh = getSetName(s.id, 'zh').toLowerCase();
      const en = getSetName(s.id, 'en').toLowerCase();
      return s.id.toLowerCase().includes(query) || zh.includes(query) || en.includes(query);
    });
    const choices = [{ name: 'All Expansions (全部賽制)', value: '__all__' }];
    matched.reverse().slice(0, 24).forEach(s => {
      const zh = getSetName(s.id, 'zh');
      const en = getSetName(s.id, 'en');
      choices.push({
        name:  (zh !== s.id ? `${zh} / ${en} (${s.id})` : `${en} (${s.id})`).slice(0, 100),
        value: s.id,
      });
    });
    await interaction.respond(choices.slice(0, 25));
  }
}

// ── Execute (step 1: show card + confirm button) ──────────────────────────────

async function execute(interaction) {
  const uid       = interaction.options.getString('card');
  const setOpt    = interaction.options.getString('set') ?? '__all__'; // default: all expansions
  const metaSetId = setOpt === '__all__' ? '__all__' : setOpt;
  const lang      = interaction.options.getString('display') ?? 'zh';

  const card = cardDb.getCard(uid);
  if (!card) {
    return interaction.reply({ content: `❌ 找不到卡牌 / Card not found: **${uid}**`, flags: 64 });
  }

  const imgKey    = LANG_IMAGE_KEY[lang] ?? 'zh_TW';
  const imagePath = card.images?.[imgKey] ?? card.images?.zh_TW ?? card.images?.en_US ?? Object.values(card.images ?? {})[0];
  if (!imagePath || !fs.existsSync(imagePath)) {
    return interaction.reply({ content: `❌ 找不到卡牌圖片 / No image for **${uid}**`, flags: 64 });
  }

  pending.set(interaction.id, {
    uid, metaSetId, lang,
    expires: Date.now() + 10 * 60 * 1000,
  });

  const scopeLabel = metaSetId === '__all__' ? '全部賽制 / All Expansions' : setLabel(metaSetId);
  const btn = new ButtonBuilder()
    .setCustomId(`cm_search|${interaction.id}`)
    .setLabel(`🔍 搜尋 ${scopeLabel} 主流牌組 / Search Meta`)
    .setStyle(ButtonStyle.Primary);

  await interaction.reply({
    embeds:     [buildCardEmbed(card, lang)],
    files:      [new AttachmentBuilder(imagePath, { name: 'card.png' })],
    components: [new ActionRowBuilder().addComponents(btn)],
  });
}

// ── Button handler (step 2: search meta decks) ────────────────────────────────

async function handleButton(interaction) {
  const [, originId] = interaction.customId.split('|');
  const state = pending.get(originId);
  if (!state) {
    return interaction.reply({
      content: '⏰ 已過期，請重新執行指令。/ Expired, please run the command again.',
      flags: 64,
    });
  }

  await interaction.deferReply();

  const card = cardDb.getCard(state.uid);
  const name = card ? cardDisplayName(card) : state.uid;
  const { metaSetId, lang = 'zh' } = state;

  const isAll   = metaSetId === '__all__';
  const searchSetId = isAll ? null : metaSetId;

  // Build all variants to match against (handles reprints, alt-arts, trainer promos)
  const variants = card ? getSearchVariants(card) : [{ set: card.set, num: card.num }];

  let searchResult;
  try {
    searchResult = isAll
      ? await searchAllExpansions(variants)
      : await searchMetaDecks(variants, searchSetId);
  } catch (err) {
    console.error('[card_meta]', err);
    return interaction.editReply({ content: '❌ 無法取得 Meta 資料，請稍後再試。/ Failed to fetch meta data.' });
  }

  const { matches, scanned, setsSearched } = searchResult;

  const scopeHeader = isAll
    ? `📦 搜尋了 ${setsSearched} 個賽制 / Searched ${setsSearched} expansion metas`
    : `📦 ${setLabel(searchSetId)}`;
  const footerBase = `掃描了 ${scanned} 個牌組 · Limitless TCG`;

  if (matches.length === 0) {
    const embed = new EmbedBuilder()
      .setTitle(`${name} (${state.uid}) — Meta`)
      .setColor(0xFF4444)
      .setDescription(`${scopeHeader}\n\n❌ 此卡未出現在已掃描的主流牌組中。\nThis card was not found in the searched meta decks.`)
      .setFooter({ text: footerBase });
    return interaction.editReply({ embeds: [embed] });
  }

  // Group by expansion (same order as deck_search)
  const bySet = new Map();
  for (const m of matches) {
    const key = m.setId ?? 'std';
    if (!bySet.has(key)) bySet.set(key, []);
    bySet.get(key).push(m);
  }
  const setOrder    = cardDb.getSets().map(s => s.id).filter(id => !/^P-/.test(id) && !SKIP_SETS_ALL.has(id)).reverse();
  const orderedKeys = setOrder.filter(id => bySet.has(id));

  const SETS_PER_PAGE = 5;
  const pages = [];
  for (let i = 0; i < orderedKeys.length; i += SETS_PER_PAGE) {
    pages.push(
      orderedKeys.slice(i, i + SETS_PER_PAGE).map(key => {
        const mSetId     = key === 'std' ? null : key;
        const decks      = bySet.get(key);
        const zh         = mSetId ? getSetName(mSetId, 'zh') : '';
        const en         = mSetId ? getSetName(mSetId, 'en') : 'Standard';
        const setTitle   = mSetId ? (zh !== mSetId ? `${mSetId} ${en}` : en) : 'Standard';
        const fieldName  = `📦 ${setTitle}  (${decks.length})`;
        const fieldValue = decks.map(m =>
          `**#${m.rank}** [${m.name}](${deckUrl(m.slug, mSetId)}) · \`${m.share} Win ${m.winRate}\``,
        ).join('\n').slice(0, 1024);
        return { key, mSetId, decks, fieldName, fieldValue };
      }),
    );
  }

  // Store results for page-nav and select-menu handlers
  const cacheId = interaction.id;
  resultsCache.set(cacheId, {
    matches, metaSetId, lang, pages, scopeHeader, footerBase,
    cardName: name, cardUid: state.uid,
    expires: Date.now() + 15 * 60 * 1000,
  });

  await interaction.editReply(buildResultPage(pages, 0, cacheId, name, state.uid, scopeHeader, footerBase));
}

// ── Result page builder ───────────────────────────────────────────────────────

function buildResultPage(pages, pageIdx, cacheId, cardName, cardUid, scopeHeader, footerBase) {
  const page       = pages[pageIdx];
  const totalPages = pages.length;

  const embed = new EmbedBuilder()
    .setTitle(`${cardName} (${cardUid}) — Meta`)
    .setColor(0x57F287)
    .setDescription(scopeHeader)
    .setFooter({ text: `${footerBase} · 頁 ${pageIdx + 1}/${totalPages}` });

  const selectOptions = [];
  for (const { key, mSetId, decks, fieldName, fieldValue } of page) {
    embed.addFields({ name: fieldName, value: fieldValue, inline: false });
    for (const m of decks) {
      if (selectOptions.length >= 25) break;
      selectOptions.push({
        label:       `#${m.rank} ${m.name}`.slice(0, 100),
        description: `${mSetId ?? 'Standard'} · ${m.share} · Win ${m.winRate}`.slice(0, 100),
        value:       `${cacheId}::${key}::${m.slug}`,
      });
    }
  }

  const components = [];
  if (selectOptions.length) {
    components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('cm_deck')
        .setPlaceholder('選擇牌組查看詳情 / Select a deck for details')
        .addOptions(selectOptions),
    ));
  }
  if (totalPages > 1) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`cm_page|${cacheId}|${pageIdx - 1}`)
        .setLabel('← 上頁')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(pageIdx === 0),
      new ButtonBuilder()
        .setCustomId(`cm_page|${cacheId}|${pageIdx + 1}`)
        .setLabel('下頁 →')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(pageIdx >= totalPages - 1),
    ));
  }

  return { embeds: [embed], components };
}

// ── Page-nav button handler ───────────────────────────────────────────────────

async function handlePageButton(interaction) {
  const [, cacheId, pageStr] = interaction.customId.split('|');
  const cached = resultsCache.get(cacheId);
  if (!cached) {
    return interaction.reply({ content: '⏰ 已過期，請重新執行指令。', flags: 64 });
  }
  const pageIdx = parseInt(pageStr, 10);
  const { pages, scopeHeader, footerBase, cardName, cardUid } = cached;
  if (pageIdx < 0 || pageIdx >= pages.length) return;
  await interaction.update(buildResultPage(pages, pageIdx, cacheId, cardName, cardUid, scopeHeader, footerBase));
}

// ── Select menu handler (deck detail with card grid image) ────────────────────

async function handleSelectMenu(interaction) {
  // Format: cacheId::setKey::slug  (setKey = 'std' or a set ID like 'B2b')
  const parts     = interaction.values[0].split('::');
  const cacheId   = parts[0];
  const setKey    = parts[1];
  const slug      = parts.slice(2).join('::');
  const cached    = resultsCache.get(cacheId);
  const lang      = cached?.lang ?? 'zh';
  const metaSetId = (setKey === 'std' || !setKey) ? null : setKey;

  await interaction.deferReply();

  let detail;
  try {
    detail = await fetchDeckDetail(slug, metaSetId);
  } catch (err) {
    console.error('[card_meta detail]', err);
    return interaction.editReply({ content: '❌ 無法取得牌組詳情。/ Failed to fetch deck detail.' });
  }

  const matchedDeck = cached?.matches?.find(m => m.slug === slug);
  const title = matchedDeck?.name ?? slug;
  const url   = deckUrl(slug, metaSetId);
  const { summary, results } = detail;

  // Fetch top decklist and enrich
  const topResult = results.find(r => r.decklistUrl);
  let enriched = [];
  if (topResult?.decklistUrl) {
    try {
      const pathname = new URL(topResult.decklistUrl).pathname;
      const cards    = await fetchDecklist(pathname);
      for (const c of cards) {
        const uid     = `${c.set}-${c.num}`;
        const dbCard  = cardDb.getCard(uid);
        const names   = dbCard?.names ?? {};
        enriched.push({
          uid,
          count:       c.count,
          type:        dbCard?.type ?? null,
          displayName: names[lang] ?? names.zh ?? names.en ?? c.name,
          set:         c.set,
          num:         c.num,
        });
      }
    } catch (e) {
      console.error('[card_meta decklist]', e.message);
    }
  }

  const pokeCards    = enriched.filter(c => c.type !== null);
  const trainerCards = enriched.filter(c => c.type === null);
  const pokeLines    = pokeCards.map(c => `${c.count}× ${typeSprite(c.type)} ${c.displayName} \`${c.uid}\``);
  const trainerLines = trainerCards.map(c => `${c.count}× ${c.displayName} \`${c.uid}\``);

  const statsLine = summary
    ? `${summary.wins}勝 ${summary.losses}敗 ${summary.ties}平 · Win **${summary.winRate}**`
    : '—';
  const resultLines = results.slice(0, 4).map((r, i) => {
    const link = r.decklistUrl ? `[${r.player}](${r.decklistUrl})` : r.player;
    return `${i + 1}. ${link} · **${r.placement}** · ${r.record}`;
  });

  const fields = [{ name: '總成績 / Overall', value: statsLine, inline: false }];
  if (pokeLines.length)    fields.push({ name: `寶可夢 / Pokémon (${pokeCards.length})`,    value: pokeLines.join('\n').slice(0, 1024),    inline: true });
  if (trainerLines.length) fields.push({ name: `訓練師 / Trainers (${trainerCards.length})`, value: trainerLines.join('\n').slice(0, 1024), inline: true });
  const resultsLabel = topResult ? `最近賽績 / Recent Results (${topResult.player} 的牌組)` : '最近賽績 / Recent Results';
  fields.push({ name: resultsLabel, value: (resultLines.join('\n') || '—').slice(0, 1024), inline: false });

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setURL(url)
    .setColor(0xE8C435)
    .addFields(...fields)
    .setFooter({ text: 'Limitless TCG · PTCGP' });

  // Card select menu for individual card image viewer (reuse mp_cardview handler)
  const components = [];
  if (enriched.length) {
    const opts = enriched.slice(0, 25).map(c => ({
      label: `${c.count}× ${c.displayName} (${c.uid})`.slice(0, 100),
      value: c.uid,
    }));
    components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('mp_cardview')
        .setPlaceholder('選卡查看圖片 / Select a card to view image')
        .addOptions(opts),
    ));
  }

  // Generate deck grid image
  let deckImgAttachment = null;
  if (enriched.length) {
    try {
      const buf = await buildDeckImage(enriched, lang);
      deckImgAttachment = new AttachmentBuilder(buf, { name: 'deck.png' });
      embed.setImage('attachment://deck.png');
    } catch (e) {
      console.error('[card_meta deckImage]', e.message);
    }
  }

  const payload = { embeds: [embed], components };
  if (deckImgAttachment) payload.files = [deckImgAttachment];
  await interaction.editReply(payload);
}

module.exports = { data, execute, autocomplete, handleButton, handlePageButton, handleSelectMenu };
