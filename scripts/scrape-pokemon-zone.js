'use strict';

/**
 * scripts/scrape-pokemon-zone.js
 *
 * Scrapes HP + weakness data from pokemon-zone.com for B2a and B2b cards
 * (which are not yet in the tcgdex API) and writes results back to the DB.
 *
 * Uses curl.exe (built into Windows 11) to bypass Cloudflare — Node.js's
 * built-in fetch gets blocked (HTTP 403) due to TLS fingerprint detection.
 *
 * Usage:
 *   node scripts/scrape-pokemon-zone.js          # only cards with hp = null
 *   node scripts/scrape-pokemon-zone.js --force  # re-fetch all B2a/B2b cards
 *
 * Saves progress every 20 cards — safe to Ctrl-C and resume.
 * Estimated time: ~3 min for 248 cards at 500 ms/request.
 */

const fs            = require('fs');
const path          = require('path');
const { execSync }  = require('child_process');

const DB_PATH    = path.join(__dirname, '../data/ptcgp_cards.json');
const DELAY_MS   = 600;
const SAVE_EVERY = 20;
const FORCE      = process.argv.includes('--force');

// Pass set IDs as arguments to scrape specific sets, e.g.:
//   node scripts/scrape-pokemon-zone.js A4a
//   node scripts/scrape-pokemon-zone.js A4a B1 B2
//   node scripts/scrape-pokemon-zone.js        ← uses defaults below
const argSets = process.argv.slice(2).filter(a => !a.startsWith('--'));
const SETS_TO_SCRAPE = argSets.length > 0 ? argSets : ['A4b', 'B2a', 'B2b'];

// CSS class suffix → canonical type name
const TYPE_MAP = {
  grass:     'Grass',
  fire:      'Fire',
  water:     'Water',
  lightning: 'Lightning',
  psychic:   'Psychic',
  fighting:  'Fighting',
  dark:      'Darkness',
  darkness:  'Darkness',
  metal:     'Metal',
  dragon:    'Dragon',
  colorless: 'Colorless',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Fetch a URL using curl.exe and return the response body as a string.
 * Returns null on error or non-200 status.
 */
function curlGet(url) {
  try {
    // -s: silent, -L: follow redirects, --fail: exit non-zero on 4xx/5xx
    // -A: User-Agent, --max-time: timeout
    const result = execSync(
      `curl -s -L --fail --max-time 20 ` +
      `-A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36" ` +
      `-H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8" ` +
      `-H "Accept-Language: en-US,en;q=0.9" ` +
      `-H "Cache-Control: no-cache" ` +
      `"${url}"`,
      { encoding: 'utf8', timeout: 25_000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return result;
  } catch {
    return null;
  }
}

/**
 * Fetch set page and return Map<cardNum, slug>.
 * e.g. 1 → 'sprigatito', 129 → 'tinkaton-ex'
 */
function fetchSetSlugs(setId) {
  const url  = `https://www.pokemon-zone.com/sets/${setId.toLowerCase()}/`;
  const html = curlGet(url);
  if (!html) return null;

  // href="/cards/b2a/1/sprigatito/"
  const re   = /href="\/cards\/[^/]+\/(\d+)\/([^/"]+)\/"/g;
  const slugs = new Map();
  let m;
  while ((m = re.exec(html)) !== null) {
    const num  = parseInt(m[1], 10);
    const slug = m[2];
    if (!slugs.has(num)) slugs.set(num, slug); // keep first occurrence
  }
  return slugs;
}

/**
 * Derive a likely URL slug from an English card name.
 * Used as fallback when the set page fetch fails.
 * e.g. "Tinkaton ex" → "tinkaton-ex", "Mr. Mime" → "mr-mime"
 */
function nameToSlug(name) {
  return name
    .toLowerCase()
    .replace(/[''`]/g, '')        // remove apostrophes
    .replace(/\./g, '')           // remove dots (Mr. → mr)
    .replace(/[^a-z0-9\s-]/g, '') // remove other special chars
    .trim()
    .replace(/\s+/g, '-');
}

/**
 * Fetch an individual card page and extract { hp, weakness }.
 * Returns null on network error; returns { hp: null, weakness: null } for trainers.
 */
function fetchCardStats(setId, num, slug) {
  const url  = `https://www.pokemon-zone.com/cards/${setId.toLowerCase()}/${num}/${slug}/`;
  const html = curlGet(url);
  if (!html) return null;

  // ── HP ──────────────────────────────────────────────────────────────────────
  // <span>HP</span><span class="fs-1 lh-1">60</span>
  const hpMatch = html.match(/class="[^"]*\bfs-1\b[^"]*\blh-1\b[^"]*"\s*>(\d+)<\/span>/);
  const hp      = hpMatch ? parseInt(hpMatch[1], 10) : null;

  // ── Weakness ─────────────────────────────────────────────────────────────────
  const weakIdx = html.indexOf('>Weakness<');
  let weakness  = null;
  if (weakIdx !== -1) {
    const chunk      = html.slice(weakIdx, weakIdx + 600);
    const typeMatch  = chunk.match(/energy-icon--type-([a-z]+)/);
    const valueMatch = chunk.match(/<div>(\+\d+)<\/div>/);
    if (typeMatch && valueMatch) {
      const typeRaw  = typeMatch[1];
      const typeName = TYPE_MAP[typeRaw] ?? (typeRaw.charAt(0).toUpperCase() + typeRaw.slice(1));
      weakness       = { type: typeName, value: valueMatch[1] };
    }
  }

  return { hp, weakness };
}

// ── Main ──────────────────────────────────────────────────────────────────────

const db    = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
const cards = db.cards;

const toProcess = cards.filter(c =>
  SETS_TO_SCRAPE.includes(c.set) && (FORCE || c.hp === null),
);

console.log(`📦 Total DB cards : ${cards.length}`);
console.log(`🔍 Cards to scrape: ${toProcess.length}${FORCE ? ' (force)' : ' (hp = null only)'}`);
console.log(`⏱  Estimated time : ~${Math.ceil(toProcess.length * DELAY_MS / 60000)} min\n`);

if (toProcess.length === 0) {
  console.log('✅ Nothing to do — all B2a/B2b cards already have HP data.');
  console.log('   Run with --force to re-scrape everything.');
  process.exit(0);
}

let done = 0, enriched = 0, skipped = 0, saveCount = 0;

function saveDb() {
  db.generated = new Date().toISOString();
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
  saveCount++;
}

(async () => {
  // Phase 1: load slug maps for each set we need
  const slugMaps = {};
  for (const setId of SETS_TO_SCRAPE) {
    if (!toProcess.some(c => c.set === setId)) continue;
    process.stdout.write(`🌐 Loading card list for ${setId}... `);
    const slugs = fetchSetSlugs(setId);
    if (slugs && slugs.size > 0) {
      slugMaps[setId] = slugs;
      console.log(`${slugs.size} cards found`);
    } else {
      console.log(`FAILED — will derive slugs from card names`);
      slugMaps[setId] = null; // signal to use name-derived slugs
    }
    await sleep(DELAY_MS);
  }

  console.log();

  // Phase 2: scrape each card
  for (const card of toProcess) {
    done++;
    const slugMap = slugMaps[card.set];

    // Prefer slug from set page; fall back to deriving from English name
    let slug = slugMap?.get(card.num);
    if (!slug && card.names?.en) {
      slug = nameToSlug(card.names.en);
    }

    process.stdout.write(`[${done}/${toProcess.length}] ${card.uid.padEnd(8)} `);

    if (!slug) {
      console.log('— no slug');
      skipped++;
      if (done % SAVE_EVERY === 0) saveDb();
      await sleep(50);
      continue;
    }

    const stats = fetchCardStats(card.set, card.num, slug);

    if (!stats) {
      // Try once more with name-derived slug if set-page slug didn't work
      const fallbackSlug = card.names?.en ? nameToSlug(card.names.en) : null;
      const stats2 = (fallbackSlug && fallbackSlug !== slug)
        ? fetchCardStats(card.set, card.num, fallbackSlug)
        : null;

      if (!stats2) {
        console.log('— fetch error');
        skipped++;
      } else {
        card.hp      = stats2.hp;
        card.weakness = stats2.weakness;
        enriched++;
        const wStr = stats2.weakness ? `  weak: ${stats2.weakness.type} ${stats2.weakness.value}` : '';
        console.log(`→ HP ${stats2.hp ?? '—'}${wStr}  (fallback slug)`);
      }
    } else if (stats.hp === null && !stats.weakness) {
      // Trainer/item card — no HP by design
      skipped++;
      console.log('— trainer (no HP)');
    } else {
      card.hp      = stats.hp;
      card.weakness = stats.weakness;
      enriched++;
      const wStr = stats.weakness ? `  weak: ${stats.weakness.type} ${stats.weakness.value}` : '';
      console.log(`→ HP ${stats.hp ?? '—'}${wStr}`);
    }

    if (done % SAVE_EVERY === 0) {
      saveDb();
      console.log(`   💾 Saved (${done}/${toProcess.length})\n`);
    }

    await sleep(DELAY_MS);
  }

  // Final save
  saveDb();

  console.log('\n' + '='.repeat(60));
  console.log('✅ Done!');
  console.log(`   Enriched : ${enriched} cards`);
  console.log(`   Skipped  : ${skipped} (trainers + errors + no slug)`);
  console.log(`   Saves    : ${saveCount}`);
  console.log(`   Output   : ${DB_PATH}`);
})();
