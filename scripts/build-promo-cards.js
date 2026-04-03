'use strict';

/**
 * scripts/build-promo-cards.js
 *
 * Builds/rebuilds PROMO-A and PROMO-B card entries in data/ptcgp_cards.json.
 *
 * Data sources:
 *  - Images: C:/Users/sagen/Desktop/PTCGP/PROMO-A and PROMO-B local files
 *  - Card ordering: pokemon_zone_promos.json (internal ID → promo number)
 *  - Names / HP / type / weakness: tcgdex API (en only, P-A 001-100)
 *  - zh / ja names: matched from existing DB cards by English name
 *
 * Run: node scripts/build-promo-cards.js
 */

const fs   = require('fs');
const path = require('path');

const DB_PATH     = path.join(__dirname, '../data/ptcgp_cards.json');
const PROMO_ROOT  = 'C:/Users/sagen/Desktop/PTCGP';
const DELAY_MS    = 300;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchJSON(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

// ── Build en→{zh,ja} lookup from existing DB ──────────────────────────────────

function buildNameLookup(cards) {
  const byEn = new Map(); // en (lowercase) → {zh, ja}
  for (const card of cards) {
    const en = card.names?.en;
    if (!en) continue;
    const key = en.toLowerCase();
    if (!byEn.has(key)) {
      byEn.set(key, { zh: card.names.zh || '', ja: card.names.ja || '' });
    } else {
      const e = byEn.get(key);
      if (!e.zh && card.names.zh) e.zh = card.names.zh;
      if (!e.ja && card.names.ja) e.ja = card.names.ja;
    }
  }
  return byEn;
}

// ── Fetch tcgdex data for a single card ───────────────────────────────────────

async function fetchTcgdexCard(uid) {
  const data = await fetchJSON(`https://api.tcgdex.net/v2/en/cards/${uid}`);
  if (!data) return null;

  const hp = data.hp ?? null;
  const type = data.types?.[0] ?? null;
  const weakEntry = data.weaknesses?.[0];
  const weakness = weakEntry ? { type: weakEntry.type, value: weakEntry.value } : null;
  const category = data.category === 'Pokemon' ? 'Pokémon' : (data.category ?? null);
  const rarity = data.rarity === 'None' ? null : (data.rarity ?? null);

  return {
    en: data.name ?? '',
    hp,
    type,
    weakness,
    category,
    rarity,
  };
}

// ── Build card entries for one promo set ─────────────────────────────────────

async function buildPromoSet(setId, promoDir, nameByEn) {
  const promoJsonPath = path.join(promoDir, 'pokemon_zone_promos.json');
  if (!fs.existsSync(promoJsonPath)) {
    console.warn(`  ⚠  ${promoJsonPath} not found — skipping ${setId}`);
    return [];
  }

  const promoMap = JSON.parse(fs.readFileSync(promoJsonPath, 'utf8'));
  // promoMap: { "PK_90_000940_02": "PROMO-A-009", ... }
  // Invert to get num → globalFileId
  const numToGid = {};
  for (const [gid, numStr] of Object.entries(promoMap)) {
    // numStr like "PROMO-A-009" → extract last -NNN
    const m = numStr.match(/-(\d+)$/);
    if (m) numToGid[parseInt(m[1], 10)] = gid;
  }

  // Determine card count from image files
  const imgFiles = fs.readdirSync(path.join(promoDir, 'en_US'))
    .filter(f => f.endsWith('.png'))
    .sort();
  const maxNum = imgFiles.length;

  console.log(`\n📦 Building ${setId}: ${maxNum} cards`);

  const LANGS = ['zh_TW', 'ja_JP', 'en_US'];
  const cards  = [];

  for (let num = 1; num <= maxNum; num++) {
    const pad  = String(num).padStart(3, '0');
    const uid  = `${setId}-${pad}`;

    // Images
    const images = {};
    for (const lang of LANGS) {
      const p = path.join(promoDir, lang, `${uid.replace('P-A', 'PROMO-A').replace('P-B', 'PROMO-B')}.png`);
      if (fs.existsSync(p)) images[lang] = p.replace(/\\/g, '/');
    }

    // Fetch tcgdex data (rate-limited)
    process.stdout.write(`  ${uid} `);
    const tcg = await fetchTcgdexCard(uid);
    await sleep(DELAY_MS);

    let names = { zh: '', ja: '', en: '' };
    let hp = null, type = null, weakness = null, category = null, rarity = null;

    if (tcg) {
      names.en = tcg.en;
      hp       = tcg.hp;
      type     = tcg.type;
      weakness = tcg.weakness;
      category = tcg.category;
      rarity   = tcg.rarity;

      // Look up zh/ja from existing cards
      const match = nameByEn.get(tcg.en.toLowerCase());
      if (match) {
        names.zh = match.zh;
        names.ja = match.ja;
        process.stdout.write(`✓ (${tcg.en})\n`);
      } else {
        process.stdout.write(`✓ en only (${tcg.en})\n`);
      }
    } else {
      process.stdout.write(`- no tcgdex data\n`);
    }

    // Determine category from global ID if not set
    if (!category) {
      const gid = numToGid[num] ?? '';
      if (gid.startsWith('TR_')) category = 'Trainer';
      else if (gid.startsWith('PK_')) category = 'Pokémon';
    }

    cards.push({
      uid,
      set: setId,
      setName: setId === 'P-A' ? 'Promo-A' : 'Promo-B',
      num,
      rarity,
      type,
      category,
      hp,
      weakness,
      names,
      images,
    });
  }

  return cards;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  const db  = JSON.parse(raw);

  // Remove all existing P-A and P-B entries
  const before = db.cards.length;
  db.cards = db.cards.filter(c => c.set !== 'P-A' && c.set !== 'P-B');
  console.log(`Removed ${before - db.cards.length} existing P-A/P-B entries`);

  // Build name lookup from remaining cards
  const nameByEn = buildNameLookup(db.cards);
  console.log(`Name lookup: ${nameByEn.size} entries`);

  // Build promo sets
  const promoA = await buildPromoSet('P-A', path.join(PROMO_ROOT, 'PROMO-A'), nameByEn);
  const promoB = await buildPromoSet('P-B', path.join(PROMO_ROOT, 'PROMO-B'), nameByEn);

  // Append at the end
  db.cards.push(...promoA, ...promoB);
  db.generated = new Date().toISOString();

  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');

  console.log(`\n✅ Done. DB now has ${db.cards.length} cards.`);
  console.log(`   P-A: ${promoA.length} cards`);
  console.log(`   P-B: ${promoB.length} cards`);

  // Report missing names
  const missingA = promoA.filter(c => !c.names.zh && !c.names.en);
  const missingB = promoB.filter(c => !c.names.zh && !c.names.en);
  if (missingA.length + missingB.length > 0) {
    console.log(`\n⚠  Cards with no names: P-A=${missingA.length}, P-B=${missingB.length}`);
    for (const c of [...missingA, ...missingB].slice(0, 10)) {
      console.log(`  ${c.uid}`);
    }
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
