#!/usr/bin/env python3
"""
Scrape Scarlet/Violet move data from pokemondb.net.

Input:  data/pokedex_scvi_db.json   (datamined SCVI data — ground truth for
                                      which Pokémon / forms exist in SV)
Output: data/scvi_moves_db.json
  {
    "bulbasaur":    { "level_up_moves": [{level, move_en}, ...],
                      "evolution_moves": [str, ...],
                      "reminder_moves":  [str, ...],
                      "egg_moves":       [str, ...],
                      "tm_moves":        [{tm, move_en}, ...] },
    "rotom-heat":   { ... },
    ...
  }
  level = 0  → learnt on evolution  (also stored in evolution_moves)
  level = -1 → learnt by reminder   (also stored in reminder_moves)

Egg move inheritance:
  If Bulbasaur learns Ingrain as an egg move, Ivysaur and Venusaur inherit it
  automatically via the evolves_from_en_name chain in the SCVI db.

Page structure handled:
  • Simple    — section contains a direct div.resp-scroll (no form variants)
  • Tabbed    — section contains a div.tabset-moves-game-form with per-form
                inner tab panels (e.g. Lycanroc's separate Midday/Midnight/Dusk
                tables for EACH of level-up, TM, egg, etc.)

Run:    python build_scvi_moves.py
Resume: re-run — already-complete entries are skipped.
Reset:  rm data/scvi_moves_db.json  then re-run.
"""

import json
import time
import re
import sys
import io
from pathlib import Path
from collections import defaultdict

import requests
from bs4 import BeautifulSoup

# ── Config ────────────────────────────────────────────────────────────────────
SCVI_DB_FILE = Path("data/pokedex_scvi_db.json")
OUT_FILE     = Path("data/scvi_moves_db.json")
BASE_URL     = "https://pokemondb.net"
DELAY        = 1.2
HEADERS      = {
    "User-Agent": "Mozilla/5.0 (compatible; research-scraper/1.0; +personal-use)",
    "Accept-Language": "en-US,en;q=0.9",
}

# ── Slug normalisation ────────────────────────────────────────────────────────
_SLUG_SUB = str.maketrans({
    "'": "", "\u2019": "", "é": "e", "♀": "-f", "♂": "-m",
    ".": "", ":": "", "!": "", "?": "",
})

def to_slug(name: str) -> str:
    return re.sub(r"\s+", "-", name.strip().lower().translate(_SLUG_SUB))


# ── Table parsers ─────────────────────────────────────────────────────────────

def clean_move(raw: str) -> str:
    return re.sub(r"[†‡*◊]+$", "", raw).strip()


def parse_level_up(table) -> list:
    """[Lv., Move, …]  →  [{level: int, move_en: str}]"""
    out = []
    tbody = table.find("tbody")
    if not tbody:
        return out
    for tr in tbody.find_all("tr"):
        cells = tr.find_all("td")
        if len(cells) < 2:
            continue
        try:
            level = int(cells[0].get_text(strip=True))
        except ValueError:
            level = 0          # "Evo." etc.
        move = clean_move(cells[1].get_text(strip=True))
        out.append({"level": level, "move_en": move})
    return out


def parse_tm(table) -> list:
    """[TM, Move, …]  →  [{tm: str, move_en: str}]"""
    out = []
    tbody = table.find("tbody")
    if not tbody:
        return out
    for tr in tbody.find_all("tr"):
        cells = tr.find_all("td")
        if len(cells) < 2:
            continue
        try:
            tm_num = str(int(cells[0].get_text(strip=True))).zfill(3)
        except ValueError:
            tm_num = cells[0].get_text(strip=True)
        move = clean_move(cells[1].get_text(strip=True))
        out.append({"tm": tm_num, "move_en": move})
    return out


def parse_names(table) -> list:
    """[Move, …]  →  [str]  (egg / evo / reminder tables)"""
    out = []
    tbody = table.find("tbody")
    if not tbody:
        return out
    for tr in tbody.find_all("tr"):
        cells = tr.find_all("td")
        if cells:
            move = clean_move(cells[0].get_text(strip=True))
            if move:
                out.append(move)
    return out


# ── Form-tab matching ─────────────────────────────────────────────────────────

def form_matches_tab(form_name: str, tab_label: str) -> bool:
    """
    Does the SCVI db form_name (e.g. "midday", "pom-pom") match a pokemondb
    tab label (e.g. "Midday Form", "Pom-Pom Style")?
    """
    if not form_name:
        return False
    fn = form_name.lower().replace("-", " ")
    tl = (tab_label.lower()
          .replace("-", " ").replace("'", "").replace("\u2019", ""))
    if fn in tl:
        return True
    generic = {"form", "style", "mode", "build", "breed", "mask",
               "stripe", "rider", "cap", "original", "the"}
    fn_key = set(fn.split()) - generic
    tl_words = set(tl.split())
    return bool(fn_key) and fn_key.issubset(tl_words)


def pick_inner_panel(tabset_div, form_name: str):
    """
    Within a section-level inner tabset (div.tabset-moves-game-form),
    return the panel for the requested form (or the first panel as default).
    """
    children = [c for c in tabset_div.children
                if hasattr(c, "get") and c.get("class")]
    tl = next((c for c in children if c.get("class") == ["sv-tabs-tab-list"]),   None)
    pl = next((c for c in children if c.get("class") == ["sv-tabs-panel-list"]), None)
    if not tl or not pl:
        return None

    tabs   = tl.find_all("a", recursive=False)
    panels = pl.find_all(recursive=False)
    if not panels:
        return None

    if form_name:
        for i, tab in enumerate(tabs):
            if form_matches_tab(form_name, tab.get_text(strip=True)):
                return panels[i] if i < len(panels) else panels[0]

    return panels[0]   # default / base form


def table_from_node(node) -> object:
    """
    Given a div.resp-scroll or a panel returned by pick_inner_panel,
    return the first <table> found inside it (or None).
    """
    if node is None:
        return None
    scroll = node.find("div", class_="resp-scroll")
    if scroll:
        return scroll.find("table")
    return node.find("table")


# ── Section extraction ────────────────────────────────────────────────────────

def EMPTY():
    return {
        "level_up_moves":  [],
        "evolution_moves": [],
        "reminder_moves":  [],
        "egg_moves":       [],
        "tm_moves":        [],
    }


def extract_sections(sv_panel, form_name: str = "") -> dict:
    """
    Walk the column structure of the SV game panel.

    Each column child is either:
      h3                         → marks the current section type
      div.resp-scroll            → table for current section (no form variants)
      div.tabset-moves-game-form → form-specific inner tabset for current section

    For the inner tabset case, we pick the sub-panel that matches form_name.
    """
    result = EMPTY()

    # Collect columns: grid-row > grid-col divs, or the whole panel if no grid
    columns = []
    for grid in sv_panel.find_all("div", class_="grid-row", recursive=False):
        columns.extend(grid.find_all(recursive=False))
    if not columns:
        # No grid-row — check one level deeper (some panels wrap everything)
        for grid in sv_panel.find_all("div", class_="grid-row"):
            columns.extend(grid.find_all(recursive=False))
    if not columns:
        columns = [sv_panel]

    for col in columns:
        if not hasattr(col, "name") or col.name != "div":
            continue

        current_h3 = None
        for child in col.children:
            if not hasattr(child, "name") or not child.name:
                continue

            if child.name == "h3":
                current_h3 = child.get_text(strip=True).lower()
                continue

            if child.name != "div" or current_h3 is None:
                continue

            cls = child.get("class") or []
            table = None

            if "resp-scroll" in cls:
                table = child.find("table")

            elif any("tabset-moves-game-form" in c for c in cls):
                # Per-form inner tabset: pick the right form panel
                panel = pick_inner_panel(child, form_name)
                table = table_from_node(panel)

            if table is None:
                continue

            # Categorise by heading
            if "level up" in current_h3:
                result["level_up_moves"] = parse_level_up(table)

            elif "evolution" in current_h3:
                evos = parse_names(table)
                result["evolution_moves"] = evos
                for m in evos:
                    result["level_up_moves"].append({"level": 0, "move_en": m})

            elif "reminder" in current_h3:
                rems = parse_names(table)
                result["reminder_moves"] = rems
                for m in rems:
                    result["level_up_moves"].append({"level": -1, "move_en": m})

            elif "egg" in current_h3:
                result["egg_moves"] = parse_names(table)

            elif "tm" in current_h3 or "technical machine" in current_h3:
                result["tm_moves"] = parse_tm(table)

    return result


# ── Page-level navigation ─────────────────────────────────────────────────────

def get_sv_panel(soup):
    """
    Return the outer SV game panel from the move tabset.
    Falls back to LZ-A panel if SV is absent.
    """
    ts = soup.select_one("[class*='tabset-moves-game']")
    if not ts:
        return None

    children = [c for c in ts.children if hasattr(c, "get") and c.get("class")]
    tl = next((c for c in children if c.get("class") == ["sv-tabs-tab-list"]),   None)
    pl = next((c for c in children if c.get("class") == ["sv-tabs-panel-list"]), None)
    if not tl or not pl:
        return None

    tabs   = tl.find_all("a", recursive=False)
    panels = pl.find_all(recursive=False)

    sv_idx  = next((i for i, a in enumerate(tabs) if "Scarlet/Violet" in a.get_text()), None)
    lza_idx = next((i for i, a in enumerate(tabs) if "Legends"         in a.get_text()), None)

    if sv_idx is not None and sv_idx < len(panels):
        return panels[sv_idx]
    if lza_idx is not None and lza_idx < len(panels):
        return panels[lza_idx]
    return panels[0] if panels else None


def scrape_species(species_slug: str, session, forms: list) -> dict:
    """
    Fetch one species page. Extract move data for each (name_en, form_name) pair.
    Returns { name_en: data_dict, ... }.
    """
    url = f"{BASE_URL}/pokedex/{species_slug}"
    try:
        r = session.get(url, timeout=30)
        r.raise_for_status()
    except Exception as e:
        print(f"\n  ERROR {url}: {e}")
        return {name_en: EMPTY() for name_en, _ in forms}

    soup      = BeautifulSoup(r.text, "html.parser")
    sv_panel  = get_sv_panel(soup)

    if sv_panel is None:
        return {name_en: EMPTY() for name_en, _ in forms}

    return {
        name_en: extract_sections(sv_panel, form_name)
        for name_en, form_name in forms
    }


# ── Egg move inheritance ──────────────────────────────────────────────────────

def inherit_moves(db: dict, scvi: dict):
    """
    Propagate egg moves AND TM moves down evolution chains.

    If Bulbasaur learns Ingrain as an egg move, Ivysaur/Venusaur inherit it.
    If Charmander can learn False Swipe via TM, Charmeleon/Charizard inherit it.

    Level-up moves are NOT inherited (evolutions have their own level-up sets).

    Uses evolves_from_en_name from the SCVI db to walk the chain.
    Runs multiple passes until stable (handles 3-stage chains).
    """
    print("\nInheriting moves down evolution chains...")
    egg_added = 0
    tm_added  = 0

    for _pass in range(5):  # max 5 passes (more than enough for any chain)
        added_this_pass = 0
        for name_en, entry in scvi.items():
            pre_evo = entry.get("evolves_from_en_name")
            if not pre_evo or pre_evo not in db or name_en not in db:
                continue

            # ── Egg moves ────────────────────────────────────────────────────
            current_eggs = set(db[name_en]["egg_moves"])
            pre_eggs     = set(db[pre_evo]["egg_moves"])
            new_eggs     = pre_eggs - current_eggs
            if new_eggs:
                db[name_en]["egg_moves"] = sorted(current_eggs | new_eggs)
                egg_added += len(new_eggs)
                added_this_pass += len(new_eggs)

            # ── TM moves ──────────────────────────────────────────────────────
            current_tm_names = {m["move_en"] for m in db[name_en]["tm_moves"]}
            pre_tms          = db[pre_evo]["tm_moves"]
            new_tms          = [m for m in pre_tms if m["move_en"] not in current_tm_names]
            if new_tms:
                db[name_en]["tm_moves"] = sorted(
                    db[name_en]["tm_moves"] + new_tms,
                    key=lambda m: m["tm"]
                )
                tm_added += len(new_tms)
                added_this_pass += len(new_tms)

        if added_this_pass == 0:
            break

    print(f"  Egg moves inherited: {egg_added}")
    print(f"  TM moves inherited:  {tm_added}")


# ── Validation ────────────────────────────────────────────────────────────────

def validate(scraped: dict, db_moves_en: list) -> str:
    """Compare scraped moves (slugified) against datamined moves_en list."""
    scraped_slugs = set()
    for m in scraped.get("level_up_moves", []):
        if m["level"] >= -1:
            scraped_slugs.add(to_slug(m["move_en"]))
    for m in scraped.get("egg_moves", []):
        scraped_slugs.add(to_slug(m))
    for m in scraped.get("tm_moves", []):
        scraped_slugs.add(to_slug(m["move_en"]))

    db_set      = set(db_moves_en)
    common      = db_set & scraped_slugs
    only_db     = db_set - scraped_slugs
    only_scraped= scraped_slugs - db_set
    pct         = 100 * len(common) / len(db_set) if db_set else 0

    if pct < 100:
        return (f"⚠  {pct:.0f}%  "
                f"missing={sorted(only_db)[:5]}  "
                f"extra={sorted(only_scraped)[:3]}")
    return f"✓  {len(db_set)} moves"


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    sys.stdout = io.TextIOWrapper(
        sys.stdout.buffer, encoding="utf-8", errors="replace", line_buffering=True
    )

    if not SCVI_DB_FILE.exists():
        print(f"ERROR: {SCVI_DB_FILE} not found.")
        sys.exit(1)

    with SCVI_DB_FILE.open(encoding="utf-8") as f:
        scvi_raw = json.load(f)
    scvi = {v["name_en"]: v for v in scvi_raw.values()}
    print(f"SCVI db loaded: {len(scvi)} entries")

    # Group by species (one HTTP fetch per species page)
    by_species: dict[str, list] = defaultdict(list)
    for name_en, entry in scvi.items():
        species   = entry.get("species_en_name") or name_en
        form_name = entry.get("form_name") or ""
        by_species[species].append((name_en, form_name))
    print(f"Unique species pages: {len(by_species)}")

    # Load existing output for resumability
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    if OUT_FILE.exists():
        with OUT_FILE.open(encoding="utf-8") as f:
            db = json.load(f)
        print(f"Resuming — {len(db)} entries already saved.")
    else:
        db = {}

    session = requests.Session()
    session.headers.update(HEADERS)

    # Only fetch species where at least one form entry is missing
    todo = [
        (sp, forms)
        for sp, forms in by_species.items()
        if any(n not in db for n, _ in forms)
    ]
    print(f"Species left to scrape: {len(todo)}\n")

    warnings = []

    for idx, (species, forms) in enumerate(todo, 1):
        missing = [(n, f) for n, f in forms if n not in db]
        print(f"[{idx}/{len(todo)}] {species}", end="  ")

        scraped = scrape_species(species, session, missing)

        for name_en, data in scraped.items():
            db[name_en] = data
            lv  = len(data["level_up_moves"])
            tm  = len(data["tm_moves"])
            egg = len(data["egg_moves"])
            evo = len(data["evolution_moves"])
            rem = len(data["reminder_moves"])
            extras = []
            if evo: extras.append(f"{evo}evo")
            if rem: extras.append(f"{rem}rem")
            if egg: extras.append(f"{egg}egg")
            tag = f"[{' '.join(extras)}]" if extras else ""
            db_mv = scvi.get(name_en, {}).get("moves_en", [])
            vstatus = validate(data, db_mv) if db_mv else "—"
            print(f"{name_en}:{lv}lv/{tm}TM{tag} {vstatus}", end="  ")
            if "⚠" in vstatus:
                warnings.append(f"{name_en}: {vstatus}")
        print()

        if idx % 5 == 0:
            with OUT_FILE.open("w", encoding="utf-8") as f:
                json.dump(db, f, ensure_ascii=False, indent=2)

        time.sleep(DELAY)

    # Inherit egg + TM moves down evolution chains
    inherit_moves(db, scvi)

    # Final save
    with OUT_FILE.open("w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=2)

    total = len(db)
    pct   = 100 * total / len(scvi)
    print(f"\n{'='*60}")
    print(f"Done! {total}/{len(scvi)} entries ({pct:.1f}%) → {OUT_FILE}")

    if warnings:
        print(f"\n{len(warnings)} validation warnings "
              f"(some may be resolved after egg move inheritance):")
        for w in warnings[:30]:
            print(f"  {w}")
    else:
        print("All entries matched datamined move lists ✓")


if __name__ == "__main__":
    main()
