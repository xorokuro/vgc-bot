# Master Fix Guide — PTCGP Card Ordering & Names

> **Single source of truth. Drop this file at the start of any new session.**
> Last updated: 2026-03-29

---

## TL;DR — What's Wrong and Why

Old-format sets store card images as `PK_10_XXXXXX_00.png` where `XXXXXX` is a
**global production ID (gid)**. The build script sorted these files by gid ascending
and matched them positionally to the official card list. If gids are not in official
card-number order, **every card from the first mismatch onwards gets the wrong name
and wrong image**.

New-format sets (A2, A2a, A2b and later) embed the Pokémon name code in the filename
(e.g. `cPK_10_005370_UMIDIGDA_C_M_zh_TW.png`) — these can **never** be scrambled.

**IL rare / full-art cards (PK_20_)** are affected by the same gid-sort problem
regardless of set. The fix process is the same: OCR images → build FILE_TO_CARD table.

---

## Set Status (as of 2026-03-29)

| Set | Name | PK_10_ | PK_20_ | Trainer zh | Notes |
|-----|------|--------|--------|------------|-------|
| **A2** | Space-Time Smackdown | ✅ Safe | ✅ Safe | — | New-format filename |
| **A2a** | Mythical Island | ✅ Safe | ✅ Safe | — | New-format filename |
| **A2b** | Triumphant Light | ✅ Safe | ✅ Safe | — | New-format filename |
| **B2b** | Mega Shine | ✅ Fixed | ✅ Fixed | ⚠️ B2b-65 zh fixed (惡棍信); B2b-66/69 still need image verification | See below |
| **A1** | Genetic Apex | ✅ Safe | ✅ Fixed | ✅ Fixed | PK_10_ gids are in order; PK_20_ all 60 IL rares fixed 2026-03-29 |
| **A4a** | Secluded Springs | ✅ Fixed | ❓ Unchecked | ❓ | PK_10_ done, PK_20_ not |
| **A3** | Triumphant Light | ⚠️ Partial | ❓ Unchecked | ❓ | Missing names fixed, order unverified |
| **B2a** | Shining Revelry | ⚠️ Partial | ❓ Unchecked | ❓ | Missing names fixed, order unverified |
| **A1a** | Promo-A | ❓ Unknown | ❓ Unknown | ❓ | |
| **A3a** | Extradimensional Crisis | ❓ Unknown | ❓ Unknown | ❓ | |
| **A3b** | Eevee Grove | ❓ Unknown | ❓ Unknown | ❓ | |
| **A4** | Celestial Guardians | ❓ Unknown | ❓ Unknown | ❓ | |
| **A4b** | Ancient Bond | ❓ Unknown | ❓ Unknown | ❓ | |
| **B1** | Space-Time Smackdown | ❓ Unknown | ❓ Unknown | ❓ | High priority — large set |
| **B1a** | Mythical Island | ❓ Unknown | ❓ Unknown | ❓ | |
| **B2** | Prismatic Evolution | ❓ Unknown | ❓ Unknown | ❓ | |

### B2b trainer cards still needing manual fix
- `B2b-65` zh fixed → **惡棍信** (read from zh_TW image 2026-03-29)
- `B2b-66` zh = **維修** — visually confirmed from image, likely correct; verify if in doubt
- `B2b-69` zh = **徒行步道** — needs zh_TW image read to confirm

---

## TCGdex API — Use This First

**URL format:** `https://api.tcgdex.net/v2/en/sets/A1` (set ID must be **UPPERCASE**)

Available sets (as of 2026-03-29):
`A1, A1a, A2, A2a, A2b, A3, A3a, A3b, A4, A4a, B1, B1a, B2`

**NOT available on TCGdex:** `B2a, B2b` — use Serebii or Game8 for those.

The API returns cards in official order: position 0 = card #1.

```js
// Get POS_TO_EN for any set (replace A1 with target set ID):
const res = await fetch('https://api.tcgdex.net/v2/en/sets/A1');
const data = await res.json();
const POS_TO_EN = {};
data.cards.forEach((c, i) => { POS_TO_EN[i + 1] = c.name; });
```

The image URLs in TCGdex do **not** contain gids — use it only for `POS_TO_EN`.

---

## Step-by-Step Fix Process

### Step 0 — Health Check (PK_10_ gid order)

```bash
node -e "
const db=JSON.parse(require('fs').readFileSync('data/ptcgp_cards.json'));
const SET='A1'; // change this
const cards=db.cards.filter(c=>c.set===SET&&c.images?.zh_TW?.includes('PK_10_'));
const gids=cards.map(c=>({num:c.num,gid:c.images.zh_TW.match(/PK_10_(\d{6})/)[1],en:c.names.en}));
gids.slice(0,10).forEach(g=>console.log('num='+g.num+' gid='+g.gid+' en='+g.en));
let bad=0;
for(let i=1;i<gids.length;i++) if(gids[i].gid<gids[i-1].gid){bad++;console.log('OUT OF ORDER at num='+gids[i].num+' gid='+gids[i].gid);}
console.log(bad===0?'✅ GIDs in order':'❌ '+bad+' out-of-order gids');
"
```

- **✅ GIDs in order** → PK_10_ is probably clean (still spot-check a few images to be sure)
- **❌ out-of-order** → scrambled, needs the full OCR fix below

### Step 0b — Health Check (PK_20_ spot check)

Always check PK_20_ separately — PK_10_ being clean does NOT mean PK_20_ is clean.

```bash
node -e "
const db=JSON.parse(require('fs').readFileSync('data/ptcgp_cards.json'));
const SET='A1';
const cards=db.cards.filter(c=>c.set===SET&&c.images?.zh_TW?.includes('PK_20_'));
console.log('PK_20_ count:',cards.length);
// Show first/last 5
cards.slice(0,5).concat(cards.slice(-5)).forEach(c=>{
  const f=(c.images.zh_TW||'').split('PK_20_')[1];
  console.log('num='+c.num+' en='+c.names.en+' file='+f);
});
"
```

Then visually check 5–10 en_US images against the DB names. If names don't match → broken.

### Step 1 — Find the Asset Folder

```bash
node -e "
const db=JSON.parse(require('fs').readFileSync('data/ptcgp_cards.json'));
const c=db.cards.find(c=>c.set==='A1'&&c.images?.zh_TW?.includes('PK_20_'));
console.log(c.images.zh_TW);
"
```

Card images are at: `C:\Users\sagen\Desktop\PTCGP\[FOLDER]\en_US\PK_20_XXXXXX_00.png`

### Step 2 — OCR Every PK_20_ Card

List all files:
```bash
ls 'C:\Users\sagen\Desktop\PTCGP\[FOLDER]\en_US\' | grep PK_20_ | sort
```

Also check for TR_20_ files (trainer full arts):
```bash
ls 'C:\Users\sagen\Desktop\PTCGP\[FOLDER]\en_US\' | grep TR_20_ | sort
```

Read each `en_US/PK_20_XXXXXX_00.png` image in **batches of 8 in parallel** to identify the Pokémon name shown. Build a complete `filename → actual name` table.

**Key insight for multi-variant gids:** files with the same gid but different variant numbers
(`_00`, `_01`, `_02`) show the **same Pokémon** in different art styles. They map to
separate consecutive card numbers. Use the variant number as part of the key:
- `PK_20_000360_00.png` → Charizard ex (art 1) → pos 253
- `PK_20_000360_01.png` → Charizard ex (art 2) → pos 280
- `PK_20_000360_02.png` → Charizard ex (art 3) → pos 284

### Step 3 — Get Official Card Order via TCGdex

```bash
node -e "
fetch('https://api.tcgdex.net/v2/en/sets/A1')
  .then(r=>r.json())
  .then(d=>{
    d.cards.forEach((c,i)=>console.log((i+1)+': '+c.name));
  });
"
```

### Step 4 — Write `scripts/patch-[setid]-pk20.js`

Model after `scripts/patch-a1-pk20.js`. Key difference from PK_10_ patches:

**Use a `FILE_TO_CARD` table keyed by bare filename** (not gid alone), because:
1. Multi-variant gids need variant number as part of key
2. TR_20_ trainer files need different handling from PK_20_ Pokemon files

```js
const FILE_TO_CARD = {
  'PK_20_000010_00.png': { pos: 227, en: 'Bulbasaur' },
  // ... all PK_20_ entries
  'TR_20_000110_00.png': { pos: 266, en: 'Erika', zh: '莉佳', ja: 'エリカ' },
  // ... all TR_20_ trainer entries (hardcode zh/ja from regular trainer cards)
};
```

The lookup key is `path.basename(card.images.zh_TW)`.

### Step 5 — Trainer Full Arts (TR_20_) — CRITICAL

**Trainer full arts use TR_20_ files, NOT PK_20_ files.**

In A1: pos 266–273 are trainer full arts (Erika, Misty, Blaine, Koga, Giovanni, Brock,
Sabrina, Lt. Surge). Their images are `TR_20_000110_00.png` through `TR_20_000180_00.png`.

The DB can get this wrong — assigning PK_20_ Pokemon card files to trainer name entries.
Check by looking for TR_20_ files in the folder and comparing to what the DB says:

```bash
node -e "
const db=JSON.parse(require('fs').readFileSync('data/ptcgp_cards.json'));
db.cards.filter(c=>c.set==='A1'&&c.num>=219&&c.num<=230).forEach(c=>{
  const f=(c.images&&c.images.zh_TW||'').split('\\\\').pop();
  console.log('num='+c.num+' en='+c.names.en+' file='+f);
});
"
```

Trainer zh/ja for the full-art versions is the same as the regular versions (TR_10_ cards
at lower positions). Hard-code them in the patch script — trilingual.json won't have them.

### Step 6 — Alt-art ex Cards (pos 274+)

These are the **second and third art variants** of ex Pokémon. They use the **same gid**
as the first art but with variant `_01`, `_02`. Check the TCGdex list for the total count
of each ex card (some appear 2×, some 3×) to know how many variants to expect.

The DB might currently place them at wrong positions (e.g., assigning the second Charizard
art to "Gyarados"). The FILE_TO_CARD table handles this automatically since the variant
number is part of the key.

### Step 7 — Trainer zh Fix (TR_10_ and TR_20_)

**CRITICAL: Never translate or guess trainer card zh names.**
**Always read the actual zh_TW image file and copy the text directly.**

Find trainer cards with empty zh:
```bash
node -e "
const db=JSON.parse(require('fs').readFileSync('data/ptcgp_cards.json'));
const SET='A1';
const tr=db.cards.filter(c=>c.set===SET&&c.images?.zh_TW?.includes('TR_')&&!c.names.zh);
tr.forEach(c=>console.log(c.uid, c.names.en, c.images.zh_TW));
"
```

Read each `zh_TW/TR_10_XXXXXX_00.png` image and copy the zh card title exactly as shown.

### Step 8 — Run the Full Pipeline

Always run **all scripts in order** after any patch:

```bash
node scripts/patch-[setid]-pk20.js
node scripts/enrich-ptcgp-db.js
node scripts/enrich-ptcgp-zh-trainer.js
node scripts/enrich-sameset-specialart.js
node scripts/manual-name-overrides.js
```

Then **restart the Discord bot** (it caches the DB on startup).

`manual-name-overrides.js` must run **last** — it contains hardcoded corrections
that would be erased by the enrich scripts if run before them.

---

## Fixing Wrong or Missing zh/ja Names

### Why names go wrong

| Source | Covers | Risk |
|--------|--------|------|
| `trilingual.json` | Pokémon species names | Always overwrites — correct for species |
| 52poke wiki scrape | Trainer/item cards | Misses cards not on the wiki |
| Machine translation | (nowhere in the pipeline — do NOT use) | — |

When both sources miss a card, zh/ja is left **empty**. The fix is always to
**OCR the source image** — never guess or translate.

---

### Step 1 — Find cards with missing zh/ja

Run this after every pipeline to see what still needs fixing:

```bash
node -e "
const db=JSON.parse(require('fs').readFileSync('data/ptcgp_cards.json'));
const SET='B2b'; // or omit filter to check all sets
const missing=db.cards.filter(c=>(!SET||c.set===SET)&&(!c.names.zh||!c.names.ja));
missing.forEach(c=>{
  console.log(c.uid, JSON.stringify(c.names), c.images&&c.images.zh_TW||'no-img');
});
console.log('Total missing zh/ja:',missing.length);
"
```

---

### Step 2 — OCR the source images (Claude reads them)

**For each card with missing/wrong zh or ja:**

1. Look at the zh_TW path from the output above
2. Ask Claude to read that image file — Claude will OCR the card title text
3. Copy the text exactly as shown — do NOT translate, do NOT guess

Read in batches of 8 for speed:
```
Please read these images and tell me the card title text shown on each one:
C:\Users\sagen\Desktop\PTCGP\B2b - Mega Shine\zh_TW\TR_10_001230_00.png
C:\Users\sagen\Desktop\PTCGP\B2b - Mega Shine\zh_TW\TR_10_001240_00.png
... (up to 8 at a time)
```

For ja names, read the ja_JP folder equivalents:
```
C:\Users\sagen\Desktop\PTCGP\B2b - Mega Shine\ja_JP\TR_10_001230_00.png
```

---

### Step 3 — Apply fixes via manual-name-overrides.js

**DO NOT edit ptcgp_cards.json directly** — it is one long line, impossible to read.
Instead, add fixes to `scripts/manual-name-overrides.js` so they survive future
pipeline runs. This script runs **last** in the pipeline, after all enrich scripts.

**How to look up a card (to check current state):**
```bash
node -p "JSON.stringify(require('./data/ptcgp_cards.json').cards.find(c=>c.uid==='B2b-65'),null,2)"
```

**Adding a fix to manual-name-overrides.js:**
Open `scripts/manual-name-overrides.js` and add an entry to the OVERRIDES array:
```js
{ uid: 'B2b-65', zh: '惡棍信' },             // read from zh_TW image
{ uid: 'B2b-66', zh: '維修' },               // confirmed from zh_TW image
{ uid: 'B2b-69', zh: '徒行步道' },            // read from zh_TW image
```

Then run the script to apply:
```bash
node scripts/manual-name-overrides.js
```

---

### When do manual edits get overwritten?

**Bot restart does NOT run any scripts.** It only reads `ptcgp_cards.json` as-is.
Your edits survive restarts indefinitely.

| Action | Overwrites your edits? |
|--------|----------------------|
| Restart bot (`npm start`) | ❌ Never |
| `node scripts/enrich-ptcgp-db.js` | ✅ Yes — Pokémon zh/ja only |
| `node scripts/enrich-ptcgp-zh-trainer.js` | ❌ No — only fills empty fields |
| `node scripts/manual-name-overrides.js` | ❌ No — only adds, never removes |

**Practical rule:**
- **Pokémon cards (PK_)** — don't bother editing zh/ja manually. `trilingual.json`
  controls these and is correct. If you do edit them, the next pipeline run will
  reset them.
- **Trainer / item cards (TR_)** — safe to edit directly. `enrich-ptcgp-db.js`
  never touches these. For permanent fixes, also add to `manual-name-overrides.js`.

### Why fixes must go in manual-name-overrides.js

`enrich-ptcgp-db.js` **always overwrites** zh/ja for any Pokémon found in
`trilingual.json`. If you patch `ptcgp_cards.json` directly and then re-run the
pipeline, your fix will be erased.

The pipeline order is:
```
1. patch-[setid]-pk20.js     ← fixes image/position assignments
2. enrich-ptcgp-db.js        ← overwrites zh/ja from trilingual.json (Pokémon only)
3. enrich-ptcgp-zh-trainer.js ← fills missing zh/ja from 52poke wiki
4. enrich-sameset-specialart.js
5. manual-name-overrides.js  ← YOUR HARDCODED FIXES, always last
```

Only trainer/item names (not in trilingual.json) need overrides. Pokémon zh/ja
come from trilingual.json and are always correct.

---

### Problem: ptcgp_cards.json is one huge line

The JSON is stored compacted. Options for reading it:

**Option A — VSCode (temporary browse only):**
Open the file → press `Shift+Alt+F` → VSCode pretty-prints for reading.
Do NOT save — pipeline will compact it back.

**Option B — Lookup one card by uid:**
```bash
node -p "JSON.stringify(require('./data/ptcgp_cards.json').cards.find(c=>c.uid==='B2b-65'),null,2)"
```

**Option C — List all trainer cards in a set:**
```bash
node -e "
const db=JSON.parse(require('fs').readFileSync('data/ptcgp_cards.json'));
db.cards.filter(c=>c.set==='B2b'&&c.images?.zh_TW?.includes('TR_')).forEach(c=>{
  console.log(c.uid, c.names.en, '→ zh:', c.names.zh||'MISSING', '| ja:', c.names.ja||'MISSING');
});
"
```

---

## A1 Fix Notes (2026-03-29)

**Script:** `scripts/patch-a1-pk20.js`
**What was wrong:** All 60 IL rare / full-art cards (pos 227–286) had wrong names.
- PK_20_ Pokemon cards: gid sort order ≠ official card order
- Trainer full arts (pos 266–273): DB pointed to PK_20_ Pokemon files instead of TR_20_ trainer files
- Alt-art ex (pos 279–286): DB had TR_20_ trainer files assigned to Pokemon names

**Method used:** FILE_TO_CARD lookup table keyed by bare filename (e.g. `PK_20_000010_00.png`).
This handles multi-variant gids automatically since the variant number is part of the key.

**GID → position mapping:** built by OCR-reading all 52 en_US PK_20_ images.
Uncertain identifications resolved by elimination (52 files, 52 non-trainer positions = each
file maps to exactly one position if certain identifications are correct).

**Key facts confirmed for A1:**
- TR_20_000110–000180 = trainer full arts (Erika through Lt. Surge) for pos 266–273
- gid 000360 (3 variants) = Charizard ex at pos 253, 280, 284
- gid 000960 (3 variants) = Pikachu ex at pos 259, 281, 285
- gid 001290 (3 variants) = Mewtwo ex at pos 262, 282, 286
- All other multi-variant gids = 2 variants each

---

## Reference Scripts

| Script | Purpose |
|--------|---------|
| `scripts/patch-b2b-pk10.js` | Most complete PK_10_ fix example — model all new PK_10_ patches after this |
| `scripts/patch-b2b-pk20.js` | PK_20_ fix example for B2b |
| `scripts/patch-a1-pk20.js` | **Best PK_20_ fix example** — handles TR_20_ trainers + alt-art ex correctly |
| `scripts/enrich-ptcgp-db.js` | Pipeline step — always run after patches |
| `scripts/enrich-ptcgp-zh-trainer.js` | Pipeline step — always run after patches |
| `scripts/enrich-sameset-specialart.js` | Pipeline step — always run after patches |
| `scripts/manual-name-overrides.js` | **Always run last** — hardcoded zh/ja fixes for trainer/item cards not found by other scripts. Add entries here when OCR reveals wrong names. |

---

## Copy-Paste Prompt Template

```
I need to fix wrong card images in the set other than A2 A2a A2b B2b (only these four is correct) set of my PTCGP Discord bot.

The problem: old-format filenames (PK_10_XXXXXX_00.png) have no name codes,
so cards were assigned names by gid sort order which may not match official card order.
PK_20_ IL rares have the same problem. Trainer full arts use TR_20_ files, not PK_20_.

Asset files: C:\Users\sagen\Desktop\PTCGP\[FOLDER NAME]\en_US\
Database: data/ptcgp_cards.json
Reference scripts: scripts/patch-a1-pk20.js (best PK_20_ example)
                   scripts/patch-b2b-pk10.js (PK_10_ example)
Full guide: docs/master-fix-guide.md

Please:
1. Run the PK_10_ gid-order health check for [SETID]
2. Run the PK_20_ spot check for [SETID]
3. If broken: OCR each PK_20_ en_US image in batches of 8 to build filename→card name table
   Also list and check TR_20_ files (trainer full arts)
4. Get official card list: https://api.tcgdex.net/v2/en/sets/[SETID]
   (If 404: use Serebii https://www.serebii.net/tcgpocket/[setname]/ or Game8)
5. Write scripts/patch-[setid]-pk20.js using FILE_TO_CARD pattern from patch-a1-pk20.js
6. Check PK_10_ if also broken; write scripts/patch-[setid]-pk10.js
7. Find trainer cards with empty zh — read zh_TW images to get the actual text (DO NOT translate)
8. Run full pipeline:
   node scripts/patch-[setid]-pk20.js
   node scripts/enrich-ptcgp-db.js
   node scripts/enrich-ptcgp-zh-trainer.js
   node scripts/enrich-sameset-specialart.js
   node scripts/manual-name-overrides.js
9. Check for missing zh/ja: node -e "const db=JSON.parse(require('fs').readFileSync('data/ptcgp_cards.json')); const m=db.cards.filter(c=>c.set==='[SETID]'&&(!c.names.zh||!c.names.ja)); m.forEach(c=>console.log(c.uid,c.names.en,c.images&&c.images.zh_TW)); console.log(m.length,'missing');"
   If any missing: OCR their zh_TW/ja_JP images in batches of 8, then add to manual-name-overrides.js and re-run it
10. Restart the bot
```

---

## Key Facts

- **PK_20_ uses filename as key, not gid alone**: multi-variant gids (_00, _01, _02) need
  the variant number to distinguish different art positions. Use `path.basename(card.images.zh_TW)`.
- **Trainer full arts are TR_20_, not PK_20_**: check the folder for TR_20_ files; they
  map to the trainer positions in the IL rare range (e.g. pos 266–273 in A1).
- **Alt-art ex cards reuse gids**: same gid, different variant = same Pokémon, different art.
  Each variant gets its own consecutive card number.
- **TCGdex set IDs are UPPERCASE**: `A1` not `a1`.
- **B2a and B2b not on TCGdex**: use Serebii or Game8 for those.
- **Trainer zh**: ALWAYS read the zh_TW image. Never translate. Never guess.
- **After every fix**: always run all 4 pipeline scripts before restarting.
- **Bot caches DB on startup**: must restart after any patch for changes to take effect.
- **JSON is one long line**: use `node -p "JSON.stringify(db.cards.find(...),null,2)"` to
  read individual cards, or VSCode `Shift+Alt+F` to temporarily format for browsing.
- **Duplicate gids** (3× same gid for alternate arts): intentional — confirmed for A1.
- **A1 PK_10_ is clean**: gids are in official order; only PK_20_ needed fixing.
