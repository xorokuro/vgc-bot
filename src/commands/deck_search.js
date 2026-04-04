'use strict';

/**
 * /deck_search — Find meta decks containing card A AND card B (but NOT card C).
 *
 * Searches ALL expansion meta snapshots on Limitless (A1 through latest + Standard).
 * Each result is tagged with the expansion it appeared in.
 *
 * Cards are resolved to ALL base versions across every set sharing the same
 * English name + HP + type, so any rarity/art variant matches every legal version.
 */

const fs = require('fs');
const {
  SlashCommandBuilder, EmbedBuilder, AttachmentBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const cardDb = require('../ptcgp/cardDb');
const { resolveImagePath } = cardDb;
const { getSetName }     = require('../ptcgp/setNames');
const { typeSprite }     = require('../ptcgp/sprites');
const { buildDeckImage } = require('../ptcgp/deckImage');
const {
  fetchMetaDecks, fetchDeckDetail, fetchDecklist, deckUrl,
} = require('../ptcgp/metaScraper');

const MAX_PER_SET  = 8;   // top N decks fetched per expansion
const LANG_IMG_KEY = { zh: 'zh_TW', en: 'en_US', ja: 'ja_JP' };

// All non-promo, non-reprint set IDs, newest first (no null/Standard — it duplicates the latest set)
const SKIP_SETS  = new Set(['A4b']); // reprint-only sets
const ALL_SET_IDS = cardDb.getSets()
  .map(s => s.id)
  .filter(id => !/^P-/.test(id) && !SKIP_SETS.has(id))
  .reverse();

// ── State caches ──────────────────────────────────────────────────────────────

const pending      = new Map();
const resultsCache = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pending)      if (v.expires < now) pending.delete(k);
  for (const [k, v] of resultsCache) if (v.expires < now) resultsCache.delete(k);
}, 5 * 60 * 1000);

// ── Helpers ───────────────────────────────────────────────────────────────────

function setShortLabel(setId) {
  if (!setId) return 'Standard';
  const en = getSetName(setId, 'en');
  return en !== setId ? `${setId} ${en}` : setId;
}

function setLongLabel(setId) {
  if (!setId) return 'Standard';
  const zh = getSetName(setId, 'zh');
  const en = getSetName(setId, 'en');
  return zh !== setId ? `${zh} / ${en} (${setId})` : `${en} (${setId})`;
}

function cardLabel(card, lang = 'zh') {
  return card.names[lang] || card.names.zh || card.names.en || card.uid;
}

function cardImagePath(card, lang = 'zh') {
  const key  = LANG_IMG_KEY[lang] ?? 'zh_TW';
  const p    = resolveImagePath(card.images?.[key] ?? card.images?.zh_TW ?? Object.values(card.images ?? {})[0]);
  return p && fs.existsSync(p) ? p : null;
}

/** All base versions of a card across every set, matched by name+HP+type.
 *  - Trainer cards (type === null): collapse to a single oldest base version (all reprints are identical).
 *  - Pokémon cards: one lowest-num version per set (same card may differ between sets). */
function allCanonicals(card) {
  const enName = card.names.en || card.names.zh || '';
  if (!enName) return [{ set: card.set, num: card.num, uid: card.uid }];

  const isTrainer = card.type === null;

  // getSets() iterates in database insertion order = chronological (oldest first).
  // Trainers: collect ALL non-SKIP_SETS versions (including promos) because Limitless
  // may reference any version (e.g. Poké Ball = A2b-111 AND P-A-005).
  // Pokémon: one canonical per set (skip promos — they don't appear in booster metas).
  const bySet = new Map();
  for (const { id: setId } of cardDb.getSets()) {
    if (SKIP_SETS.has(setId)) continue;
    if (!isTrainer && /^P-/.test(setId)) continue; // skip promos for Pokémon cards
    const hits = cardDb.getSetCards(setId).filter(c =>
      c.type === card.type &&
      (isTrainer || c.hp === card.hp) &&
      (c.names.en || c.names.zh || '') === enName,
    );
    if (!hits.length) continue;
    hits.sort((a, b) => a.num - b.num);
    bySet.set(setId, { set: setId, num: hits[0].num, uid: hits[0].uid });
    // No break for trainers — collect all versions so dlHas() matches any of them
  }
  return bySet.size ? [...bySet.values()] : [{ set: card.set, num: card.num, uid: card.uid }];
}

// ── Search across ALL expansion metas ────────────────────────────────────────

async function searchAllExpansions(mustGroups, excludeGroups) {
  // Step 1: fetch deck list for every set in parallel (fast, uses 30-min cache)
  const setDecks = await Promise.all(
    ALL_SET_IDS.map(async setId => {
      try {
        const decks = await fetchMetaDecks(setId);
        return { setId, decks: decks.slice(0, MAX_PER_SET) };
      } catch { return { setId, decks: [] }; }
    }),
  );

  // Step 2: collect unique slugs — same slug may appear in multiple set metas
  const slugFirstSet = new Map(); // slug → first setId seen (for decklist fetch)
  const allEntries   = [];        // { rank, name, slug, winRate, share, setId }

  for (const { setId, decks } of setDecks) {
    for (const d of decks) {
      allEntries.push({ rank: d.rank, name: d.name, slug: d.slug, winRate: d.winRate, share: d.share, setId });
      if (!slugFirstSet.has(d.slug)) slugFirstSet.set(d.slug, setId);
    }
  }

  // Step 3: fetch decklists for every unique slug in parallel (uses 60-min cache)
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

  // Step 4: filter
  const dlHas = (dl, variants) =>
    variants.some(v => dl.some(c => c.set === v.set && c.num === v.num));

  const matches = [];
  for (const entry of allEntries) {
    const dl = slugToCards.get(entry.slug);
    if (!dl) continue;
    if (!mustGroups.every(g => dlHas(dl, g)))  continue;
    if (excludeGroups.some(g => dlHas(dl, g))) continue;
    matches.push(entry);
  }

  const setsWithData = setDecks.filter(s => s.decks.length > 0).length;
  return { matches, scanned: allEntries.length, setsSearched: setsWithData };
}

// ── Autocomplete ──────────────────────────────────────────────────────────────

async function autocomplete(interaction) {
  const focused = interaction.options.getFocused(true);

  if (['card1', 'card2', 'card3', 'exclude'].includes(focused.name)) {
    const q       = focused.value.toLowerCase();
    const results = cardDb.search(q, 25);
    const isLatin = /[a-zA-Z]/.test(focused.value);
    await interaction.respond(results.map(c => {
      const primary = isLatin ? (c.names.en || c.names.zh || c.uid) : (c.names.zh || c.names.en || c.uid);
      return { name: `${primary} (${c.uid})`.slice(0, 100), value: c.uid };
    }));
    return;
  }

  if (focused.name === 'set') {
    const q    = focused.value.toLowerCase();
    const sets = cardDb.getSets().filter(s => {
      if (/^P-/.test(s.id) || SKIP_SETS.has(s.id)) return false;
      const zh = getSetName(s.id, 'zh').toLowerCase();
      const en = getSetName(s.id, 'en').toLowerCase();
      return s.id.toLowerCase().includes(q) || zh.includes(q) || en.includes(q);
    });
    const choices = [{ name: 'All Expansions (全部賽制)', value: 'all' }];
    sets.reverse().slice(0, 24).forEach(s => {
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

// ── Step 1: Preview ───────────────────────────────────────────────────────────

async function execute(interaction) {
  const uid1   = interaction.options.getString('card1');
  const uid2   = interaction.options.getString('card2');
  const uid3   = interaction.options.getString('card3');
  const uidEx  = interaction.options.getString('exclude');
  const setOpt = interaction.options.getString('set') ?? 'all'; // default = all
  const lang   = interaction.options.getString('display') ?? 'zh';
  const pub    = interaction.options.getBoolean('public') ?? false;

  const c1 = cardDb.getCard(uid1);
  if (!c1) return interaction.reply({ content: `❌ 找不到卡牌: **${uid1}**`, flags: 64 });

  const mustCards   = [uid1, uid2, uid3].map(u => u ? cardDb.getCard(u) : null).filter(Boolean);
  const excludeCard = uidEx ? cardDb.getCard(uidEx) : null;

  const embeds = [];
  const files  = [];

  const addCardEmbed = (card, role, index) => {
    const variants   = allCanonicals(card);
    const setLines   = variants.map(v => `• \`${v.uid}\`  ${getSetName(v.set, lang === 'en' ? 'en' : 'zh')}`).join('\n');
    const isExclude = role === 'exclude';

    // Is the selected card itself one of the resolved variants?
    const selectedInVariants = variants.some(v => v.set === card.set && v.num === card.num);

    let countNote;
    if (variants.length > 1) {
      countNote = `共 **${variants.length}** 個版本將一併搜尋 / Will match any of ${variants.length} versions:`;
    } else if (!selectedInVariants) {
      // Selected card was a reprint (e.g. A4b) — remapped to its original version
      countNote = `♻️ 重印版已對應至原版 / Reprint remapped to original:`;
    } else {
      countNote = `單一版本 / Single version:`;
    }
    const isExclude2 = isExclude;

    const embed = new EmbedBuilder()
      .setColor(isExclude2 ? 0xFF4444 : 0x57F287)
      .setTitle(`${isExclude2 ? '❌ 不含' : `✅ 必含 #${index}`}: ${cardLabel(card, lang)}  (${card.uid})`)
      .setDescription(`${countNote}\n${setLines}`);

    const imgPath = cardImagePath(card, lang);
    if (imgPath) {
      const fname = `card_${isExclude2 ? 'x' : index}.png`;
      files.push(new AttachmentBuilder(imgPath, { name: fname }));
      embed.setThumbnail(`attachment://${fname}`);
    }
    embeds.push(embed);
  };

  mustCards.forEach((c, i) => addCardEmbed(c, 'must', i + 1));
  if (excludeCard) addCardEmbed(excludeCard, 'exclude', 0);

  const metaSetId = setOpt === 'all' ? null : setOpt; // null signals "all expansions" in pending
  const isAll     = setOpt === 'all';

  pending.set(interaction.id, {
    mustUids:   mustCards.map(c => c.uid),
    excludeUid: excludeCard?.uid ?? null,
    metaSetId:  isAll ? '__all__' : metaSetId,
    lang, pub,
    expires: Date.now() + 10 * 60 * 1000,
  });

  const scopeLabel = isAll ? '全部賽制 / All Expansions' : setLongLabel(metaSetId);
  embeds[0].setFooter({ text: `📦 ${scopeLabel} · 確認卡牌後點擊搜尋 / Confirm then Search` });

  const btn = new ButtonBuilder()
    .setCustomId(`ds_search|${interaction.id}`)
    .setLabel(`🔍 搜尋 ${isAll ? '全部賽制' : setLongLabel(metaSetId)} 主流牌組`)
    .setStyle(ButtonStyle.Primary);

  const replyFlags = pub ? undefined : 64;
  await interaction.reply({ embeds, files, components: [new ActionRowBuilder().addComponents(btn)], flags: replyFlags });
}

// ── Result page builder & page-nav button handler ────────────────────────────

function buildResultPage(pages, pageIdx, cacheId, headerDesc, footerBase) {
  const page      = pages[pageIdx];
  const totalPages = pages.length;

  const embed = new EmbedBuilder()
    .setTitle('🔍 牌組搜尋結果 / Deck Search Results')
    .setColor(0x57F287)
    .setDescription(headerDesc)
    .setFooter({ text: `${footerBase} · 頁 ${pageIdx + 1}/${totalPages}` });

  const selectOptions = [];
  for (const { setId, decks, fieldName, fieldValue } of page) {
    embed.addFields({ name: fieldName, value: fieldValue, inline: false });
    for (const m of decks) {
      if (selectOptions.length >= 25) break;
      const key = setId ?? 'std';
      selectOptions.push({
        label:       `#${m.rank} ${m.name}`.slice(0, 100),
        description: `${setShortLabel(setId)} · ${m.share} · Win ${m.winRate}`.slice(0, 100),
        value:       `${cacheId}::${key}::${m.slug}`,
      });
    }
  }

  const components = [];

  if (selectOptions.length) {
    components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('ds_deck')
        .setPlaceholder('選擇牌組查看詳情 / Select a deck for details')
        .addOptions(selectOptions),
    ));
  }

  if (totalPages > 1) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ds_page|${cacheId}|${pageIdx - 1}`)
        .setLabel('← 上頁')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(pageIdx === 0),
      new ButtonBuilder()
        .setCustomId(`ds_page|${cacheId}|${pageIdx + 1}`)
        .setLabel('下頁 →')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(pageIdx >= totalPages - 1),
    ));
  }

  return { embeds: [embed], components };
}

async function handlePageButton(interaction) {
  const [, cacheId, pageStr] = interaction.customId.split('|');
  const cached = resultsCache.get(cacheId);
  if (!cached) {
    return interaction.reply({ content: '⏰ 已過期，請重新執行指令。', flags: 64 });
  }
  const pageIdx = parseInt(pageStr, 10);
  const { pages, headerDesc, footerBase } = cached;
  if (pageIdx < 0 || pageIdx >= pages.length) return;
  const { embeds, components } = buildResultPage(pages, pageIdx, cacheId, headerDesc, footerBase);
  await interaction.update({ embeds, components });
}

// ── Step 2: Search ────────────────────────────────────────────────────────────

async function handleButton(interaction) {
  const [, originId] = interaction.customId.split('|');
  const state = pending.get(originId);
  if (!state) {
    return interaction.reply({ content: '⏰ 已過期，請重新執行指令。/ Expired.', flags: 64 });
  }

  const pub = state.pub ?? false;
  await interaction.deferReply(pub ? {} : { flags: 64 });

  const { mustUids, excludeUid, metaSetId: rawSetId, lang } = state;
  const mustCards   = mustUids.map(u => cardDb.getCard(u)).filter(Boolean);
  const excludeCard = excludeUid ? cardDb.getCard(excludeUid) : null;

  const mustGroups    = mustCards.map(allCanonicals);
  const excludeGroups = excludeCard ? [allCanonicals(excludeCard)] : [];

  const isAll     = rawSetId === '__all__';
  const metaSetId = isAll ? null : rawSetId;

  let result;
  try {
    if (isAll) {
      result = await searchAllExpansions(mustGroups, excludeGroups);
    } else {
      // Single-set search (reuse the all-expansions function but with one set)
      result = await searchSingleSet(mustGroups, excludeGroups, metaSetId);
    }
  } catch (err) {
    console.error('[deck_search]', err);
    return interaction.editReply({ content: '❌ 無法取得 Meta 資料，請稍後再試。' });
  }

  const { matches, scanned, setsSearched } = result;

  const mustLabels = mustCards.map(c => {
    const n = allCanonicals(c).length;
    return `**${cardLabel(c, lang)}**${n > 1 ? ` (${n}v)` : ''}`;
  }).join(' + ');
  const excludeLabel = excludeCard ? `\n❌ 不含: **${cardLabel(excludeCard, lang)}**` : '';
  const scopeNote    = isAll
    ? `📦 搜尋了 ${setsSearched} 個賽制 / Searched ${setsSearched} expansion metas`
    : `📦 ${setLongLabel(metaSetId)}`;

  const headerDesc = `✅ 含有: ${mustLabels}${excludeLabel}\n${scopeNote}`;
  const footerBase = `掃描了 ${scanned} 個牌組 · Limitless TCG`;

  if (matches.length === 0) {
    const embed = new EmbedBuilder()
      .setTitle('🔍 牌組搜尋結果 / Deck Search Results')
      .setColor(0xFF4444)
      .setDescription(headerDesc)
      .setFooter({ text: footerBase })
      .addFields({ name: '結果', value: '沒有符合條件的牌組。\nNo matching decks found.' });
    return interaction.editReply({ embeds: [embed] });
  }

  // Group results by setId
  const bySet = new Map();
  for (const m of matches) {
    const key = m.setId ?? 'std';
    if (!bySet.has(key)) bySet.set(key, []);
    bySet.get(key).push(m);
  }

  // Expansion order: Standard first, then sets newest→oldest
  const setOrder   = cardDb.getSets().map(s => s.id).filter(id => !/^P-/.test(id) && !SKIP_SETS.has(id)).reverse();
  const orderedKeys = setOrder.filter(id => bySet.has(id));

  // Split expansions into pages: max 5 expansion groups per page.
  const SETS_PER_PAGE = 5;
  const pages = []; // pages[i] = [{ key, setId, decks, fieldName, fieldValue }]

  for (let i = 0; i < orderedKeys.length; i += SETS_PER_PAGE) {
    pages.push(
      orderedKeys.slice(i, i + SETS_PER_PAGE).map(key => {
        const setId     = key === 'std' ? null : key;
        const decks     = bySet.get(key);
        const fieldName = `📦 ${setShortLabel(setId)}  (${decks.length})`;
        const fieldValue = decks.map(m =>
          `**#${m.rank}** [${m.name}](${deckUrl(m.slug, setId)}) · \`${m.share} Win ${m.winRate}\``,
        ).join('\n').slice(0, 1024);
        return { key, setId, decks, fieldName, fieldValue };
      }),
    );
  }

  const cacheId = interaction.id;
  resultsCache.set(cacheId, {
    matches, lang, pub, pages, headerDesc, footerBase,
    expires: Date.now() + 15 * 60 * 1000,
  });

  const { embeds: pageEmbeds, components: pageComponents } =
    buildResultPage(pages, 0, cacheId, headerDesc, footerBase);
  await interaction.editReply({ embeds: pageEmbeds, components: pageComponents });
}

// ── Single-set search (used when a specific expansion is chosen) ──────────────

async function searchSingleSet(mustGroups, excludeGroups, metaSetId) {
  const decks = await fetchMetaDecks(metaSetId);
  const top   = decks.slice(0, 25);

  const decklists = await Promise.all(
    top.map(async d => {
      try {
        const detail = await fetchDeckDetail(d.slug, metaSetId);
        const first  = detail?.results?.find(r => r.decklistUrl);
        if (!first?.decklistUrl) return null;
        return fetchDecklist(new URL(first.decklistUrl).pathname).catch(() => null);
      } catch { return null; }
    }),
  );

  const dlHas = (dl, variants) =>
    variants.some(v => dl.some(c => c.set === v.set && c.num === v.num));

  const matches = [];
  for (let i = 0; i < top.length; i++) {
    const dl = decklists[i];
    if (!dl) continue;
    if (!mustGroups.every(g => dlHas(dl, g)))  continue;
    if (excludeGroups.some(g => dlHas(dl, g))) continue;
    matches.push({ rank: top[i].rank, name: top[i].name, slug: top[i].slug,
      winRate: top[i].winRate, share: top[i].share, setId: metaSetId });
  }

  return { matches, scanned: top.length, setsSearched: 1 };
}

// ── Select menu: deck detail ──────────────────────────────────────────────────

async function handleSelectMenu(interaction) {
  const value   = interaction.values[0];
  // Format: cacheId::setKey::slug   (setKey is 'std' or a set ID like 'A1')
  const parts   = value.split('::');
  const cacheId = parts[0];
  const setKey  = parts[1];
  const slug    = parts.slice(2).join('::');
  const cached  = resultsCache.get(cacheId);
  const lang    = cached?.lang ?? 'zh';
  const metaSetId = (setKey === 'std' || !setKey) ? null : setKey;

  const pub = cached?.pub ?? false;
  await interaction.deferReply(pub ? {} : { flags: 64 });

  let detail;
  try {
    detail = await fetchDeckDetail(slug, metaSetId);
  } catch (err) {
    console.error('[deck_search detail]', err);
    return interaction.editReply({ content: '❌ 無法取得牌組詳情。' });
  }

  const matchedDeck = cached?.matches?.find(m => m.slug === slug);
  const title = matchedDeck?.name ?? slug;
  const url   = deckUrl(slug, metaSetId);
  const { summary, results } = detail;

  const topResult = results.find(r => r.decklistUrl);
  let enriched = [];
  if (topResult?.decklistUrl) {
    try {
      const cards = await fetchDecklist(new URL(topResult.decklistUrl).pathname);
      for (const c of cards) {
        const uid    = `${c.set}-${c.num}`;
        const dbCard = cardDb.getCard(uid);
        const names  = dbCard?.names ?? {};
        enriched.push({
          uid, count: c.count, type: dbCard?.type ?? null,
          displayName: names[lang] ?? names.zh ?? names.en ?? c.name,
          set: c.set, num: c.num,
        });
      }
    } catch (e) { console.error('[deck_search decklist]', e.message); }
  }

  const pokeCards    = enriched.filter(c => c.type !== null);
  const trainerCards = enriched.filter(c => c.type === null);
  const pokeLines    = pokeCards.map(c => `${c.count}× ${typeSprite(c.type)} ${c.displayName} \`${c.uid}\``);
  const trainerLines = trainerCards.map(c => `${c.count}× ${c.displayName} \`${c.uid}\``);

  const statsLine   = summary
    ? `${summary.wins}勝 ${summary.losses}敗 ${summary.ties}平 · Win **${summary.winRate}**`
    : '—';
  const resultLines = results.slice(0, 4).map((r, i) => {
    const link = r.decklistUrl ? `[${r.player}](${r.decklistUrl})` : r.player;
    return `${i + 1}. ${link} · **${r.placement}** · ${r.record}`;
  });

  const setLine  = `📦 ${setShortLabel(metaSetId)}`;
  const fields   = [{ name: `總成績 / Overall · ${setLine}`, value: statsLine, inline: false }];
  if (pokeLines.length)    fields.push({ name: `寶可夢 (${pokeCards.length})`,    value: pokeLines.join('\n').slice(0, 1024),    inline: true });
  if (trainerLines.length) fields.push({ name: `訓練師 (${trainerCards.length})`, value: trainerLines.join('\n').slice(0, 1024), inline: true });
  const resultsLabel = topResult ? `最近賽績 (${topResult.player} 的牌組)` : '最近賽績';
  fields.push({ name: resultsLabel, value: (resultLines.join('\n') || '—').slice(0, 1024), inline: false });

  const embed = new EmbedBuilder()
    .setTitle(title).setURL(url).setColor(0xE8C435)
    .addFields(...fields)
    .setFooter({ text: 'Limitless TCG · PTCGP' });

  const components = [];
  if (enriched.length) {
    components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('mp_cardview')
        .setPlaceholder('選卡查看圖片 / Select a card to view image')
        .addOptions(enriched.slice(0, 25).map(c => ({
          label: `${c.count}× ${c.displayName} (${c.uid})`.slice(0, 100),
          value: c.uid,
        }))),
    ));
  }

  let deckImg = null;
  if (enriched.length) {
    try {
      deckImg = new AttachmentBuilder(await buildDeckImage(enriched, lang), { name: 'deck.png' });
      embed.setImage('attachment://deck.png');
    } catch (e) { console.error('[deck_search deckImage]', e.message); }
  }

  const payload = { embeds: [embed], components };
  if (deckImg) payload.files = [deckImg];
  await interaction.editReply(payload);
}

// ── Command definition ────────────────────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName('deck_search')
    .setDescription('搜尋含有特定卡牌組合的主流牌組 / Find meta decks with a combination of cards')
    .addStringOption(o => o
      .setName('card1')
      .setDescription('必須含有此卡 / Must contain this card')
      .setRequired(true)
      .setAutocomplete(true))
    .addStringOption(o => o
      .setName('card2')
      .setDescription('同時必須含有此卡 / Must also contain this card')
      .setAutocomplete(true))
    .addStringOption(o => o
      .setName('card3')
      .setDescription('同時必須含有此卡 / Must also contain this card')
      .setAutocomplete(true))
    .addStringOption(o => o
      .setName('exclude')
      .setDescription('不能含有此卡 / Must NOT contain this card')
      .setAutocomplete(true))
    .addStringOption(o => o
      .setName('set')
      .setDescription('賽制篩選 / Filter by expansion — default: All Expansions')
      .setAutocomplete(true))
    .addStringOption(o => o
      .setName('display')
      .setDescription('卡名語言 / Card name display language (default: 繁中)')
      .addChoices(
        { name: '繁中 (Traditional Chinese)', value: 'zh' },
        { name: 'English',                    value: 'en' },
        { name: '日本語 (Japanese)',           value: 'ja' },
      ))
    .addBooleanOption(o => o
      .setName('public')
      .setDescription('公開顯示結果給所有人（預設：僅自己可見）/ Show results publicly (default: only you)')),

  execute,
  autocomplete,
  handleButton,
  handlePageButton,
  handleSelectMenu,
};
