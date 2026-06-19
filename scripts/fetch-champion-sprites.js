'use strict';

/**
 * scripts/fetch-champion-sprites.js
 *
 * Downloads a HOME-style sprite for every form in web/data.js into web/sprites/,
 * so the standalone tool is fully self-contained (offline, form-accurate).
 *
 * Source per form:
 *   - Official forms  → Pokémon Showdown HOME  (play.pokemonshowdown.com/sprites/home/<slug>.png)
 *   - Fan Megas (404 on Showdown) → Serebii Champions  (serebii.net/pokemonhome/pokemon/small/<dex>-<m|mx|my>.png)
 * Saved as web/sprites/<slug>.png (slug = the bundle's p.sprite / p.spriteBase).
 *
 * Re-run any time after rebuilding web/data.js; existing files are skipped.
 * Usage:  node scripts/fetch-champion-sprites.js [--force]
 */

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT    = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'web', 'sprites');
const FORCE   = process.argv.includes('--force');
const DELAY   = 150;
const PS      = 'https://play.pokemonshowdown.com/sprites/home/';
const SEREBII = 'https://www.serebii.net/pokemonhome/pokemon/small/';

global.window = {};
require(path.join(ROOT, 'web', 'data.js'));
const P = global.window.DEX.pokemon;

fs.mkdirSync(OUT_DIR, { recursive: true });

// slug → { dex, megaSuffix|null }  (megaSuffix used only for the Serebii fallback)
const slugs = new Map();
function addSlug(slug, dex) {
  if (!slug || slugs.has(slug)) return;
  let mega = null;
  if (slug.endsWith('-megax')) mega = 'mx';
  else if (slug.endsWith('-megay')) mega = 'my';
  else if (slug.endsWith('-mega')) mega = 'm';
  slugs.set(slug, { dex, mega });
}
for (const p of P) { addSlug(p.sprite, p.dex); addSlug(p.spriteBase, p.dex); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
function curlSave(url, dest) {
  try {
    const code = execSync(
      `curl -s -L --max-time 25 -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122 Safari/537.36" ` +
      `-w "%{http_code}" -o "${dest}" "${url}"`,
      { encoding: 'utf8' },
    ).trim();
    if (code === '200' && fs.existsSync(dest) && fs.statSync(dest).size > 200) return true;
    if (fs.existsSync(dest)) fs.unlinkSync(dest); // remove 404 html / empties
    return false;
  } catch { return false; }
}

(async () => {
  const list = [...slugs.entries()];
  let ok = 0, serebii = 0, fail = 0, skip = 0;
  const failed = [];
  console.log(`📦 ${list.length} unique sprites → web/sprites/\n`);
  let i = 0;
  for (const [slug, info] of list) {
    i++;
    const dest = path.join(OUT_DIR, slug + '.png');
    if (!FORCE && fs.existsSync(dest)) { skip++; continue; }

    let got = curlSave(PS + slug + '.png', dest);
    let src = 'PS';
    if (!got && info.mega) {
      const id = String(info.dex).padStart(3, '0') + '-' + info.mega;
      got = curlSave(SEREBII + id + '.png', dest);
      if (got) src = 'Serebii(' + id + ')';
    }
    if (got) { ok++; if (src.startsWith('Serebii')) serebii++; }
    else { fail++; failed.push(slug); }
    process.stdout.write(`\r[${i}/${list.length}] ok:${ok} serebii:${serebii} skip:${skip} fail:${fail}   `);
    await sleep(DELAY);
  }
  console.log('\n\n✅ done');
  console.log(`   downloaded: ${ok}  (of which Serebii fan-Megas: ${serebii})`);
  console.log(`   skipped (already present): ${skip}`);
  if (failed.length) console.log(`   FAILED (${failed.length}): ${failed.join(', ')}`);
})();
