# B2b Fix Methodology & Which Sets Still Need Fixing

## How B2b Was Fixed (No External Website Needed)

TCGdex doesn't have B2b data (returns 404). The fix was done entirely by:

### The Core Problem
The bot's build script sorts asset files by their 6-digit **global production ID (gid)** ascending,
then matches them positionally to the official card list from tcgdex.
If gids are not allocated in official card order, every card from the first mismatch onwards
gets the wrong name **and** the wrong image.

B2b (Mega Shine) had **two levels** of scrambling:
- `PK_10_` (regular cards #1-64) — gids were out of order
- `PK_20_` (illustration rares #70-114) — same gids, same scramble

### Step-by-Step Fix

**Step 1 — Identify the gid for every card in the set**
```js
node -e "
const db=JSON.parse(require('fs').readFileSync('data/ptcgp_cards.json'));
db.cards.filter(c=>c.set==='B2b'&&c.images?.zh_TW?.includes('PK_10_')).forEach(c=>{
  const m=c.images.zh_TW.match(/PK_10_(\d{6})_/);
  console.log('gid='+m[1]+' num='+c.num+' en='+c.names.en);
});
"
```
If `gid` order ≠ `num` order → the set is scrambled.

**Step 2 — OCR every card image**
Read each `en_US/PK_10_XXXXXX_00.png` file directly (Claude can read PNGs).
Build a complete `gid → actual Pokémon name` table.
Read in batches of 8 in parallel to save time. 64 cards = 8 batches.

**Step 3 — Get the official card order**
Since tcgdex has 404, used Serebii/Game8:
- `https://www.serebii.net/tcgpocket/megashine/`
- `https://game8.co/games/Pokemon-TCG-Pocket/` (search set name)

These gave the official #1-64 list in correct order.

**Step 4 — Build `GID_TO_POS` by cross-referencing OCR results with official list**
```
OCR says gid 016000 = Slowpoke
Official list says Slowpoke = card #15
Therefore: GID_TO_POS['016000'] = 15
```

**Step 5 — Write `scripts/patch-b2b-pk10.js`**
Model: `scripts/patch-a4a-pk10.js`
For each B2b card:
- Extract gid from `card.images.zh_TW` filename
- `GID_TO_POS[gid]` → correct card number
- `POS_TO_EN[pos]` → correct English name
- Look up zh/ja from `trilingual.json`
- Fix `card.num`, `card.uid`, `card.names.*`
- Re-sort B2b cards by num

**Step 6 — Fix PK_20_ illustration rares (`scripts/patch-b2b-pk20.js`)**
PK_20_ files use the **same gids** as PK_10_ (confirmed by reading images).
Sort the 45 PK_20_ files by their Pokémon's PK_10_ position → that gives
the official IL rare card order (#71-#114).
Hardcode `fileKey (gid_variant) → { num, en }` table. Example:
```
'016070_00' → { num: 71, en: 'Scyther' }   // gid 016070 = Scyther, IL rare #1
'016150_00' → { num: 77, en: 'Mega Charizard X ex' }
'016150_01' → { num: 78, en: 'Mega Charizard X ex' }  // variant 2
```

**Step 7 — Fix Mega ex zh/ja (inline in patch-b2b-pk20.js)**
`trilingual.json` doesn't have Mega forms. Hardcode overrides:
```js
const MEGA_ZH_JA = {
  'Mega Charizard X ex': { zh: '超級噴火龍Xex',  ja: 'メガリザードンXex' },
  'Mega Slowbro ex':     { zh: '超級呆殼獸ex',   ja: 'メガヤドランex'    },
  'Mega Manectric ex':   { zh: '超級雷電獸ex',   ja: 'メガライボルトex'  },
  'Mega Gengar ex':      { zh: '超級耿鬼ex',     ja: 'メガゲンガーex'    },
  'Mega Scizor ex':      { zh: '超級巨鉗螳螂ex', ja: 'メガハッサムex'    },
};
```

**Step 8 — Fix trainer zh (read zh_TW card images)**
Trainer cards are NOT affected by gid ordering, but zh may be empty.
Read the `zh_TW/TR_10_XXXXXX_00.png` image → note the Chinese card title.

**Step 9 — Run the pipeline**
```bash
node scripts/patch-b2b-pk10.js
node scripts/patch-b2b-pk20.js
node scripts/enrich-ptcgp-db.js
node scripts/enrich-ptcgp-zh-trainer.js
node scripts/enrich-sameset-specialart.js
```
Then restart the bot.

---

## Which Sets Are Correct Now

| Set | Name | PK_10_ | PK_20_ | Status |
|-----|------|--------|--------|--------|
| **A2** | Space-Time Smackdown | ✅ Safe | ✅ Safe | **NEW FORMAT** — name embedded in filename |
| **A2a** | Mythical Island | ✅ Safe | ✅ Safe | **NEW FORMAT** |
| **A2b** | Triumphant Light | ✅ Safe | ✅ Safe | **NEW FORMAT** |
| **B2b** | Mega Shine | ✅ Fixed | ✅ Fixed | Fixed this session |
| **A4a** | Secluded Springs | ✅ Fixed | ❓ Not checked | PK_10_ fixed, PK_20_ unchecked |
| **A3** | Triumphant Light | ⚠️ Partial | ❓ Not checked | 5 missing names fixed, ordering unverified |
| **B2a** | Shining Revelry | ⚠️ Partial | ❓ Not checked | 17 missing names fixed, ordering unverified |

> **NEW FORMAT** sets (A2, A2a, A2b) embed the Pokémon name code directly in the filename
> (e.g. `cPK_10_005370_UMIDIGDA_C_M_zh_TW.png`). These can never be scrambled.
> All other sets use old-format filenames (gid only) and are at risk.

---

## Sets Still Needing Full Verification

These sets have **never been checked** for gid ordering issues. Any or all could be scrambled.

| Set | Name | PK_10_ cards | PK_20_ cards | Priority |
|-----|------|-------------|-------------|----------|
| **A1** | Genetic Apex | 215 | 52 | High — largest set, most visible |
| **A1a** | Promo-A | 62 | 15 | Medium |
| **A3** | Triumphant Light | 141 | 74 | Medium — partial fix done |
| **A3a** | Extradimensional Crisis | 62 | 31 | Medium |
| **A3b** | Eevee Grove | 65 | 35 | Medium |
| **A4** | Celestial Guardians | 150 | 74 | Medium |
| **A4a** | Secluded Springs | 66 ✅ | 31 ❓ | Low — PK_10_ done, PK_20_ unchecked |
| **A4b** | Ancient Bond | 307 | 22 | Medium |
| **B1** | Space-Time Smackdown | 212 | 98 | High — large set |
| **B1a** | Mythical Island | 65 | 31 | Medium |
| **B2** | Prismatic Evolution | 143 | 74 | Medium |
| **B2a** | Shining Revelry | 90 | 31 | Medium — partial fix done |

---

## Quick Health Check (run for each set)

```bash
node -e "
const db=JSON.parse(require('fs').readFileSync('data/ptcgp_cards.json'));
const SET='A1'; // ← change this
const cards=db.cards.filter(c=>c.set===SET&&c.images?.zh_TW?.includes('PK_10_'));
const gids=cards.map(c=>({num:c.num,gid:c.images.zh_TW.match(/PK_10_(\d{6})/)[1],en:c.names.en}));
gids.slice(0,10).forEach(g=>console.log('num='+g.num+' gid='+g.gid+' en='+g.en));
console.log('...');
// Check: are gids in ascending order? (they should be if set is healthy)
let outOfOrder=0;
for(let i=1;i<gids.length;i++){
  if(gids[i].gid < gids[i-1].gid) { outOfOrder++; console.log('OUT OF ORDER at num='+gids[i].num); }
}
console.log(outOfOrder===0?'✅ GIDs in ascending order':'❌ '+outOfOrder+' out-of-order gids');
"
```

**If gids are in ascending order** → the set is probably clean (names match images).
**If gids are out of order** → the set is scrambled and needs the full OCR fix.

> Note: this check tells you about gid sort order but NOT whether the gids were assigned
> to the right Pokémon to begin with. A set can have ascending gids but still have wrong
> names if the entire block was off. Always spot-check a few card images to confirm.

---

## Prompting Template for Next Session

```
I need to fix wrong card images in the [SET NAME] ([setid]) set of my PTCGP Discord bot.

The bot asset path for card images:
  C:\Users\sagen\Desktop\PTCGP\[FOLDER NAME]\en_US\PK_10_XXXXXX_00.png

The database: data/ptcgp_cards.json
Reference scripts:
  - scripts/patch-b2b-pk10.js   (PK_10_ ordering fix — most complete example)
  - scripts/patch-b2b-pk20.js   (PK_20_ IL rare fix — use as template for IL rares)
  - docs/b2b-fix-methodology-and-next-sets.md  (this document)

Please:
1. Run the quick health check for [setid] (gid ascending order check)
2. If broken: read each PK_10_ en_US image (OCR) in batches of 8 to build gid → card name table
3. Get official card list from:
   - tcgdex first: https://api.tcgdex.net/v2/en/sets/[setid]
   - If 404: try Serebii https://www.serebii.net/tcgpocket/[setname]/
   - Or Game8: search "[set name] PTCG Pocket card list"
4. Write scripts/patch-[setid]-pk10.js
5. Check PK_20_ IL rares using the same gid mapping
6. Write scripts/patch-[setid]-pk20.js
7. Check trainer cards for empty zh (read zh_TW images)
8. Run pipeline:
   node scripts/patch-[setid]-pk10.js
   node scripts/patch-[setid]-pk20.js
   node scripts/enrich-ptcgp-db.js
   node scripts/enrich-ptcgp-zh-trainer.js
   node scripts/enrich-sameset-specialart.js
9. Restart the bot
```

---

## Key Facts to Remember

- **PK_20_ uses the same gids as PK_10_** — if gid 016070 = Scyther in PK_10_, then
  `PK_20_016070` also shows Scyther. Verified by OCR for B2b.
- **Multi-variant files** use suffix `_00`, `_01`, `_02` — same Pokémon, different art.
  Each variant gets its own consecutive card number.
- **Mega ex zh/ja** must be hardcoded — `trilingual.json` only has base forms.
  Pattern: zh = `超級[base zh]ex`, ja = `メガ[base ja]ex`
- **Trainer cards** are not affected by gid ordering, but zh may be empty.
  Fix by reading the `zh_TW` image and noting the card title.
- **tcgdex IDs** are lowercase set codes: A1→`a1`, B2b→`b2b`
- **B2a and B2b** are not on tcgdex — use Serebii or Game8
- Always run all 5 pipeline scripts in order after any patch
- Always restart the bot after patching (it caches the DB on startup)
