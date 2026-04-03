'use strict';

/**
 * Fix B2b card ordering: Mega Charizard X ex (016150) has a higher global ID
 * than Ponyta/Rapidash/Magmar/Magmortar/Paldean Tauros (016100-016140), but
 * is officially card #9 while those are #10-14.
 *
 * This patch swaps their order so:
 *   new #9  = 016150 (Mega Charizard X ex)
 *   new #10 = 016100 (Ponyta)
 *   new #11 = 016110 (Rapidash)
 *   new #12 = 016120 (Magmar)
 *   new #13 = 016130 (Magmortar)
 *   new #14 = 016140 (Paldean Tauros)
 *
 * Names and rarities come from the wiki enrichment (matched by card number),
 * so after re-ordering we clear names/rarities for the affected cards and
 * re-run the wiki enrichment to assign the correct names to the correct images.
 *
 * Run: node scripts/patch-b2b-order.js
 * Then re-run: node scripts/enrich-ptcgp-zh-trainer.js
 *              node scripts/enrich-ptcgp-db.js
 *              node scripts/enrich-sameset-specialart.js
 */

const fs   = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/ptcgp_cards.json');

// The 5 files that need to move from positions 9-13 → 10-14,
// and 016150 needs to move from position 14 → 9.
const DISPLACED = new Set([
  'PK_10_016100_00.png',
  'PK_10_016110_00.png',
  'PK_10_016120_00.png',
  'PK_10_016130_00.png',
  'PK_10_016140_00.png',
]);
const MEGA_CHARIZARD_FILE = 'PK_10_016150_00.png';

function basename(p) { return path.basename(p ?? ''); }

async function main() {
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  const db  = JSON.parse(raw);

  const b2b = db.cards.filter(c => c.set === 'B2b');
  console.log(`B2b: ${b2b.length} cards`);

  // Find the affected PK_10_ cards
  const displaced = b2b.filter(c => DISPLACED.has(basename(c.images?.zh_TW)));
  const megaChari  = b2b.find(c => basename(c.images?.zh_TW) === MEGA_CHARIZARD_FILE);

  if (!megaChari) {
    console.error('ERROR: Mega Charizard X ex file not found in B2b DB');
    process.exit(1);
  }
  if (displaced.length !== 5) {
    console.error(`ERROR: Expected 5 displaced cards, found ${displaced.length}`);
    displaced.forEach(c => console.log('  found:', basename(c.images?.zh_TW), 'at #'+c.num));
    process.exit(1);
  }

  displaced.sort((a, b) => a.num - b.num);
  console.log('\nBefore:');
  console.log(`  #${megaChari.num} = ${basename(megaChari.images?.zh_TW)} = "${megaChari.names.en}"`);
  displaced.forEach(c => console.log(`  #${c.num} = ${basename(c.images?.zh_TW)} = "${c.names.en}"`));

  // The positions to swap:
  //   megaChari currently at num N (should be displaced[0].num)
  //   displaced[0] currently at num displaced[0].num (should be N)
  //   etc.
  const megaOldNum    = megaChari.num;           // currently 14
  const displacedNums = displaced.map(c => c.num); // currently 9,10,11,12,13

  const newMegaNum     = displacedNums[0];   // 9
  const newDisplacedNums = [...displacedNums.slice(1), megaOldNum]; // 10,11,12,13,14

  // Reassign card numbers
  megaChari.num  = newMegaNum;
  megaChari.uid  = `B2b-${newMegaNum}`;
  for (let i = 0; i < displaced.length; i++) {
    displaced[i].num = newDisplacedNums[i];
    displaced[i].uid = `B2b-${newDisplacedNums[i]}`;
  }

  // Clear stale names/rarities from the affected cards so enrichment reassigns correctly
  const affected = [megaChari, ...displaced];
  for (const card of affected) {
    card.names = { zh: '', ja: '', en: '' };
    card.rarity = '?';
  }

  // Re-sort b2b in the cards array by num
  b2b.sort((a, b) => a.num - b.num);
  // Replace b2b slice in the full cards array
  let b2bIdx = 0;
  for (let i = 0; i < db.cards.length; i++) {
    if (db.cards[i].set === 'B2b') {
      db.cards[i] = b2b[b2bIdx++];
    }
  }

  console.log('\nAfter:');
  console.log(`  #${megaChari.num} = ${basename(megaChari.images?.zh_TW)}`);
  displaced.forEach(c => console.log(`  #${c.num} = ${basename(c.images?.zh_TW)}`));

  db.generated = new Date().toISOString();
  fs.writeFileSync(DB_PATH, JSON.stringify(db));
  console.log('\n✅  Saved. Now run:');
  console.log('  node scripts/enrich-ptcgp-zh-trainer.js');
  console.log('  node scripts/enrich-ptcgp-db.js');
  console.log('  node scripts/enrich-sameset-specialart.js');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
