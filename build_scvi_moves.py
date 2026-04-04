#!/usr/bin/env python3
"""
Scrape Scarlet/Violet move data from pokemondb.net.

Sources:
  https://pokemondb.net/pokedex/game/scarlet-violet           (base game, 400 Pokémon)
  https://pokemondb.net/pokedex/game/scarlet-violet/teal-mask
  https://pokemondb.net/pokedex/game/scarlet-violet/indigo-disk

Output: data/scvi_moves_db.json
  {
    "bulbasaur": {
      "level_up_moves": [{"level": 1, "move_en": "Growl"}, ...],
      "tm_moves": ["01", "Take Down"],   ← actually: [{"tm": "01", "move_en": "Take Down"}, ...]
    },
    ...
  }

Run:  python build_scvi_moves.py
Re-run is safe — it skips already-scraped entries (checkpoint file).
"""

import json
import time
import sys
import io
import re
from pathlib import Path

import requests
from bs4 import BeautifulSoup

# ── Config ────────────────────────────────────────────────────────────────────
GAME_PAGES = [
    "https://pokemondb.net/pokedex/game/scarlet-violet",
    "https://pokemondb.net/pokedex/game/scarlet-violet/teal-mask",
    "https://pokemondb.net/pokedex/game/scarlet-violet/indigo-disk",
]
BASE_URL   = "https://pokemondb.net"
OUT_FILE   = Path("data/scvi_moves_db.json")
DELAY      = 1.2   # seconds between requests — be polite
HEADERS    = {
    "User-Agent": "Mozilla/5.0 (compatible; research-scraper/1.0; +personal-use)",
    "Accept-Language": "en-US,en;q=0.9",
}

# ── Helpers ───────────────────────────────────────────────────────────────────

def make_session():
    s = requests.Session()
    s.headers.update(HEADERS)
    return s


def get_slug_list(session):
    """Return ordered list of unique Pokémon slugs across all three SV game pages."""
    seen   = set()
    slugs  = []
    for url in GAME_PAGES:
        print(f"  Fetching game index: {url}")
        try:
            r = session.get(url, timeout=30)
            r.raise_for_status()
        except Exception as e:
            print(f"    ERROR: {e}")
            continue
        soup = BeautifulSoup(r.text, "html.parser")
        for card in soup.select(".infocard"):
            a = card.select_one("a[href^='/pokedex/']")
            if not a:
                continue
            slug = a["href"].split("/")[-1]
            if slug and slug not in seen:
                seen.add(slug)
                slugs.append(slug)
        time.sleep(DELAY)
    return slugs


def parse_level_up(table):
    """Parse a level-up moves table → [{level: int, move_en: str}, ...]."""
    moves = []
    tbody = table.find("tbody")
    if not tbody:
        return moves
    for tr in tbody.find_all("tr"):
        cells = tr.find_all("td")
        if len(cells) < 2:
            continue
        lv_text  = cells[0].get_text(strip=True)
        move_raw = cells[1].get_text(strip=True)
        # Strip any footnote markers (e.g. "Growl†" → "Growl")
        move_name = re.sub(r"[†‡*]+$", "", move_raw).strip()
        try:
            level = int(lv_text)
        except ValueError:
            # "Evo." or similar non-numeric
            level = 0
        moves.append({"level": level, "move_en": move_name})
    return moves


def parse_tm(table):
    """Parse a TM moves table → [{"tm": "001", "move_en": "Take Down"}, ...]."""
    moves = []
    tbody = table.find("tbody")
    if not tbody:
        return moves
    for tr in tbody.find_all("tr"):
        cells = tr.find_all("td")
        if len(cells) < 2:
            continue
        tm_raw   = cells[0].get_text(strip=True)
        move_raw = cells[1].get_text(strip=True)
        move_name = re.sub(r"[†‡*]+$", "", move_raw).strip()
        # Pad TM number to 3 digits if it's numeric
        try:
            tm_num = str(int(tm_raw)).zfill(3)
        except ValueError:
            tm_num = tm_raw
        moves.append({"tm": tm_num, "move_en": move_name})
    return moves


def scrape_sv_moves(slug, session):
    """
    Fetch the individual Pokémon page and extract SV level-up + TM moves.
    Returns {"level_up_moves": [...], "tm_moves": [...]} or None on failure.
    """
    url = f"{BASE_URL}/pokedex/{slug}"
    try:
        r = session.get(url, timeout=30)
        r.raise_for_status()
    except Exception as e:
        print(f"    ERROR fetching {url}: {e}")
        return None

    soup = BeautifulSoup(r.text, "html.parser")

    # The moves section is a .tabset-moves-game wrapper
    ts = soup.select_one("[class*='tabset-moves-game']")
    if not ts:
        # No moves section at all
        return {"level_up_moves": [], "tm_moves": []}

    tab_list   = ts.select_one(".sv-tabs-tab-list")
    panel_list = ts.select_one(".sv-tabs-panel-list")
    if not tab_list or not panel_list:
        return {"level_up_moves": [], "tm_moves": []}

    # Find the "Scarlet/Violet" game tab
    tabs    = tab_list.find_all("a")
    sv_idx  = next(
        (i for i, a in enumerate(tabs) if "Scarlet/Violet" in a.get_text()),
        None,
    )
    if sv_idx is None:
        # Pokémon not in SV (shouldn't happen if slug came from SV game page)
        return {"level_up_moves": [], "tm_moves": []}

    sv_href  = tabs[sv_idx].get("href", "").lstrip("#")
    sv_panel = panel_list.find(id=sv_href)
    if not sv_panel:
        return {"level_up_moves": [], "tm_moves": []}

    # Within the SV panel, find sections by h3 heading
    result = {"level_up_moves": [], "tm_moves": []}

    for h3 in sv_panel.find_all("h3"):
        heading = h3.get_text(strip=True).lower()
        # Get the first <table> anywhere after this h3
        tbl = h3.find_next("table")
        if not tbl:
            continue
        if "level up" in heading:
            result["level_up_moves"] = parse_level_up(tbl)
        elif "tm" in heading or "technical machine" in heading:
            result["tm_moves"] = parse_tm(tbl)

    return result


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    # Fix stdout encoding for Windows
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    # Load existing output (allows resuming interrupted runs)
    if OUT_FILE.exists():
        with OUT_FILE.open(encoding="utf-8") as f:
            db = json.load(f)
        print(f"Resuming — already have {len(db)} entries.")
    else:
        db = {}

    session = make_session()

    print("Step 1: Collecting Pokémon slugs from SV game pages...")
    slugs = get_slug_list(session)
    print(f"  Total unique SV Pokémon: {len(slugs)}")

    todo = [s for s in slugs if s not in db]
    print(f"  Need to scrape: {len(todo)}")

    print("\nStep 2: Scraping individual pages...")
    for i, slug in enumerate(todo, 1):
        print(f"  [{i}/{len(todo)}] {slug}", end=" ")
        data = scrape_sv_moves(slug, session)
        if data is None:
            print("FAILED — skipping")
        else:
            lv_count = len(data["level_up_moves"])
            tm_count = len(data["tm_moves"])
            print(f"→ {lv_count} level-up, {tm_count} TM")
            db[slug] = data

        # Save after every 10 Pokémon so progress isn't lost
        if i % 10 == 0:
            with OUT_FILE.open("w", encoding="utf-8") as f:
                json.dump(db, f, ensure_ascii=False, indent=2)

        time.sleep(DELAY)

    # Final save
    with OUT_FILE.open("w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=2)

    print(f"\nDone! Saved {len(db)} entries to {OUT_FILE}")

    # Quick sanity check
    sample = next((v for v in db.values() if v["level_up_moves"]), None)
    if sample:
        print("\nSample level-up entry:", json.dumps(sample["level_up_moves"][:3], ensure_ascii=False))
    sample_tm = next((v for v in db.values() if v["tm_moves"]), None)
    if sample_tm:
        print("Sample TM entry:      ", json.dumps(sample_tm["tm_moves"][:3], ensure_ascii=False))


if __name__ == "__main__":
    main()
