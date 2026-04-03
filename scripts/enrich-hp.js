'use strict';

/**
 * scripts/enrich-hp.js
 *
 * Fetches HP and weakness data from the tcgdex API for every card in
 * data/ptcgp_cards.json and writes the results back.
 *
 * Usage:
 *   node scripts/enrich-hp.js          # only fetch cards with hp = null
 *   node scripts/enrich-hp.js --force  # re-fetch all cards (overwrite existing)
 *
 * The script saves progress every 50 cards so it is safe to interrupt
 * (Ctrl-C) and re-run — already-enriched cards are skipped.
 *
 * Estimated time: ~20 min for 2875 cards at 350 ms/request.
 * Cards with no tcgdex entry (e.g. some promos, unknown sets) are skipped
 * gracefully and left with hp = null.
 */

const fs   = require('fs');
const path = require('path');

const DB_PATH  = path.join(__dirname, '../data/ptcgp_cards.json');
const DELAY_MS = 350;
const SAVE_EVERY = 50;
const FORCE = process.argv.includes('--force');

// ── Helpers ───────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchCard(uid) {
  const url = `https://api.tcgdex.net/v2/en/cards/${uid}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || typeof data !== 'object' || Object.keys(data).length === 0) return null;
    return data;
  } catch {
    return null;
  }
}

function extractStats(data) {
  const hp = (typeof data.hp === 'number') ? data.hp
           : (typeof data.hp === 'string' && data.hp !== '') ? parseInt(data.hp, 10) || null
           : null;

  // weakness: first entry, e.g. { type: "Fire", value: "+20" }
  const weaknessRaw = Array.isArray(data.weaknesses) ? data.weaknesses[0] : null;
  const weakness = weaknessRaw
    ? { type: weaknessRaw.type ?? null, value: weaknessRaw.value ?? null }
    : null;

  return { hp, weakness };
}

// ── Main ──────────────────────────────────────────────────────────────────────

const raw = fs.readFileSync(DB_PATH, 'utf8');
const db  = JSON.parse(raw);
const cards = db.cards;

const toFetch = FORCE
  ? cards
  : cards.filter(c => c.hp === null);

console.log(`📦 Total cards in DB: ${cards.length}`);
console.log(`🔍 Cards to fetch: ${toFetch.length}${FORCE ? ' (force mode)' : ' (hp = null only)'}`);
console.log(`⏱  Estimated time: ~${Math.ceil(toFetch.length * DELAY_MS / 60000)} min\n`);

if (toFetch.length === 0) {
  console.log('✅ Nothing to do — all cards already have HP data.');
  console.log('   Run with --force to re-fetch everything.');
  process.exit(0);
}

let fetched = 0, enriched = 0, skipped = 0, saveCount = 0;

// Build a uid → card map for fast lookup
const byUid = new Map(cards.map(c => [c.uid, c]));

function saveDb() {
  db.generated = new Date().toISOString();
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
  saveCount++;
}

(async () => {
  for (const card of toFetch) {
    fetched++;
    process.stdout.write(`[${fetched}/${toFetch.length}] ${card.uid.padEnd(8)} `);

    // Try primary uid first, then originalUid fallback (for reprint sets like A4b)
    let data = await fetchCard(card.uid);

    if (!data && card.originalUid) {
      process.stdout.write(`(fallback: ${card.originalUid}) `);
      data = await fetchCard(card.originalUid);

      // If originalUid also has no data, try looking up the card it was reprinted from
      // by finding it in the DB (already enriched)
      if (!data) {
        const orig = byUid.get(card.originalUid);
        if (orig && orig.hp !== null) {
          // Copy stats directly from the already-enriched original
          card.hp      = orig.hp;
          card.weakness = orig.weakness ?? null;
          enriched++;
          process.stdout.write(`→ copied from ${card.originalUid} hp=${card.hp}\n`);
          if (fetched % SAVE_EVERY === 0) saveDb();
          await sleep(50); // minimal delay for copied entries
          continue;
        }
      }
    }

    if (!data) {
      skipped++;
      process.stdout.write('— no data\n');
    } else {
      const { hp, weakness } = extractStats(data);
      card.hp      = hp;
      card.weakness = weakness;
      enriched++;
      process.stdout.write(`→ HP ${hp ?? '—'}${weakness ? `  weak: ${weakness.type} ${weakness.value}` : ''}\n`);
    }

    if (fetched % SAVE_EVERY === 0) {
      saveDb();
      console.log(`   💾 Saved (${fetched}/${toFetch.length})\n`);
    }

    await sleep(DELAY_MS);
  }

  // Final save
  saveDb();

  console.log('\n' + '='.repeat(60));
  console.log(`✅ Done!`);
  console.log(`   Enriched : ${enriched} cards`);
  console.log(`   Skipped  : ${skipped} cards (no tcgdex data)`);
  console.log(`   Saves    : ${saveCount}`);
  console.log(`   Output   : ${DB_PATH}`);
})();
