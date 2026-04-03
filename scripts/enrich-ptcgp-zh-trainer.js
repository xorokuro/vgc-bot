'use strict';

/**
 * Enrich PTCGP card database with Traditional Chinese + Japanese names from 52poke wiki.
 *
 * Handles both card-specific pages (赫拉克羅斯（A2a）) and
 * general PTCGP pages (刚石（TCGP）= Adaman/trainer).
 *
 * Converts Simplified→Traditional Chinese via opencc-js.
 * Matches cards by English name extracted from [[en:...]] interlanguage links.
 *
 * Run: node scripts/enrich-ptcgp-zh-trainer.js
 */

const fs     = require('fs');
const path   = require('path');
const OpenCC = require('opencc-js');

const DB_PATH = path.join(__dirname, '../data/ptcgp_cards.json');
const toTW    = OpenCC.Converter({ from: 'cn', to: 'tw' }); // Simplified → Traditional (TW)

const UA    = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const BASE  = 'https://wiki.52poke.com/api.php';
const DELAY = 350;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function wikiApi(params) {
  const url = BASE + '?' + new URLSearchParams({ format: 'json', ...params });
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Set category mapping ───────────────────────────────────────────────────────
// Exactly as stored in the wiki (a mix of Simplified/Traditional)
const SET_ZH_CATEGORY = {
  A1:  '最强的基因',  A1a: '幻游岛',        A2:  '時空激鬥',
  A2a: '超克之光',   A2b: '嗨放異彩',       A3:  '双天之守护者',
  A3a: '异次元危机', A3b: '伊布花园',       A4:  '天与海的指引',
  A4a: '未知水域',   A4b: '高級擴充包ex',   B1:  '超级崛起',       B1a: '红莲烈焰',
  B2:  '幻梦游行',   B2a: '帕底亚惊奇',  B2b: '超級異彩',
};

// ── Wikitext extraction helpers ────────────────────────────────────────────────

/** From {{N|zh||ja|en}} template: extract japanese and english names */
function extractFromNTemplate(wikitext) {
  const m = wikitext.match(/\{\{N\|([^|{}\n]*)\|([^|{}\n]*)\|([^|{}\n]*)\|([^|{}\n]*)\}\}/);
  if (!m) return { ja: null, en: null };
  // params: [zh_simp, zh_trad_or_empty, ja, en]
  return { ja: m[3]?.trim() || null, en: m[4]?.trim() || null };
}

/** From [[en:NAME]] or [[en:NAME (Set Number)]] interlanguage link — returns full text */
function extractEnLink(wikitext) {
  const m = wikitext.match(/\[\[en:([^|\]]+)/);
  return m ? m[1].trim() : null;
}

/** Extract zh name from page title — strip set suffix, convert S→T */
function zhFromTitle(title) {
  const m = title.match(/^(.+?)（/);
  return m ? toTW(m[1].trim()) : toTW(title.trim());
}

/** Batch fetch wikitext for up to 50 page titles */
async function fetchPageContents(titles) {
  if (!titles.length) return {};
  const data = await wikiApi({
    action: 'query', titles: titles.join('|'),
    prop: 'revisions', rvprop: 'content', rvslots: 'main',
  });
  const map = {};
  for (const page of Object.values(data.query?.pages ?? {})) {
    const text = page.revisions?.[0]?.slots?.main?.['*']
              ?? page.revisions?.[0]?.['*'] ?? '';
    map[page.title] = text;
  }
  return map;
}

/** Fetch all article pages in a set category (including（TCGP）pages) */
async function fetchCategoryMembers(setId) {
  const zhCat = SET_ZH_CATEGORY[setId];
  if (!zhCat) return [];
  const catTitle = `Category:${zhCat}（TCGP）`;
  const members  = [];
  let cmcontinue;
  do {
    const d = await wikiApi({
      action: 'query', list: 'categorymembers', cmtitle: catTitle,
      cmlimit: '500', cmtype: 'page', cmnamespace: '0',
      ...(cmcontinue ? { cmcontinue } : {}),
    });
    members.push(...(d.query?.categorymembers ?? []));
    cmcontinue = d.continue?.cmcontinue;
  } while (cmcontinue);

  // Keep ONLY pages that look like card pages:
  //   - 赫拉克羅斯（A2a）     → set-specific card
  //   - 刚石（TCGP）           → trainer card (covers all sets)
  //   - 珠贝（TCGP）           → trainer card
  // Exclude: image files, deck pages, set article pages (超克之光（TCGP）)
  return members.filter(m => {
    const t = m.title;
    return (
      /（[A-Z][0-9][a-z]?(\s+\d+)?）$/.test(t) || // set-specific card
      /（TCGP）$/.test(t)                           // general PTCGP page
    ) && !t.includes('牌组')           // exclude deck pages
      && !t.match(/^[A-Za-z]/)        // exclude english-start (set pages)
      && !t.match(/^\d/)              // exclude numeric starts
      && !Object.values(SET_ZH_CATEGORY).some(name => t.startsWith(name) && t.endsWith('（TCGP）'));
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  const db  = JSON.parse(raw);

  // Build English-name reverse lookup: en.toLowerCase() → [cards...]  (global, all sets)
  const byEn = new Map();
  for (const card of db.cards) {
    const en = (card.names.en ?? '').toLowerCase();
    if (!en) continue;
    if (!byEn.has(en)) byEn.set(en, []);
    byEn.get(en).push(card);
  }

  // Also per-set lookup: setId → Map<en, card[]>
  const bySetEn = new Map();
  for (const card of db.cards) {
    if (!bySetEn.has(card.set)) bySetEn.set(card.set, new Map());
    const en = (card.names.en ?? '').toLowerCase();
    if (!en) continue;
    const m = bySetEn.get(card.set);
    if (!m.has(en)) m.set(en, []);
    m.get(en).push(card);
  }

  // Per-set card-number lookup: setId → Map<num, card>
  // Used for sets where tcgdex had no data (B2a, B2b, A4b) — match by card number from [[en:NAME (Set N)]]
  const bySetNum = new Map();
  for (const card of db.cards) {
    if (!bySetNum.has(card.set)) bySetNum.set(card.set, new Map());
    bySetNum.get(card.set).set(card.num, card);
  }

  // Already-processed TCGP page titles (to avoid duplicate work across sets)
  const processedTcgpPages = new Set();

  let totalUpdated = 0;

  for (const [setId] of Object.entries(SET_ZH_CATEGORY)) {
    process.stdout.write(`\n📦 ${setId}… `);
    let members;
    try {
      members = await fetchCategoryMembers(setId);
    } catch (e) {
      console.log(`FAILED (${e.message})`);
      await sleep(DELAY);
      continue;
    }
    await sleep(DELAY);

    // Separate into set-specific and TCGP (general trainer) pages
    const setPages   = members.filter(m => !m.title.endsWith('（TCGP）'));
    const tcgpPages  = members.filter(m => m.title.endsWith('（TCGP）'));

    // Filter out already-processed TCGP pages
    const newTcgpPages = tcgpPages.filter(m => !processedTcgpPages.has(m.title));
    newTcgpPages.forEach(m => processedTcgpPages.add(m.title));

    const allPages = [...setPages, ...newTcgpPages];
    console.log(`${setPages.length} card + ${newTcgpPages.length} trainer pages`);

    if (!allPages.length) continue;

    // Batch-fetch wikitext (50 per request)
    const BATCH = 50;
    for (let i = 0; i < allPages.length; i += BATCH) {
      const batch  = allPages.slice(i, i + BATCH);
      const titles = batch.map(b => b.title);
      let contents;
      try {
        contents = await fetchPageContents(titles);
      } catch (e) {
        console.warn(`  Batch ${i}: FAILED (${e.message})`);
        await sleep(DELAY);
        continue;
      }
      await sleep(DELAY);

      for (const item of batch) {
        const wikitext = contents[item.title] ?? '';
        const zh       = zhFromTitle(item.title);
        const { ja }   = extractFromNTemplate(wikitext);
        const enLink   = extractEnLink(wikitext);

        // Determine which cards to update
        let matched = [];
        let enFromLink = null; // base English name extracted from [[en:NAME (Set N)]]

        if (enLink) {
          // enLink may be "Adaman", "Scyther (Mega Shine 1)", or "Adaman (A2a 89)"
          const numMatch   = enLink.match(/^(.+?)\s+\([^)]+\s+(\d+)\)\s*$/);
          const baseName   = numMatch ? numMatch[1].trim() : enLink;
          const cardNumStr = numMatch ? numMatch[2] : null;

          // For set-specific pages that carry a card number, try the exact card first.
          // Priority: if the matched card has NO en name, it's from a set not in tcgdex
          // (e.g. B2b, B2a) — use it exclusively so we don't accidentally update
          // same-named Pokémon in other sets instead.
          if (!item.title.endsWith('（TCGP）') && cardNumStr) {
            const titleParsed = item.title.match(/（([A-Z][0-9][a-z]?)(?:\s*\d+)?）$/);
            if (titleParsed) {
              const card = bySetNum.get(titleParsed[1])?.get(parseInt(cardNumStr, 10));
              if (card && !card.names.en) {
                // No existing en name → set not in tcgdex → match exclusively by card number
                matched = [card];
                enFromLink = baseName;
              }
            }
          }

          // Fall back to name matching (trainer TCGP pages, or Pokémon from tcgdex sets)
          if (!matched.length) {
            matched = byEn.get(enLink.toLowerCase()) ?? byEn.get(baseName.toLowerCase()) ?? [];
          }
        } else if (!item.title.endsWith('（TCGP）')) {
          // Set-specific page without en link: parse set code + try set-scoped en lookup
          const titleParsed = item.title.match(/（([A-Z][0-9][a-z]?)\s*(\d+)?）$/);
          if (titleParsed) {
            const sId   = titleParsed[1];
            const enMap = bySetEn.get(sId);
            if (enMap) matched = [...enMap.values()].flat();
          }
        }

        for (const card of matched) {
          let changed = false;
          if (zh && !card.names.zh) { card.names.zh = zh; changed = true; }
          if (ja && !card.names.ja) { card.names.ja = ja; changed = true; }
          if (enFromLink && !card.names.en) { card.names.en = enFromLink; changed = true; }
          if (changed) totalUpdated++;
        }
      }

      process.stdout.write('.');
    }
  }

  // Convert any remaining Simplified zh names to Traditional (from previous partial runs)
  let convertedCount = 0;
  for (const card of db.cards) {
    if (!card.names.zh) continue;
    const converted = toTW(card.names.zh);
    if (converted !== card.names.zh) {
      card.names.zh = converted;
      convertedCount++;
    }
  }
  if (convertedCount > 0) console.log(`\n🔄  Converted ${convertedCount} Simplified zh names to Traditional`);

  db.generated = new Date().toISOString();
  fs.writeFileSync(DB_PATH, JSON.stringify(db));
  console.log(`\n\n✅  Updated ${totalUpdated} cards. Saved.`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
