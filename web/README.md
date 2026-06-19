# VGC Pokédex Filter (web)

A standalone, offline web version of the bot's `/search pokemon` command.
Filter the **Pokémon Champions** roster (the available Pokémon **including Mega
Evolutions**) by **type, move, ability, stats**, and move type/category, in
**English / 繁體中文 / 日本語**, with the same boolean query grammar
(AND / OR / NOT, parentheses, 克/抗 matchups, stat comparisons).

## Run it

Just **double-click `index.html`** — no server needed. The data is bundled as
`data.js` (`window.DEX = …`) and loaded with a plain `<script>` tag, so it works
straight from `file://`. (If we used `fetch()` for the JSON, browsers would block
it under `file://`.)

## Files

| File | Purpose |
|------|---------|
| `index.html` | Page markup |
| `styles.css` | Styling |
| `data.js`    | **Generated** tri-lingual bundle (Pokémon / moves / abilities / types) |
| `search.js`  | Query engine — browser port of `src/utils/dexSearch.js` |
| `i18n.js`    | UI strings (en / zh / ja) |
| `app.js`     | UI controller (simple-filter → grammar → engine → render) |

## Regenerating the data

After updating the dex (new regulation, new mons, etc.):

```bash
node scripts/build-web-dex.js     # rewrites web/data.js from data/*.json
```

It reads `pokedex_champion_db.json`, `champion_moves_db.json`,
`champion_roster.json` (the allowlist of available `<dex>:<formKey>` slots scraped
from Serebii's `pokemonchampions/pokemon.shtml`), plus `trilingual.json`,
`zh-Hant.json`, and `moves_sv_detailed.json` for translations.

When a regulation update changes the roster, refresh `champion_roster.json` from
Serebii, then re-run the build. To target a different game instead, point the
script at another `pokedex_*_db.json`.

## Modes

- **Simple filters** (default): type chips, move/ability autocomplete chips, a
  type+category move row, and per-stat comparisons. These are compiled into a
  single `… AND …` grammar string and run through the same engine.
- **Complex query** (toggle, off by default): a free-text box accepting the full
  grammar, mirroring the bot. Errors are shown inline.

## Adding damage calc later (extension point)

The pieces are already in place:

- Every Pokémon in `window.DEX.pokemon` carries `stats` (`hp/atk/def/spa/spd/spe`),
  `bst`, `types`, and `abilities` — enough to drive a calc.
- `web/app.js` → `card(p)` is where a card is built; add a click handler there to
  open a calc panel. The placeholder `#calcStub` element is reserved for it.
- Keep the calc in a new `web/calc.js` (loaded after `search.js`) so `app.js`
  stays the thin controller. `search.js` already exposes `DexSearch.effectiveness`
  (the type chart) for type-effectiveness multipliers.
