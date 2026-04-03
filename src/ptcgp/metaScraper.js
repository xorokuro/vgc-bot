'use strict';

const BASE = 'https://play.limitlesstcg.com';
const UA   = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

const LIST_TTL   = 30 * 60 * 1000; // 30 min
const DETAIL_TTL = 60 * 60 * 1000; // 60 min

const listCache   = new Map(); // setKey  → { decks, fetchedAt }
const detailCache = new Map(); // slug    → { detail, fetchedAt }

// ── Helpers ───────────────────────────────────────────────────────────────────

function strip(html) {
  return html.replace(/<[^>]*>/g, '').trim();
}

function extractTds(rowHtml) {
  const tds = [];
  const re = /<td[^>]*>([\s\S]*?)<\/td>/g;
  let m;
  while ((m = re.exec(rowHtml)) !== null) tds.push(m[1].trim());
  return tds;
}

function extractRows(html) {
  const rows = [];
  const re = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = re.exec(html)) !== null) rows.push(m[1]);
  return rows;
}

// ── Deck list parser ──────────────────────────────────────────────────────────

function parseDecks(html) {
  const decks = [];
  for (const row of extractRows(html)) {
    const tds = extractTds(row);
    if (tds.length < 7) continue;

    const rank = parseInt(tds[0]);
    if (isNaN(rank)) continue;

    const hrefMatch = tds[2].match(/href="([^"]+)"/);
    const href      = hrefMatch?.[1] ?? '';
    const slugMatch = href.match(/\/decks\/([^?]+)/);
    const slug      = slugMatch?.[1] ?? '';
    const name      = strip(tds[2]);

    const count   = parseInt(tds[3]) || 0;
    const share   = strip(tds[4]);
    const record  = strip(tds[5]);  // "804 - 756 - 25"
    const winRate = strip(tds[6]);  // "50.73%"

    const parts = record.split(' - ').map(n => parseInt(n) || 0);
    const [w = 0, l = 0, t = 0] = parts;

    decks.push({ rank, name, slug, count, share, w, l, t, winRate });
  }
  return decks;
}

// ── Deck detail parser ────────────────────────────────────────────────────────

function parseDetail(html, slug) {
  // Overall summary
  const sm = html.match(/(\d[\d,]*)\s+wins?\s+\(([^)]+)\)\s*[-–]\s*(\d[\d,]*)\s+loss(?:es)?\s*[-–]\s*(\d[\d,]*)\s+ties?/i);
  const summary = sm ? {
    wins:    parseInt(sm[1].replace(/,/g, '')),
    winRate: sm[2],
    losses:  parseInt(sm[3].replace(/,/g, '')),
    ties:    parseInt(sm[4].replace(/,/g, '')),
  } : null;

  // Tournament appearances
  // Row structure: player | tournament | date | placement | record
  const results = [];
  for (const row of extractRows(html)) {
    const tds = extractTds(row);
    if (tds.length < 5) continue;

    const player     = strip(tds[0]);
    const tournament = strip(tds[1]);
    const placement  = strip(tds[3]);  // "1st of 275"
    const record     = strip(tds[4]);  // "11 - 2 - 0"

    const dlMatch = tds[0].match(/href="([^"]*\/decklist[^"]*)"/);
    const decklistPath = dlMatch?.[1] ?? null;

    if (!player || !/^\d/.test(placement)) continue;
    results.push({ player, tournament, placement, record, decklistUrl: decklistPath ? BASE + decklistPath : null });
    if (results.length >= 10) break;
  }

  return { slug, summary, results };
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch and parse the meta deck list.
 * @param {string|null} setId  e.g. 'B2b', or null for current standard
 */
async function fetchMetaDecks(setId = null) {
  const key = setId ?? 'all';
  const hit = listCache.get(key);
  if (hit && Date.now() - hit.fetchedAt < LIST_TTL) return hit.decks;

  const url = setId
    ? `${BASE}/decks?game=pocket&set=${setId}`
    : `${BASE}/decks?game=pocket`;

  const html  = await fetchHtml(url);
  const decks = parseDecks(html);
  listCache.set(key, { decks, fetchedAt: Date.now() });
  return decks;
}

/**
 * Fetch and parse a single deck's detail page.
 * @param {string} slug  e.g. 'mega-altaria-ex-b1-igglybuff-a4a'
 * @param {string|null} setId  for the set query param
 */
async function fetchDeckDetail(slug, setId = null) {
  const key = `${slug}|${setId ?? 'all'}`;
  const hit = detailCache.get(key);
  if (hit && Date.now() - hit.fetchedAt < DETAIL_TTL) return hit.detail;

  const setParam = setId ? `&set=${setId}` : '';
  const url  = `${BASE}/decks/${slug}?game=POCKET&format=standard${setParam}`;
  const html = await fetchHtml(url);
  const detail = parseDetail(html, slug);
  detailCache.set(key, { detail, fetchedAt: Date.now() });
  return detail;
}

// ── Decklist parser ───────────────────────────────────────────────────────────

/**
 * Parse the newline-separated decklist string from Limitless.
 * Each line: "[count] [name...] [setId] [num]"
 * Returns array of { count, name, set, num }
 */
function parseDecklist(str) {
  const cards = [];
  for (const raw of str.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const tokens = line.split(' ');
    if (tokens.length < 4) continue;
    const count = parseInt(tokens[0]);
    if (isNaN(count)) continue;
    const num = parseInt(tokens[tokens.length - 1]);
    const set = tokens[tokens.length - 2];
    const name = tokens.slice(1, tokens.length - 2).join(' ');
    if (!name || isNaN(num)) continue;
    cards.push({ count, name, set, num });
  }
  return cards;
}

/**
 * Fetch and parse a player's decklist page.
 * @param {string} decklistPath  e.g. '/tournament/abc/player/foo/decklist'
 */
async function fetchDecklist(decklistPath) {
  const url  = BASE + decklistPath;
  const html = await fetchHtml(url);
  // Extract the template literal: const decklist = `...`
  const m = html.match(/const decklist\s*=\s*`([^`]*)`/);
  if (!m) return [];
  return parseDecklist(m[1].trim());
}

/** Deck list URL for linking back to Limitless */
function deckUrl(slug, setId = null) {
  const setParam = setId ? `&set=${setId}` : '';
  return `${BASE}/decks/${slug}?game=POCKET&format=standard${setParam}`;
}

/** Cache age string for footer */
function cacheAge(setId = null) {
  const key = setId ?? 'all';
  const hit = listCache.get(key);
  if (!hit) return 'live';
  const mins = Math.floor((Date.now() - hit.fetchedAt) / 60000);
  return mins < 1 ? 'just now' : `${mins}m ago`;
}

/** Force-refresh the deck list cache for a given set (or all). */
async function refreshCache(setId = null) {
  const key = setId ?? 'all';
  listCache.delete(key);
  return fetchMetaDecks(setId);
}

/**
 * Start a daily background refresh.
 * Runs once at startup, then every 24 hours at the same time-of-day.
 * @param {string[]} setIds  Set IDs to refresh, plus null for "all"
 */
function startDailyRefresh(setIds = []) {
  const targets = [null, ...setIds]; // always refresh "all"

  const run = async () => {
    const ts = new Date().toISOString();
    console.log(`[meta] Daily refresh started at ${ts}`);
    for (const id of targets) {
      try {
        const decks = await refreshCache(id);
        console.log(`[meta] Refreshed set=${id ?? 'all'}: ${decks.length} decks`);
      } catch (e) {
        console.error(`[meta] Refresh failed for set=${id ?? 'all'}:`, e.message);
      }
    }
  };

  // Run once at startup
  run();

  // Then every 24 hours
  setInterval(run, 24 * 60 * 60 * 1000);
}

module.exports = { fetchMetaDecks, fetchDeckDetail, fetchDecklist, deckUrl, cacheAge, startDailyRefresh };
