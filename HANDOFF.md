# VGC Bot — Handoff Notes

## Project Overview

A Discord bot for Gen 9 VGC theorycrafting at **Level 50**. It wraps the `@smogon/calc`
damage calculator (local file dependency at `../damage-calc/calc`) and exposes three slash
commands plus a companion web guide.

| Command | Description |
|---|---|
| `/calc battle` | Manual damage calculation — full control over every variable |
| `/calc random` | Fully random chaotic scenario with a Reroll button |
| `/calc guess` | Random scenario with damage hidden — users guess the roll, game-show style |

---

## Repo Layout

```
C:\Users\sagen\vgc-bot\
  src\
    index.js                — bot entry point, interaction router, button/modal handlers
    deploy-commands.js      — registers slash commands with Discord API
    commands\
      calc.js               — /calc battle + /calc random + /calc guess logic
    utils\
      buildEmbed.js         — Discord embed construction, makeStatsRow, makeGuessRow
      evParser.js           — EV string parser + formatter
      pokeData.js           — lazily loads Gen 9 data; parseBoosts, randomBoosts, getBaseStats
      spriteComposite.js    — sharp-based side-by-side sprite compositing
  docs\
    index.html              — standalone VGC Damage Intuition Guide (GitHub Pages)

C:\Users\sagen\damage-calc\
  calc\                     — @smogon/calc source (TypeScript engine)
```

---

## Setup (from scratch)

```bash
# 1. Build the calc engine first
cd C:\Users\sagen\damage-calc && npm install

# 2. Install the bot
cd C:\Users\sagen\vgc-bot && npm install

# 3. Fill in .env (never commit this)
#    DISCORD_TOKEN=...
#    CLIENT_ID=...
#    GUILD_ID=...   (optional — instant deploy to one server vs ~1hr global)

# 4. Register slash commands with Discord
node src/deploy-commands.js

# 5. Start the bot
node src/index.js
```

> If `tsc` is not found in step 1: `npm install -g typescript`

---

## What Is Working

### `/calc battle`

Full manual calc; sits at Discord's 25-option limit.

- **Required:** `attacker`, `defender`, `move` (all with autocomplete)
- **Field:** `is_doubles` (default true), `weather`, `terrain`, `is_helping_hand`
- **Screens/rooms:** `reflect`, `light_screen`, `aurora_veil`, `friend_guard`, `wonder_room`
- **Per-Pokémon:** `*_evs`, `*_item`, `*_ability`, `*_tera`, `*_boosts`, `*_hp` (current HP %)
- **Misc:** `is_crit` (manual override; also auto-applied when stacked crit stages ≥ 3)
- Aura/Ruin abilities auto-detected from ability names → applied to Field flags
- Weather/terrain auto-applied from weather-setting abilities (Drought, Orichalcum Pulse,
  Drizzle, Sand Stream, Snow Warning, Desolate Land, Primordial Sea, Delta Stream,
  Electric Surge, Hadron Engine, Grassy Surge, Misty Surge, Psychic Surge, Seed Sower)
  when the user hasn't explicitly set a weather/terrain
- All calcs at **Level 50, all IVs 31**

### `/calc random` and `/calc guess`

Random scenarios from the full Gen 9 pool (fully-evolved species, all damage moves
excluding Z/Max/G-Max, all abilities, all items). Both have a `stat_changes` boolean option.

**`/calc random`:**
- Shows full damage roll, KO chance, 16 rolls, calc description
- Reroll button regenerates in-place
- Base Stats & Move info button (ephemeral)

**`/calc guess`:**
- Damage roll is hidden; shows "Your Challenge" with defender HP
- **Make a Guess** button (red 🎯) → Discord Modal → user types an HP number
  - Any value in the min–max range is correct
  - Wrong: shows direction hint (too high/low) + remaining guesses
  - 3 wrong guesses → answer revealed publicly with `calcDesc`
  - Correct → elapsed time shown publicly with `calcDesc`
- **See Answer** button (grey 🔍) → immediately reveals answer publicly, ends round
- **3-minute timeout** → answer revealed publicly with `calcDesc`
- `guessStates` Map tracks live rounds: `guessKey → { startTime, wrongCount, calcDesc, minDmg, maxDmg, defHP }`
- Rounds are keyed by `interaction.id`; deleting the key ends the round

### Embed Content (all commands)

- **Author line:** `PokémonName · MoveName [Type] · BP` (Variable BP for power-scaling moves; `X BP × N hits` for multi-hit)
- **Field Conditions:** game type, weather (with type emoji), terrain (with type emoji),
  Helping Hand, Fairy/Dark Aura, all four Ruin abilities, Reflect, Light Screen, Aurora Veil,
  Friend Guard, Wonder Room, Magic Room, ⚡ Critical Hit
- **Per-Pokémon panel:** EVs, Nature, Ability, Item, Status, Tera Type, current HP (if below max),
  stat boosts (including move-inherent boosts — see below)
- **Damage Roll:** min%–max%, KO chance, 16-roll bracket (hidden in guess mode)
- **Side-by-side HOME sprites** composited by `sharp` (falls back gracefully)
- **Base Stats & Move** button on all embeds (ephemeral): shows base stats + BST for both
  Pokémon, plus move Type/Category/BP info

### Mechanics Verified Correct

All handled automatically by `@smogon/calc` — no custom overrides needed:
- Spread move ×0.75 ✅
- Reflect/Light Screen: ×0.5 singles, ×2732/4096 doubles ✅
- Aurora Veil ✅ | Wonder Room Def↔SpD swap ✅ | Magic Room item suppression ✅
- Friend Guard ×0.75 ✅
- Psyshock/Psystrike/Secret Sword → Physical Defense ✅
- Guts (status → ×1.5 Atk, ignores burn) ✅
- Merciless (guaranteed crit vs poisoned target) ✅
- SE-reducing berries (Occa, Passho, etc.) ✅
- All variable-BP moves (Gyro Ball, Eruption, Reversal, Wring Out, etc.) ✅
- Guaranteed-crit moves (Surging Strikes, Frost Breath, Storm Throw) via `willCrit: true` in move data ✅

### Custom Bot Logic (not in @smogon/calc)

**Crit-stage stacking** (`getCritStage` in `calc.js`):
`@smogon/calc` only has a binary `willCrit` flag. The bot computes total crit stage from:
- High-crit moves (Night Slash, Leaf Blade, etc.) → +1
- Scope Lens / Razor Claw → +1 each
- Leek / Lucky Punch → +2
- Super Luck → +1

If total stage ≥ 3 → `isCrit: true` is forced. Also 20% random crit in random/guess scenarios.

**Move-inherent boosts** (`MOVE_INHERENT_BOOSTS` in `buildEmbed.js`):
Charge-turn moves that grant a stat boost before firing are shown in the attacker's Boosts
field so guessers know to account for them:
- Electro Shot → +1 SpA
- Meteor Beam → +1 SpA
- Skull Bash → +1 Def

**Weather/terrain auto-apply** (`resolveWeatherTerrain` in `calc.js`):
When an ability that sets weather/terrain is selected (e.g. Orichalcum Pulse → Sun),
the Field is updated automatically. Without this, `@smogon/calc` would see the ability
name but no weather and silently omit the ability's stat boost.

**HP-dependent moves:**
- `ATTACKER_HP_MOVES`: Reversal, Flail, Eruption, Water Spout, Dragon Energy
- `DEFENDER_HP_MOVES`: Wring Out, Hard Press
- In random/guess: current HP is randomized 5–95% for these moves
- In `/calc battle`: `attacker_hp` / `defender_hp` integer options (1–100%)
- Set via `pokemon.originalCurHP` after construction

**Weak Armor + multi-hit exclusion:**
`@smogon/calc` calculates all hits against the same starting Defense. Weak Armor drops Def
by 1 stage per physical hit, so later hits would be under-estimated. Any random attempt
pairing a Weak Armor defender with a multi-hit move (`moveObj.hits > 1`) is discarded and
retried.

---

## Known Bugs / Limitations

### 1. Custom Emojis Break in Other Servers

Embed text like `<:dice:...>` only renders for users in the server that owns the emoji.
Other servers see raw `:emojiname:` text.

**Fix:** Upload all custom emojis as **Application Emojis** in the Discord Developer Portal
(Application → Emojis tab). They get new IDs tied to the bot application and work everywhere.
After uploading, update all `setEmoji({ id, name })` calls and `<:name:id>` strings in
`buildEmbed.js` and `calc.js` with the new IDs.

**Status:** Pending — user is aware, pending upload.

### 2. Sprites Sometimes Missing

Pokémon with alternate form names (e.g. `Morpeko-Hangry`) get `toID()`'d to a slug with no
HOME sprite at `play.pokemonshowdown.com/sprites/home/`. Falls back silently to no image.

**Status:** Leave as-is. No clean fix without maintaining a name→slug map for every alt form.

### 3. Hosting (Not Yet on Raspberry Pi 5)

Bot only runs while `node src/index.js` is open in a terminal.

**Plan:** Deploy to Raspberry Pi 5 with PM2 for 24/7 uptime:
```bash
nvm install 20
cd ~/damage-calc && npm install
cd ~/vgc-bot && npm install
npm install -g pm2
pm2 start src/index.js --name vgc-bot
pm2 save && pm2 startup   # follow the printed command
```
**Status:** Pending — finishing bot features first.

### 4. `attacker_nature` / `defender_nature` Not a User-Facing Option

In `/calc battle`, nature is inferred from EV string and move category:
- No EV string provided → `Adamant` (physical) or `Modest` (special) for attacker, `Bold` for defender
- EV string provided → `Hardy` (neutral)

There is no way for the user to explicitly specify a nature. This means e.g. a user who
provides `252 Atk 252 Spe` EVs but wants Jolly (not Adamant) cannot express that.

**Fix:** Add `attacker_nature` / `defender_nature` dropdown options using the 25 NATURES list.
Currently at Discord's 25-option limit on `/calc battle` — would need to remove another option
first (candidates: `wonder_room` is rarely used, or consolidate HP options).

---

## Nothing To Do / Already Resolved

- ~~60-second guess timer~~ → extended to **3 minutes** (`180_000` ms)
- ~~Guess answer was ephemeral~~ → now public with elapsed time and `calcDesc`
- ~~No wrong-guess counter~~ → 3 wrong guesses before public reveal
- ~~No "See Answer" option~~ → grey 🔍 button added
- ~~Answer leaked in calc guess~~ → fixed: `.setDescription(!opts.hideRoll && calcDesc ? ... : null)`
- ~~Nature not shown in embed~~ → added to `pokeInfo()`
- ~~Move BP not shown~~ → added to author line
- ~~Crit not shown in field conditions~~ → `⚡ Critical Hit` added when `move.isCrit`
- ~~Orichalcum Pulse Ho-Oh not applying Sun~~ → `resolveWeatherTerrain()` added
- ~~Weak Armor + multi-hit wrong numbers~~ → combo excluded from random
- ~~Electro Shot boost not visible to guessers~~ → `MOVE_INHERENT_BOOSTS` merged into attacker panel
- ~~Wonder Room / Magic Room emojis~~ → updated to `:topsyturvy:` / `:magicroom:`
- ~~Screens / HH / Friend Guard emojis~~ → updated to correct custom emoji IDs
- ~~25-option Discord limit error~~ → removed `attacker_status`, `defender_status` options
- ~~Aura/Ruin abilities ignored~~ → auto-detected from ability name strings
- ~~Night Slash + Super Luck + Razor Claw not critting~~ → `getCritStage()` computes stacked stages
- ~~Autocomplete broken for attacker/defender~~ → fixed early-return bug in `getGen9Data()`
- ~~Z-moves and Max/G-Max in random~~ → filtered via `!m.isZ && !m.isMax`
- ~~All calcs at Level 100~~ → fixed to Level 50 everywhere
- ~~`resolvedGuesses` Set memory leak~~ → replaced with `guessStates` Map (deleted on resolution)

---

## Next Steps (Priority Order)

1. **Application Emojis** — upload custom emojis to Discord dev portal; update all IDs in
   `buildEmbed.js` and `calc.js`

2. **`attacker_nature` / `defender_nature` options** — add explicit nature dropdowns to
   `/calc battle`; will require removing one existing option to stay under 25 limit

3. **Raspberry Pi 5 hosting** — PM2 + boot autostart once features are stable

4. **`/calc guess` multiplayer scoring** — let multiple users guess before timer expires,
   track scores per user across a session

5. **Localization (CHT/JPN)** — re-implement translation layer in `buildEmbed.js` only.
   Do not re-add `lang` param until English output is verified stable.

6. **GitHub Pages guide** — push `docs/index.html` and enable Pages (repo Settings → Pages
   → branch `master`, folder `/docs`)

---

## Key Technical Notes

### `@smogon/calc` does NOT auto-apply weather from abilities

The calc library requires weather to be set explicitly in the `Field` object. Abilities like
Drought, Orichalcum Pulse, etc. are parsed for their damage modifier, but the weather effect
on other calculations (e.g. the Atk boost from Orichalcum Pulse in Sun) only kicks in when
`field.weather` is set to the matching value. The `resolveWeatherTerrain()` function in
`calc.js` bridges this gap.

### `guessStates` Map

`module.exports.guessStates` in `calc.js` — a Map keyed by `interaction.id`:
```
guessKey → { startTime: number, wrongCount: number, calcDesc: string,
             minDmg: number, maxDmg: number, defHP: number }
```
A key being present means the round is live. Delete the key to end it.
`index.js` imports this Map directly via `calcCommand.guessStates`.
The Map is never pruned (small memory leak for very long uptimes — acceptable for a small bot).

### Discord 25-option limit

`/calc battle` is at exactly 25 options. Adding any new option requires removing one.
Current candidates for removal if space is needed: `wonder_room` (rarely used in practice).

### `kochance()` return shape

`result.kochance()` returns `{ chance, n, text }`, NOT a plain string. Always use `ko.text`.

### `sharp` on Raspberry Pi 5

`spriteComposite.js` uses `sharp`. On ARM64 (Pi 5), `npm install` downloads the correct
prebuilt binary automatically (Node ≥ 18 required). If it fails: `npm rebuild sharp`.

### `damage-calc` must be built before `vgc-bot` installs

`vgc-bot/package.json` has `"@smogon/calc": "file:../damage-calc/calc"`. npm runs the
calc's `prepare` script (`tsc` + bundle) during install. Always `cd damage-calc && npm install`
before `cd vgc-bot && npm install`.
