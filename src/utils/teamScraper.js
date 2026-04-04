'use strict';

/**
 * Team article scraper for Pokémon battle team-sharing sites.
 *
 * Persistence: every network fetch is written to data/teams_cache/ so the bot
 * survives restarts without re-downloading data it already has.
 *
 * Page 1 (newest entries) expires in 30 min; all other pages expire in 24 h.
 *
 * Adding a new game: add an entry to SITE_CONFIGS.
 * Adding singles: set available: true in the singles format entry.
 */

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

// ── Site configurations ───────────────────────────────────────────────────────
const SITE_CONFIGS = {
  sv: {
    labelZh:    '朱紫 (SV)',
    labelEn:    'Scarlet/Violet',
    labelJa:    'スカーレット・バイオレット',
    baseUrl:    'https://sv.pokedb.tokyo',
    searchPath: '/article/search',
    color:      0xE63A2E,
    formats: {
      doubles: { rule: 1, labelZh: '雙打', labelEn: 'Doubles', labelJa: 'ダブル', available: true  },
      singles: { rule: 0, labelZh: '單打', labelEn: 'Singles', labelJa: 'シングル', available: true  },
    },
  },
  // Future game skeleton:
  // plza: {
  //   labelZh: '傳說Z-A', labelEn: 'Legends: Z-A',
  //   baseUrl: 'https://???.pokedb.tokyo', searchPath: '/article/search',
  //   color: 0x3B4CCA,
  //   formats: {
  //     doubles: { rule: 1, labelZh: '雙打', available: false },
  //     singles: { rule: 0, labelZh: '單打', available: false },
  //   },
  // },
};

// ── Disk cache ────────────────────────────────────────────────────────────────
const CACHE_DIR = path.join(__dirname, '../../data/teams_cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

const _mem = new Map();
const TTL_PAGE1 = 30  * 60 * 1000;       // 30 min for page 1 (catch new entries)
const TTL_OTHER = 24  * 60 * 60 * 1000;  // 24 h for all other pages

function cacheKey(gameId, format, page, season) {
  return `${gameId}:${format}:${season || 0}:${page}`;
}
function diskFile(gameId, format, page, season) {
  const s = season ? `_s${season}` : '';
  return path.join(CACHE_DIR, `${gameId}_${format}${s}_${page}.json`);
}

// Pre-load all existing disk files into memory on startup
(function preload() {
  let n = 0;
  try {
    for (const file of fs.readdirSync(CACHE_DIR)) {
      if (!file.endsWith('.json')) continue;
      try {
        const { gameId, format, pageNum, data, season = 0 } = JSON.parse(
          fs.readFileSync(path.join(CACHE_DIR, file), 'utf8'),
        );
        if (!gameId || !format || !pageNum || !data) continue;
        const ttl = pageNum === 1 ? 0 : TTL_OTHER;
        _mem.set(cacheKey(gameId, format, pageNum, season), { data, expires: Date.now() + ttl });
        n++;
      } catch { /* skip corrupt file */ }
    }
  } catch { /* dir unreadable */ }
  if (n) console.log(`[teams] Pre-loaded ${n} cached page(s) from disk`);
})();

function memStore(gameId, format, pageNum, data, season) {
  const ttl = pageNum === 1 ? TTL_PAGE1 : TTL_OTHER;
  _mem.set(cacheKey(gameId, format, pageNum, season), { data, expires: Date.now() + ttl });
  fs.writeFile(
    diskFile(gameId, format, pageNum, season),
    JSON.stringify({ gameId, format, pageNum, data, season: season || 0 }),
    err => { if (err) console.warn(`[teams] disk write failed ${gameId}/${format}/${pageNum}:`, err.message); },
  );
}

// ── HTTP fetch ────────────────────────────────────────────────────────────────
function fetchUrl(url, depth = 0) {
  if (depth > 5) return Promise.reject(new Error('Too many redirects'));
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PokemonBot/1.0)', 'Accept-Language': 'ja' },
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        return fetchUrl(next, depth + 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const chunks = [];
      res.on('data',  c => chunks.push(c));
      res.on('end',   () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ── HTML helpers ──────────────────────────────────────────────────────────────
function allMatches(html, re) {
  const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
  const g = new RegExp(re.source, flags);
  const out = []; let m;
  while ((m = g.exec(html)) !== null) out.push(m);
  return out;
}
function stripTags(s) { return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); }

// ── Parse one card chunk ──────────────────────────────────────────────────────
// Each team member gets a full object: dex class, item ID, tera type.
function parseCard(chunk) {
  const seasonM    = chunk.match(/class="tag is-primary is-marginless">([^<]+)</);
  const regM       = chunk.match(/class="tag is-light is-marginless is-family-code">([^<]+)</);
  const rankM      = chunk.match(/>(\d+)位</);
  const ratingM    = chunk.match(/>(\d{3,5}\.\d{1,6})</);
  const playerM    = chunk.match(/class="title is-6 has-text-weight-normal">\s*([^<]+?)\s*</);
  const footerM    = chunk.match(/class="card-footer">([\s\S]*?)(?:<\/footer>|$)/);
  const footerHtml = footerM ? footerM[1] : '';
  const hrefM      = footerHtml.match(/href="([^"]+)"/);

  // Per-member data: split on each article-pokemon div so we get matching
  // pokemon / tera / item triples in order.
  const memberChunks = allMatches(chunk, /<div class="article-pokemon[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/);
  const members = memberChunks.map(mc => {
    const pokeM = mc[1].match(/class="i-p (dex-[\d-]+)" title="([^"]+)"/);
    const teraM = mc[1].match(/class="i-t i-t24 tt-(\d+)" title="([^"]+)"/);
    const itemM = mc[1].match(/class="i-i i-i24 i-(\d+)" title="([^"]+)"/);
    return {
      dexClass:     pokeM?.[1] ?? '',    // e.g. "dex-1005-00"
      name:         pokeM?.[2] ?? '',    // Japanese name
      teraTypeId:   teraM?.[1] ?? null,  // e.g. "9"
      teraTypeName: teraM?.[2] ?? '',    // e.g. "ほのお"
      itemId:       itemM?.[1] ?? null,  // e.g. "1880"
      itemName:     itemM?.[2] ?? '',    // e.g. "ブーストエナジー"
    };
  });

  return {
    season:       seasonM?.[1]?.trim() ?? '',
    regulation:   regM?.[1]?.trim()    ?? '',
    rank:         rankM  ? parseInt(rankM[1],  10) : null,
    rating:       ratingM ? ratingM[1]              : null,
    player:       playerM?.[1]?.trim() ?? '',
    members,                                   // rich per-member data
    // convenience aliases (backward-compat for the text embed display)
    pokemon:      members.map(m => m.name),
    items:        members.map(m => m.itemName),
    articleUrl:   hrefM ? hrefM[1].trim() : '',
    articleTitle: stripTags(footerHtml),
  };
}

// ── Public API ────────────────────────────────────────────────────────────────
async function fetchTeamPage(gameId, format, pageNum, season) {
  const key    = cacheKey(gameId, format, pageNum, season);
  const cached = _mem.get(key);
  if (cached && cached.expires > Date.now()) return cached.data;

  const cfg = SITE_CONFIGS[gameId];
  if (!cfg) throw new Error(`未知遊戲：${gameId}`);
  const fmt = cfg.formats[format];
  if (!fmt) throw new Error(`未知賽制：${format}`);
  if (!fmt.available) throw new Error(`${fmt.labelZh} 尚未開放，請稍後再試。`);

  const seasonParam = season ? `&season_start=${season}&season_end=${season}` : '';
  const url  = `${cfg.baseUrl}${cfg.searchPath}?rule=${fmt.rule}${seasonParam}&page=${pageNum}`;
  const html = await fetchUrl(url);

  const countM     = html.match(/<span class="tag">([\d,]+)件<\/span>/);
  const totalCount = countM ? parseInt(countM[1].replace(/,/g, ''), 10) : 0;
  const pageNums   = allMatches(html, /[?&]page=(\d+)/).map(m => parseInt(m[1], 10));
  const totalPages = pageNums.length ? Math.max(...pageNums) : pageNum;

  const chunks = html.split('<div class="column is-half-desktop">');
  chunks.shift();
  const teams = chunks.map(parseCard).filter(t => t.members.length > 0 || t.player);

  const data = { teams, totalCount, totalPages, pageNum };
  memStore(gameId, format, pageNum, data, season);
  return data;
}

/** Get the localized game label for a given lang ('zh'|'en'|'ja'). */
function cfgLabel(cfg, lang) {
  return lang === 'en' ? cfg.labelEn : lang === 'ja' ? cfg.labelJa : cfg.labelZh;
}
/** Get the localized format label for a given lang. */
function fmtLabel(fmt, lang) {
  return lang === 'en' ? fmt.labelEn : lang === 'ja' ? fmt.labelJa : fmt.labelZh;
}

module.exports = { fetchTeamPage, SITE_CONFIGS, cfgLabel, fmtLabel };
