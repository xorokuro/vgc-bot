'use strict';

/**
 * scripts/scrape-champion-moves.js
 *
 * Scrapes the move pool for every Pokémon in pokedex_champion_db.json
 * from Serebii.net/pokedex-champions/ and writes data/champion_moves_db.json.
 *
 * Output format: { "727": ["Acrobatics", "Aerial Ace", ...], ... }
 * Keys are dex_id strings. Forms (Megas, regional variants, etc.) that share
 * the same Serebii page inherit the same move list.
 *
 * Uses curl.exe (built into Windows 11) to bypass Cloudflare protection.
 *
 * Usage:
 *   node scripts/scrape-champion-moves.js           # skip already-scraped
 *   node scripts/scrape-champion-moves.js --force   # re-scrape all
 *   node scripts/scrape-champion-moves.js 727       # single dex ID
 */

const fs           = require('fs');
const path         = require('path');
const { execSync } = require('child_process');

const CHAMPION_DB_PATH = path.join(__dirname, '../data/pokedex_champion_db.json');
const OUT_PATH         = path.join(__dirname, '../data/champion_moves_db.json');
const SEREBII_BASE     = 'https://www.serebii.net/pokedex-champions/';
const DELAY_MS         = 800;
const SAVE_EVERY       = 20;

const FORCE     = process.argv.includes('--force');
const singleArg = process.argv.find(a => /^\d+$/.test(a));

// ── Load existing output (resume support) ──────────────────────────────────────
let out = {};
if (!FORCE && fs.existsSync(OUT_PATH)) {
  out = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'));
}

// ── Load champion DB ───────────────────────────────────────────────────────────
const championDb = JSON.parse(fs.readFileSync(CHAMPION_DB_PATH, 'utf8'));

// Build map: dex_id → base form name_en (prefer form_id=0)
const baseByDex = {};
for (const e of Object.values(championDb)) {
  const id = String(e.dex_id);
  if (e.form_id === 0 || !baseByDex[id]) {
    baseByDex[id] = e.name_en;
  }
}

const dexIds = singleArg
  ? [singleArg]
  : Object.keys(baseByDex).sort((a, b) => Number(a) - Number(b));

const toProcess = FORCE
  ? dexIds
  : dexIds.filter(id => !out[id]);

console.log(`📦 Total dex IDs : ${dexIds.length}`);
console.log(`🔍 To scrape      : ${toProcess.length}${FORCE ? ' (force)' : ' (skipping done)'}`);
console.log(`⏱  Est. time      : ~${Math.ceil(toProcess.length * DELAY_MS / 60000)} min\n`);

if (!toProcess.length) {
  console.log('✅ Nothing to do.');
  process.exit(0);
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

function curlGet(url) {
  try {
    return execSync(
      `curl -s -L --fail --max-time 20 ` +
      `-A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36" ` +
      `-H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" ` +
      `-H "Accept-Language: en-US,en;q=0.9" ` +
      `-H "Cache-Control: no-cache" ` +
      `"${url}"`,
      { encoding: 'utf8', timeout: 25_000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
  } catch {
    return null;
  }
}

/**
 * Derive Serebii URL slug from English Pokémon name.
 * Matches Serebii's conventions for their Champion Pokédex URLs.
 */
function nameToSlug(nameEn) {
  let s = nameEn.toLowerCase();
  // Strip parenthetical form suffixes: "Rattata (Alolan Form)" → "rattata"
  s = s.replace(/\s*\([^)]+\)/g, '').trim();
  // Gender symbols
  s = s.replace(/♀/g, '-f').replace(/♂/g, '-m');
  // Apostrophes (Farfetch'd → farfetchd)
  s = s.replace(/[''`]/g, '');
  // Colons (Type: Null → typenull)
  s = s.replace(/:/g, '');
  // Spaces → removed (tapukoko, mrmime, etc.)
  s = s.replace(/\s+/g, '');
  // Keep hyphens (nidoran-f) and dots (mr.mime)
  // Remove anything else unexpected
  s = s.replace(/[^a-z0-9.\-]/g, '');
  return s;
}

/**
 * Generate fallback slug variants to try if the primary slug returns nothing.
 */
function slugVariants(slug) {
  const variants = [slug];
  // Try with dots removed (mr.mime → mrmime)
  if (slug.includes('.')) variants.push(slug.replace(/\./g, ''));
  // Try with hyphens removed
  if (slug.includes('-')) variants.push(slug.replace(/-/g, ''));
  // Try trimming after first hyphen (regional form base: "raticate-alola" → "raticate")
  const dashIdx = slug.indexOf('-');
  if (dashIdx > 0) variants.push(slug.slice(0, dashIdx));
  return [...new Set(variants)];
}

/**
 * Extract move names from Serebii HTML.
 * Moves appear as: <td ... class="fooinfo"><a href="/attackdex-champions/movename.shtml">Move Name</a></td>
 * We capture the display text of all attackdex-champions links (excluding the index link).
 */
function parseMoves(html) {
  const moves = [];
  const re = /href="\/attackdex-champions\/[a-z0-9]+\.shtml"[^>]*>([^<]+)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const name = m[1].trim();
    if (name && !moves.includes(name)) moves.push(name);
  }
  return moves.sort();
}

// ── Main ───────────────────────────────────────────────────────────────────────

let done = 0, scraped = 0, failed = 0, saveCount = 0;

function saveOut() {
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2), 'utf8');
  saveCount++;
}

(async () => {
  for (const dexId of toProcess) {
    done++;
    const baseName = baseByDex[dexId];
    const primarySlug = nameToSlug(baseName);
    const variants = slugVariants(primarySlug);

    process.stdout.write(`[${done}/${toProcess.length}] #${dexId.padStart(4)} ${baseName.padEnd(24)} `);

    let moves = null;
    let usedSlug = null;

    for (const slug of variants) {
      const url  = `${SEREBII_BASE}${slug}/`;
      const html = curlGet(url);
      if (!html) continue;
      const parsed = parseMoves(html);
      if (parsed.length > 0) {
        moves    = parsed;
        usedSlug = slug;
        break;
      }
    }

    if (moves && moves.length > 0) {
      out[dexId] = moves;
      scraped++;
      const suffix = usedSlug !== primarySlug ? ` (slug: ${usedSlug})` : '';
      console.log(`→ ${moves.length} moves${suffix}`);
    } else {
      out[dexId] = [];
      failed++;
      console.log(`— no moves (not in game or fetch error)`);
    }

    if (done % SAVE_EVERY === 0) {
      saveOut();
      console.log(`   💾 Saved (${done}/${toProcess.length})\n`);
    }

    await sleep(DELAY_MS);
  }

  saveOut();

  console.log('\n' + '='.repeat(60));
  console.log('✅ Done!');
  console.log(`   Scraped : ${scraped} Pokémon with moves`);
  console.log(`   Failed  : ${failed} (not in game or fetch error)`);
  console.log(`   Saves   : ${saveCount}`);
  console.log(`   Output  : ${OUT_PATH}`);
})();
