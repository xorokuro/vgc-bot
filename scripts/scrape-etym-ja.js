'use strict';

/**
 * scrape-etym-ja.js
 *
 * Fetches Japanese-language etymology text from the Japanese Pokémon Wiki
 * (wiki.xn--rckteqa2e.com) and writes it into data/etymology.json.
 *
 * Usage:
 *   node scripts/scrape-etym-ja.js           # only fill empty ja fields
 *   node scripts/scrape-etym-ja.js --all     # overwrite all ja fields
 *   node scripts/scrape-etym-ja.js --dry     # print what would change, no write
 *   node scripts/scrape-etym-ja.js 25        # only scrape dex ID 25 (Pikachu)
 *   node scripts/scrape-etym-ja.js bulbasaur # only scrape by EN name
 */

const fs   = require('fs');
const path = require('path');

const ETYM_PATH = path.join(__dirname, '../data/etymology.json');
const TRI_PATH  = path.join(__dirname, '../data/trilingual.json');
const WIKI_BASE = 'https://wiki.xn--rckteqa2e.com/wiki/';
const DELAY_MS  = 700; // be polite — don't hammer the wiki

const overwriteAll = process.argv.includes('--all');
const dryRun       = process.argv.includes('--dry');
const targetArg    = process.argv.find(a => !a.startsWith('-') && a !== process.argv[0] && a !== process.argv[1]);

// ── HTML helpers ──────────────────────────────────────────────────────────────

function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&nbsp;/g, ' ');
}

function stripHtml(html) {
  // collapse whitespace and strip tags
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ')).trim();
}

/**
 * Parse all <tr> rows from HTML, return array of arrays of cell text strings.
 * Handles both <td> and <th>.
 */
function parseTableRows(html) {
  const rows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;
  while ((trMatch = trRe.exec(html)) !== null) {
    const rowHtml = trMatch[1];
    const cells = [];
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowHtml)) !== null) {
      cells.push(stripHtml(cellMatch[1]));
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

// ── Scraper ───────────────────────────────────────────────────────────────────

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Fetch the JP wiki page for a Pokémon and extract its Japanese etymology text.
 * Returns the etymology string or null if not found.
 */
async function fetchJaEtym(jaName) {
  const url = WIKI_BASE + encodeURIComponent(jaName);
  let html;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'pokemon-vocab-bot/1.0 (educational scraper)' },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404) return null;
    if (!res.ok) { console.warn(`  HTTP ${res.status}`); return null; }
    html = await res.text();
  } catch (e) {
    console.warn(`  Fetch error: ${e.message}`);
    return null;
  }

  // Parse every table row in the page, look for the 日本語 row with 3 cells.
  // The 由来 column is the third cell.
  const rows = parseTableRows(html);
  for (const cells of rows) {
    if (cells.length >= 3 && cells[0] === '日本語') {
      const etym = cells[2];
      return etym || null;
    }
  }
  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const etymData = JSON.parse(fs.readFileSync(ETYM_PATH, 'utf8'));
  const triData  = JSON.parse(fs.readFileSync(TRI_PATH,  'utf8'));

  if (!etymData.pokemon) etymData.pokemon = {};

  const allPokemon = Object.entries(triData.pokemon); // [ [id, { en, ja, zh }], ... ]

  // Filter to only target(s) if a CLI arg was provided
  let targets = allPokemon;
  if (targetArg) {
    targets = allPokemon.filter(([id, names]) =>
      id === targetArg ||
      names.en?.toLowerCase() === targetArg.toLowerCase() ||
      names.ja === targetArg
    );
    if (targets.length === 0) {
      console.error(`No Pokémon found matching "${targetArg}"`);
      process.exit(1);
    }
  }

  let updated = 0;
  let skipped = 0;
  let failed  = 0;

  for (let i = 0; i < targets.length; i++) {
    const [id, names] = targets[i];
    const jaName = names.ja;

    if (!jaName) {
      process.stdout.write(`[${i+1}/${targets.length}] #${id.padStart(4,'0')} ${names.en ?? '?'} — no JP name, skip\n`);
      skipped++;
      continue;
    }

    // Skip if already has ja etymology and --all not set
    const existing = etymData.pokemon[id];
    if (!overwriteAll && existing?.ja) {
      skipped++;
      continue;
    }

    process.stdout.write(`[${i+1}/${targets.length}] #${id.padStart(4,'0')} ${names.en} (${jaName})… `);

    const jaEtym = await fetchJaEtym(jaName);

    if (jaEtym) {
      if (!dryRun) {
        if (!etymData.pokemon[id]) etymData.pokemon[id] = { ja: '', en: '', zh: '' };
        etymData.pokemon[id].ja = jaEtym;
      }
      updated++;
      const preview = jaEtym.length > 70 ? jaEtym.slice(0, 70) + '…' : jaEtym;
      console.log(`✓ ${preview}`);
    } else {
      failed++;
      console.log('— not found on wiki');
    }

    // Save every 20 updates so we don't lose everything on a crash
    if (!dryRun && updated > 0 && updated % 20 === 0) {
      fs.writeFileSync(ETYM_PATH, JSON.stringify(etymData, null, 2), 'utf8');
      console.log('  [checkpoint saved]');
    }

    if (i < targets.length - 1) await sleep(DELAY_MS);
  }

  // Final save
  if (!dryRun && updated > 0) {
    fs.writeFileSync(ETYM_PATH, JSON.stringify(etymData, null, 2), 'utf8');
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Updated : ${updated}`);
  console.log(`Skipped : ${skipped}${overwriteAll ? '' : ' (already had ja — use --all to overwrite)'}`);
  console.log(`Not found: ${failed}`);
  if (dryRun) console.log('(dry run — nothing was written)');
}

main().catch(e => { console.error(e); process.exit(1); });
