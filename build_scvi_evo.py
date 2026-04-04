#!/usr/bin/env python3
"""
Scrape evolution chains from pokemondb.net and add them to scvi_moves_db.json.

Run AFTER build_scvi_moves.py has completed.

Input:  data/scvi_moves_db.json   (existing move data)
        data/pokedex_scvi_db.json (ground truth for species/forms)
Output: data/scvi_moves_db.json   (same file, with "evolution_chain" added)

Evolution chain format per Pokémon:
  [
    {"name_en": "bulbasaur", "stage": 0, "method": null},
    {"name_en": "ivysaur",   "stage": 1, "method": "Lv. 16"},
    {"name_en": "venusaur",  "stage": 2, "method": "Lv. 32"}
  ]
  - stage 0 = base form (method is always null)
  - method   = what you do to reach THIS Pokémon from the previous stage
  - branching evolutions (Eevee) share the same stage number

Run:    python build_scvi_evo.py
Resume: safe to re-run — species already done are skipped.
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
SCVI_DB_FILE  = Path("data/pokedex_scvi_db.json")
MOVES_DB_FILE = Path("data/scvi_moves_db.json")
BASE_URL      = "https://pokemondb.net"
DELAY         = 1.0
HEADERS       = {
    "User-Agent": "Mozilla/5.0 (compatible; research-scraper/1.0; +personal-use)",
    "Accept-Language": "en-US,en;q=0.9",
}

# ── Slug helpers ──────────────────────────────────────────────────────────────
_SLUG_SUB = str.maketrans({
    "'": "", "\u2019": "", "é": "e", "♀": "-f", "♂": "-m",
    ".": "", ":": "", "!": "", "?": "",
})

def to_slug(name: str) -> str:
    return re.sub(r"\s+", "-", name.strip().lower().translate(_SLUG_SUB))


# ── Evolution chain parser ────────────────────────────────────────────────────

def parse_method(text: str) -> str:
    """Clean up an evolution method string from pokemondb."""
    t = text.strip()
    # "Level 16" → "Lv. 16"
    t = re.sub(r"(?i)^level\s+(\d+)$", r"Lv. \1", t)
    return t or None


def parse_evo_chain(soup) -> list:
    """
    Parse the evolution chain section from a pokemondb species page.
    Returns a flat list of dicts:
      [{"name_en": str, "stage": int, "method": str|None}, ...]

    Handles:
      • Linear chains   — Bulbasaur→Ivysaur→Venusaur
      • Branching       — Eevee→(8 evolutions)
      • Two-stage split — Ralts→Kirlia→(Gardevoir|Gallade)
      • No evolution    — Mewtwo
    """
    # pokemondb wraps the evo chart in a div just below the h2 "Evolution chart"
    evo_h2 = soup.find("h2", string=re.compile(r"Evolution chart", re.I))
    if not evo_h2:
        return []

    # The evo list immediately follows the h2 (sometimes inside a tab panel)
    evo_div = evo_h2.find_next("div", class_="infocard-list-evo")
    if not evo_div:
        return []

    chain = []
    _walk_evo_div(evo_div, stage=0, chain=chain, inherited_method=None)
    return chain


def _poke_name_from_card(card) -> str:
    """Extract the Pokémon English name from an infocard div."""
    # Name is in <a href="/pokedex/xxx"><b>Name</b></a> or just <b>
    a = card.find("a", href=re.compile(r"/pokedex/"))
    if a:
        return a.get_text(strip=True)
    b = card.find("b")
    if b:
        return b.get_text(strip=True)
    return card.get_text(strip=True)


def _method_between(node) -> str | None:
    """
    Given a node in the evo list, look at the PREVIOUS sibling small-text
    arrow to get the evolution method.
    pokemondb renders: [card] [span.infocard-arrow text "→ Lv. 16"] [card]
    The method is inside the span between two cards.
    """
    prev = node.find_previous_sibling()
    if prev is None:
        return None
    cls = prev.get("class") or []
    text = prev.get_text(" ", strip=True)
    # Strip leading arrow characters
    text = re.sub(r"^[→\->\s]+", "", text).strip()
    return parse_method(text) if text else None


def _walk_evo_div(div, stage: int, chain: list, inherited_method):
    """
    Recursively walk the infocard-list-evo div and its split children.
    """
    children = [c for c in div.children if hasattr(c, "name") and c.name]

    for child in children:
        cls = child.get("class") or []

        if "infocard" in cls and "infocard-evo-split" not in cls:
            # A single Pokémon card
            name = _poke_name_from_card(child)
            method = inherited_method if chain == [] else _method_between(child)
            chain.append({
                "name_en": name,
                "stage":   stage,
                "method":  method,
            })

        elif "infocard-evo-split" in cls:
            # Branching: each direct child branch is a mini-list
            for branch in child.find_all("div", recursive=False):
                # Each branch has: optional method text + one or more infocards
                branch_cards  = branch.find_all("div", class_="infocard")
                method_span   = branch.find(["span", "small"])
                raw_method    = method_span.get_text(strip=True) if method_span else ""
                raw_method    = re.sub(r"^[→\->\s]+", "", raw_method).strip()
                branch_method = parse_method(raw_method) if raw_method else None

                for card in branch_cards:
                    name = _poke_name_from_card(card)
                    chain.append({
                        "name_en": name,
                        "stage":   stage,
                        "method":  branch_method,
                    })
                    stage_inner = stage  # further evolutions from this branch
                    inner_split = card.find_next_sibling("div", class_="infocard-evo-split")
                    if inner_split:
                        _walk_evo_div(inner_split, stage_inner + 1, chain, None)


# ── Fetch + parse one species ─────────────────────────────────────────────────

def fetch_evo_chain(species_slug: str, session) -> list:
    url = f"{BASE_URL}/pokedex/{species_slug}"
    try:
        r = session.get(url, timeout=30)
        r.raise_for_status()
    except Exception as e:
        print(f"  ERROR {url}: {e}")
        return []
    soup = BeautifulSoup(r.text, "html.parser")
    chain = parse_evo_chain(soup)
    # Normalize names to slugs for consistent keying
    for entry in chain:
        entry["name_en"] = to_slug(entry["name_en"])
    return chain


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    sys.stdout = io.TextIOWrapper(
        sys.stdout.buffer, encoding="utf-8", errors="replace", line_buffering=True
    )

    for f in [SCVI_DB_FILE, MOVES_DB_FILE]:
        if not f.exists():
            print(f"ERROR: {f} not found.")
            sys.exit(1)

    with SCVI_DB_FILE.open(encoding="utf-8") as f:
        scvi_raw = json.load(f)
    scvi = {v["name_en"]: v for v in scvi_raw.values()}

    with MOVES_DB_FILE.open(encoding="utf-8") as f:
        db = json.load(f)

    # Group by species (one HTTP fetch per species page)
    by_species: dict[str, list] = defaultdict(list)
    for name_en, entry in scvi.items():
        species = entry.get("species_en_name") or name_en
        by_species[species].append(name_en)

    # Skip species where ALL forms already have evolution_chain
    todo = [
        sp for sp, names in by_species.items()
        if any("evolution_chain" not in db.get(n, {}) for n in names)
    ]
    print(f"SCVI db: {len(scvi)} entries | Species to process: {len(todo)}\n")

    session = requests.Session()
    session.headers.update(HEADERS)

    for idx, species in enumerate(todo, 1):
        print(f"[{idx}/{len(todo)}] {species}", end="  ")
        chain = fetch_evo_chain(species, session)

        names = by_species[species]
        for name_en in names:
            if name_en in db:
                db[name_en]["evolution_chain"] = chain

        stages = len(set(e["stage"] for e in chain)) if chain else 0
        members = [e["name_en"] for e in chain]
        print(f"{stages} stages: {members}")

        if idx % 10 == 0:
            with MOVES_DB_FILE.open("w", encoding="utf-8") as f:
                json.dump(db, f, ensure_ascii=False, indent=2)

    # Final save
    with MOVES_DB_FILE.open("w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=2)

    print(f"\nDone! Evolution chains added to {MOVES_DB_FILE}")


if __name__ == "__main__":
    main()
