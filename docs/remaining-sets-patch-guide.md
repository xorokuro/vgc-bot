# Remaining Sets to Patch — Session Guide

## Sets Still Unchecked (as of 2026-03-29)

| Set | Name | Cards | Priority |
|-----|------|-------|----------|
| **A1** | Genetic Apex | Large (~226 Pokémon) | Low — oldest, may be fine |
| **A3a** | Extradimensional Crisis | Medium | Unknown |
| **A3b** | Eevee Grove | Medium | Unknown |
| **A4** | Celestial Guardians | Medium | Unknown |
| **A4b** | Ancient Bond | Medium | Unknown |
| **B1** | Space-Time Smackdown | Medium | Unknown |
| **B1a** | Mythical Island | Small | Unknown |
| **B2** | Prismatic Evolution | Medium | Unknown |

---

## Step 1 — Check If a Set Is Broken

For each set, run this in a new terminal to see if gid order matches card number order:

```bash
node -e "
const db=JSON.parse(require('fs').readFileSync('data/ptcgp_cards.json'));
const SET='A1'; // <-- change this
const cards=db.cards.filter(c=>c.set===SET&&c.images&&c.images.zh_TW&&c.images.zh_TW.includes('PK_10_'));
cards.forEach(c=>{
  const m=c.images.zh_TW.match(/PK_10_(\d{6})_/);
  console.log('gid='+m[1]+' num='+c.num+' en='+c.names.en);
});
"
```

**Healthy output** — gids ascending AND card nums ascending in same order, e.g.:
```
gid=001000 num=1  en=Bulbasaur
gid=001010 num=2  en=Ivysaur
gid=001020 num=3  en=Venusaur
```

**Broken output** — gids out of order relative to card nums, e.g.:
```
gid=016000 num=1  en=Scyther      ← gid 016000 but it's card #1?
gid=016070 num=6  en=Trevenant    ← this was actually Scyther (gid 016070)
```

If the set looks broken, continue to Step 2. If it looks clean, skip that set.

---

## Step 2 — Read Card Images (OCR)

**Asset path:** `C:\Users\sagen\Desktop\PTCGP\[SET FOLDER]\en_US\PK_10_XXXXXX_00.png`

Find the folder name by running:
```bash
node -e "
const db=JSON.parse(require('fs').readFileSync('data/ptcgp_cards.json'));
const c=db.cards.find(c=>c.set==='A1'&&c.images&&c.images.zh_TW);
console.log(c.images.zh_TW);
"
```

Then ask Claude to read each image to confirm the card name shown. Read them in batches of 8 in parallel (Claude can read PNG files directly). Build a complete `gid → actual card name` table.

---

## Step 3 — Get the Official Card List

Use tcgdex API (lowercase set ID):
```
https://api.tcgdex.net/v2/en/sets/a1
https://api.tcgdex.net/v2/en/sets/a3a
https://api.tcgdex.net/v2/en/sets/b1
```

If tcgdex gives 404, try:
- `https://www.serebii.net/tcgpocket/[setname]/` (e.g. `geneticapex`)
- `https://game8.co/games/Pokemon-TCG-Pocket/` (search for set)
- `https://bulbapedia.bulbagarden.net/wiki/[Set_Name]_(TCG)`

The API returns cards in official order — position 1 = card #1.

---

## Step 4 — Write the Patch Script

Model after `scripts/patch-b2b-pk10.js` (the most recent example).

```javascript
// gid → official position (built from OCR)
const GID_TO_POS = {
  '001000':  1,
  '001010':  2,
  // ...all gids
};

// official position → English name (from tcgdex/serebii)
const POS_TO_EN = {
  1: 'Bulbasaur',
  2: 'Ivysaur',
  // ...all positions
};
```

Save as `scripts/patch-[setid]-pk10.js`.

---

## Step 5 — Handle Mega ex / Special Form zh/ja

If the set has Mega ex cards, their zh/ja won't be in `trilingual.json`.

**zh naming pattern:** `超級[zh base name]ex` (no space before ex)
- Mega Slowbro ex → `超級呆殼獸ex`
- Mega Gengar ex → `超級耿鬼ex`

**ja naming pattern:** `メガ[ja base name]ex`
- Mega Slowbro ex → `メガヤドランex`
- Mega Gengar ex → `メガゲンガーex`

**Paldean forms:** `帕底亞 [zh base name]` / `パルデア [ja base name]`

Write a supplementary `patch-[setid]-mega-names.js` (model after `scripts/patch-b2b-mega-names.js`).

---

## Step 6 — Run the Full Pipeline

```bash
node scripts/patch-[setid]-pk10.js
node scripts/patch-[setid]-mega-names.js   # only if Mega ex cards exist
node scripts/enrich-ptcgp-db.js
node scripts/enrich-ptcgp-zh-trainer.js
node scripts/enrich-sameset-specialart.js
```

Then **restart the Discord bot**.

---

## Step 7 — Verify

```bash
node -e "
const db=JSON.parse(require('fs').readFileSync('data/ptcgp_cards.json'));
const SET='A1';
const cards=db.cards.filter(c=>c.set===SET&&c.images&&c.images.zh_TW&&c.images.zh_TW.includes('PK_10_'));
const empty=cards.filter(c=>!c.names.zh||!c.names.en);
console.log('Total PK_10_: '+cards.length);
console.log('Empty names: '+empty.length);
empty.forEach(c=>console.log('  '+c.uid+' en='+c.names.en));
// Spot check: show first 5 and last 5
cards.slice(0,5).concat(cards.slice(-5)).forEach(c=>{
  const m=c.images.zh_TW.match(/PK_10_(\d{6})_/);
  console.log('#'+c.num+' gid='+m[1]+' en='+c.names.en+' zh='+c.names.zh);
});
"
```

---

## Prompting Template for Claude

Paste at the start of the session:

```
I need to fix wrong card images in the [SET NAME] ([setid]) set of my PTCGP Discord bot.

The problem: old-format filenames (PK_10_XXXXXX_00.png) have no name codes,
so cards were assigned names by gid sort order which may not match official card order.

The asset files are at: C:\Users\sagen\Desktop\PTCGP\[FOLDER NAME]\en_US\
The database is at: data/ptcgp_cards.json

Reference scripts to model from:
  - scripts/patch-b2b-pk10.js         (full ordering fix)
  - scripts/patch-b2b-mega-names.js   (Mega ex zh/ja fix)
  - scripts/patch-a3-missing.js       (missing names only, no ordering fix)

Please:
1. Run the Step 1 gid-order check for [setid]
2. If broken: read each PK_10_ card image (OCR) to confirm actual card names
3. Fetch official card list from: https://api.tcgdex.net/v2/en/sets/[setid]
4. Write scripts/patch-[setid]-pk10.js
5. Check if any Mega ex or special-form zh/ja need fixing
6. Run the full pipeline:
   node scripts/patch-[setid]-pk10.js
   node scripts/enrich-ptcgp-db.js
   node scripts/enrich-ptcgp-zh-trainer.js
   node scripts/enrich-sameset-specialart.js
7. Verify with the Step 7 check
```

---

## Notes from Previous Sessions

- **tcgdex set IDs** are lowercase versions of the `card.set` field: A1→`a1`, B2b→`b2b`
- **B2a and B2b** are not on tcgdex — use Serebii/Game8 instead
- **Duplicate gids** (e.g. 3× same gid for alternate arts) are intentional and correct — confirm against tcgdex before treating as a bug
- **Trainer cards** (TR_10_, TR_20_) are not affected by the gid ordering bug — they have their own separate gid ranges and were named separately
- **After every fix**, always run all 4 pipeline scripts in order before restarting the bot
