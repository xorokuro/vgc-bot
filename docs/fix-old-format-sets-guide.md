# Guide: Fixing Wrong Card Images in Old-Format Sets

## Background

PTCGP card asset files come in two filename formats:

### New-format (SAFE — name embedded in filename)
```
cPK_10_005370_00_UMIDIGDA_C_M_zh_TW_UT.png
                  ^^^^^^^^
                  name code → look up in CODE_TO_EN table
```
Sets: **A2, A2a, A2b**
These are reliable. `fix-new-format-names.js` handles them. No ordering issues.

### Old-format (RISKY — name NOT in filename)
```
PK_10_010180_00.png
     ^^^^^^^^
     global production ID (gid) only — name assigned by sort position
```
Sets: **A1, A3, A3a, A3b, A4, A4a, A4b, B1, B1a, B2, B2a, B2b**, and likely all future sets until Pokémon changes the format.

The build script sorts these files by gid and matches positionally to tcgdex API order. **If any files have out-of-sequence gids, every card from that point onwards gets the wrong name and image.**

---

## How to Detect a Broken Set

Symptom: searching for a Pokémon by name returns the right name/number but wrong image (or vice versa).

Quick check in a new session:
```
Look at data/ptcgp_cards.json — filter cards for set "B2b".
For each card, extract the gid from card.images.zh_TW filename.
Sort cards by gid. Does the order match the official card numbering?
```

Or just ask the bot for a specific card and compare the image to what Bulbapedia/TCGdex says it should be.

---

## The Fix: OCR Mapping

**Only works if you have local asset files** (the `zh_TW` PNG folder on disk).

### Step 1 — Find the asset folder
```
Look for where zh_TW PK_10_ PNG files are stored for the broken set.
Usually: somewhere under the bot's images/assets directory.
Ask Claude: "Where are the B2b zh_TW card image files stored?"
```

### Step 2 — Read each image with Claude's vision
Claude can read PNG files directly. For each PK_10_ file in the set:
```
Read the image at [path]/PK_10_XXXXXX_00.png
Note: gid (6-digit number from filename) → card name shown on image
```
Build a complete `gid → card name` table.

### Step 3 — Cross-reference official order
Use **tcgdex** to get the official card list in position order:
- `https://api.tcgdex.net/v2/en/sets/b2b` — returns cards array in official order
- Position 1 = card #1, position 2 = card #2, etc.

Or use **Bulbapedia**:
- `https://bulbapedia.bulbagarden.net/wiki/Mega_Shine_(TCG)` (for B2b)
- Has full set list with official numbers

### Step 4 — Write a patch script
Model after `scripts/patch-a4a-pk10.js`:
```javascript
const GID_TO_POS = {
  '010120': 22,   // gid → official card position
  '010180': 62,
  // ... all cards
};
const POS_TO_EN = {
  1: 'Hoppip',
  22: 'Milotic',
  // ... all positions
};
```
The script: looks up each A4a/B2b card's gid → finds correct position → assigns correct en name → fixes `card.num` and `card.uid`.

### Step 5 — Run the pipeline
```bash
node scripts/patch-[setid]-pk10.js
node scripts/enrich-ptcgp-db.js
node scripts/enrich-ptcgp-zh-trainer.js
```
Then restart the bot.

---

## Language Treatment

**One fix covers all languages.** Here's why:

- The `images.zh_TW` filename is used to extract the gid (it's the same gid across all language variants of the same card)
- Patching `card.names.en` to the correct English name
- `enrich-ptcgp-db.js` then fills `zh` and `ja` from `trilingual.json` using the English name as key
- `enrich-ptcgp-zh-trainer.js` fills any remaining zh/ja by scraping the TCGP wiki

So: **fix the English name → zh and ja follow automatically** via the enrichment pipeline.

Exception: trainer cards not in `trilingual.json` (like Iris, Calem, Whitney) need zh/ja hardcoded in the patch script or sourced from Bulbapedia manually.

---

## Sets That Need This Treatment

| Set | Name | Status | Notes |
|-----|------|--------|-------|
| **B2b** | Mega Shine | ❌ Broken | Empoleon #20 → shows Slowbro ex image. Needs full OCR pass. ~64 PK_10_ cards. |
| **A4a** | Secluded Springs | ✅ Patched | `patch-a4a-pk10.js` run 2026-03-28. Trainer cards #67-71 still need zh/ja. |
| **A3** | Triumphant Light | ⚠️ Unknown | 5 known missing names. May have ordering issues. |
| **B2a** | Shining Revelry | ⚠️ Unknown | 17 known missing names. Likely ordering issues. |
| **A1** | Genetic Apex | ⚠️ Unknown | Large set, never checked. |
| **A3a** | Extradimensional Crisis | ⚠️ Unknown | Never checked. |
| **A3b** | Eevee Grove | ⚠️ Unknown | Never checked. |
| **A4** | Celestial Guardians | ⚠️ Unknown | Never checked. |
| **B1** | Space-Time Smackdown | ⚠️ Unknown | Never checked. |
| **B1a** | Mythical Island | ⚠️ Unknown | Never checked. |
| **B2** | Prismatic Evolution | ⚠️ Unknown | Never checked. |

Priority order suggested: **B2b first** (confirmed broken), then B2a (17 missing), then A3 (5 missing).

---

## Reference Sites

| Purpose | URL |
|---------|-----|
| Official card list + positions | `https://api.tcgdex.net/v2/en/sets/[setid]` (e.g. `b2b`, `a4a`) |
| Full set page with card numbers | `https://www.tcgdex.net/en/set/[setid]` |
| Set names & trainer card details | `https://bulbapedia.bulbagarden.net/wiki/[Set_Name]_(TCG)` |
| Trainer card zh names | `https://wiki.52poke.com/wiki/PTCGP` (Traditional Chinese Pokémon wiki) |
| Official set reference | `https://www.pokemon-zone.com/sets/[setid]/` |

To get tcgdex set ID: look at `card.set` field in `ptcgp_cards.json`, lowercase = tcgdex ID.

---

## Prompting Template for Next Session

Paste this at the start of the session:

```
I need to fix wrong card images in the [SET_NAME] ([setid]) set of my PTCGP Discord bot.

The problem: old-format filenames (PK_10_XXXXXX_00.png) have no name codes,
so cards were assigned names by gid sort order which doesn't match official card order.
Example symptom: searching "[CARD NAME]" returns the right name but wrong image.

The asset files are at: [PATH TO zh_TW PNG FOLDER]
The database is at: data/ptcgp_cards.json
The existing patch script to model from: scripts/patch-a4a-pk10.js

Please:
1. List all PK_10_ files for set [setid] from data/ptcgp_cards.json (show gid + current en name)
2. Read each card image to confirm the actual card name via OCR
3. Cross-reference with tcgdex: https://api.tcgdex.net/v2/en/sets/[setid]
4. Write a patch script: scripts/patch-[setid]-pk10.js
5. Run: node scripts/patch-[setid]-pk10.js
6. Run: node scripts/enrich-ptcgp-db.js && node scripts/enrich-ptcgp-zh-trainer.js
```

---

## Important: After Every Fix

Always run in order:
```bash
node scripts/patch-[setid]-pk10.js         # fixes names + card numbers
node scripts/enrich-ptcgp-db.js             # fills zh/ja from trilingual.json
node scripts/enrich-ptcgp-zh-trainer.js     # fills trainer card zh/ja from wiki
node scripts/enrich-sameset-specialart.js   # propagates names to SR/UR art variants
```
Then **restart the Discord bot** — it caches the database on startup.
