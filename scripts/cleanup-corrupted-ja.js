'use strict';

/**
 * Fix data corruption introduced by enrich-by-globalid.js.
 *
 * The bug: old-format sets (no c-prefix) use separate global ID namespaces
 * for PK_10_ and PK_20_ — they can share the same 6-digit number while
 * representing completely different Pokémon/characters. The enrichment
 * script treated them as the same family (PK), causing ja names to be
 * copied from PK_20_ trainer characters onto PK_10_ Pokémon.
 *
 * Detect: for each old-format PK_10_ card, if a PK_20_ card exists (anywhere)
 * with the same global ID but a DIFFERENT en/zh name, and they share the
 * same ja name → the PK_10_'s ja was wrongly copied. Clear it.
 *
 * Run: node scripts/cleanup-corrupted-ja.js
 */

const fs   = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/ptcgp_cards.json');

function parseFile(imgPath) {
  const f = path.basename(imgPath ?? '');
  const m = f.match(/^(c?)(PK|TR)_(\d+)_(\d{6})/);
  if (!m) return null;
  return {
    isNew:  m[1] === 'c',
    type:   m[2],         // PK or TR
    series: m[3],         // 10 or 20
    globalId: m[4],
  };
}

async function main() {
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  const db  = JSON.parse(raw);

  // Build: (type, globalId) → list of cards WITH names (from all cards)
  // but keep PK_10_ and PK_20_ SEPARATE so we can detect mismatches
  const pkByGid = new Map(); // globalId → { s10: card[], s20: card[] }
  const trByGid = new Map();

  for (const card of db.cards) {
    const p = parseFile(card.images?.zh_TW);
    if (!p || p.isNew) continue; // old-format only
    const map = p.type === 'PK' ? pkByGid : trByGid;
    if (!map.has(p.globalId)) map.set(p.globalId, { s10: [], s20: [] });
    const key = p.series === '10' ? 's10' : 's20';
    map.get(p.globalId)[key].push(card);
  }

  let cleared = 0;

  // For each global ID where BOTH _10 and _20 exist with DIFFERENT en/zh:
  // if they share the same ja, clear ja from the _10 card (it was wrongly copied)
  for (const [, byGid] of [['PK', pkByGid], ['TR', trByGid]]) {
    for (const [gid, { s10, s20 }] of byGid) {
      if (!s10.length || !s20.length) continue;

      // Find all _10 / _20 pairs with mismatched en names but shared ja
      for (const c10 of s10) {
        for (const c20 of s20) {
          // Skip if they have the same en (same Pokémon, different art)
          if (c10.names.en && c20.names.en && c10.names.en === c20.names.en) continue;
          // If ja matches despite en mismatch → likely corruption
          if (c10.names.ja && c10.names.ja === c20.names.ja) {
            console.log(`Clear: ${c10.set} #${c10.num} "${c10.names.en}" ja="${c10.names.ja}" (from ${c20.set} #${c20.num} "${c20.names.en}")`);
            c10.names.ja = '';
            cleared++;
          }
        }
      }
    }
  }

  console.log(`\nCleared ${cleared} corrupted ja names.`);

  db.generated = new Date().toISOString();
  fs.writeFileSync(DB_PATH, JSON.stringify(db));
  console.log('✅  Saved.');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
