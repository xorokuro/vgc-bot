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
    # Normalize whitespace first (handles newlines inside <small> tags that
    # get_text() would otherwise concatenate without spaces)
    t = " ".join(text.split()).strip("()")
    # "Level 16" → "Lv. 16"
    t = re.sub(r"(?i)^level\s+(\d+)$", r"Lv. \1", t)
    return t or None


def _poke_name_from_card(card) -> str:
    """Extract the Pokémon English name from a div.infocard."""
    # pokemondb puts the name in <a class="ent-name" href="/pokedex/xxx">Name</a>
    a = card.find("a", class_="ent-name")
    if a:
        return a.get_text(strip=True)
    return ""


def parse_evo_chain(soup) -> list:
    """
    Parse the evolution chain section from a pokemondb species page.
    Returns a flat list of dicts:
      [{"name_en": str, "stage": int, "method": str|None}, ...]

    pokemondb HTML structure (confirmed):
      div.infocard-list-evo
        div.infocard          ← Pokémon card (name in <a class="ent-name">)
        span.infocard.infocard-arrow  ← arrow with method in <small>(Level 16)</small>
        div.infocard          ← next Pokémon
        ...
      Branching uses div.infocard-evo-split containing multiple branch divs.

    Handles:
      • Linear chains   — Bulbasaur→Ivysaur→Venusaur
      • Branching       — Eevee→(8 evolutions)
      • Two-stage split — Ralts→Kirlia→(Gardevoir|Gallade)
      • No evolution    — Mewtwo (returns empty list)
    """
    evo_h2 = soup.find("h2", string=re.compile(r"Evolution chart", re.I))
    if not evo_h2:
        return []

    evo_div = evo_h2.find_next("div", class_="infocard-list-evo")
    if not evo_div:
        return []

    chain = []
    _walk_evo_div(evo_div, stage=0, chain=chain, pending_method=None)
    return chain


def _walk_evo_div(div, stage: int, chain: list, pending_method):
    """
    Walk direct children of an infocard-list-evo (or branch) div.

    Children come in three flavours:
      div.infocard              → a Pokémon; consume pending_method
      span.infocard-arrow       → an arrow; read its <small> text as next method, bump stage
      div.infocard-evo-split    → branching node; recurse into each branch at current stage
    """
    children = [c for c in div.children if getattr(c, "name", None)]

    current_method = pending_method
    current_stage  = stage

    for child in children:
        cls = child.get("class") or []

        if child.name == "div" and "infocard" in cls and "infocard-evo-split" not in cls:
            # ── Pokémon card ──────────────────────────────────────────────────
            name = _poke_name_from_card(child)
            chain.append({
                "name_en": name,
                "stage":   current_stage,
                "method":  current_method,
            })
            current_method = None  # consumed

        elif child.name == "span" and "infocard-arrow" in cls:
            # ── Arrow between stages ──────────────────────────────────────────
            small = child.find("small")
            raw   = small.get_text(separator=" ", strip=True) if small else child.get_text(separator=" ", strip=True)
            current_method = parse_method(raw)
            current_stage  = current_stage + 1

        elif "infocard-evo-split" in cls:
            # ── Branching node ────────────────────────────────────────────────
            # Each direct-child div is one branch.
            # The first card in each branch is always one stage beyond the parent.
            # If a branch has multiple cards (e.g. Dipplin→Hydrapple), subsequent
            # arrows within the branch advance the stage further.
            for branch in child.find_all("div", recursive=False):
                branch_method = current_method
                branch_stage  = current_stage + 1   # ← fixed: always +1 from parent
                cards_added   = 0
                branch_children = [c for c in branch.children if getattr(c, "name", None)]

                for bc in branch_children:
                    bc_cls = bc.get("class") or []

                    if bc.name == "span" and "infocard-arrow" in bc_cls:
                        small = bc.find("small")
                        raw   = small.get_text(separator=" ", strip=True) if small else bc.get_text(separator=" ", strip=True)
                        branch_method = parse_method(raw)
                        if cards_added > 0:
                            # Arrow after a card = going to the next stage
                            branch_stage += 1

                    elif bc.name == "div" and "infocard" in bc_cls and "infocard-evo-split" not in bc_cls:
                        name = _poke_name_from_card(bc)
                        chain.append({
                            "name_en": name,
                            "stage":   branch_stage,
                            "method":  branch_method,
                        })
                        branch_method = None
                        cards_added  += 1

                    elif "infocard-evo-split" in bc_cls:
                        # Nested split (e.g. Kirlia → Gardevoir|Gallade)
                        _walk_evo_div(bc, branch_stage, chain, None)

            current_method = None  # consumed by the split


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
