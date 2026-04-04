#!/usr/bin/env python3
"""
Fetch Japanese names for moves missing from trilingual.json and add them.

Source: pokemondb.net/move/<slug>  (same domain we use for evo chains)
Adds all moves present in zh-Hant.json['moves'] but absent from trilingual.json.

Run: python patch_trilingual_gen9.py
Safe to re-run — already-added moves are skipped.
"""

import json, re, time, sys, io
from pathlib import Path
import requests
from bs4 import BeautifulSoup

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace", line_buffering=True)

TRILINGUAL_FILE = Path("data/trilingual.json")
ZH_HANT_FILE   = Path("data/zh-Hant.json")
BASE_URL       = "https://pokemondb.net/move"
DELAY          = 0.8
HEADERS        = {
    "User-Agent": "Mozilla/5.0 (compatible; research-scraper/1.0; +personal-use)",
    "Accept-Language": "en-US,en;q=0.9",
}

_SLUG_SUB = str.maketrans({
    "'": "", "\u2019": "", "é": "e", "♀": "-f", "♂": "-m",
    ".": "", ":": "", "!": "", "?": "", ",": "",
})

def to_slug(name: str) -> str:
    return re.sub(r"\s+", "-", name.strip().lower().translate(_SLUG_SUB))


def fetch_ja_name(slug: str, session) -> str | None:
    """Fetch the Japanese move name from pokemondb.net/move/<slug>."""
    url = f"{BASE_URL}/{slug}"
    try:
        r = session.get(url, timeout=20)
        r.raise_for_status()
    except Exception as e:
        print(f"  ERROR {url}: {e}")
        return None

    soup = BeautifulSoup(r.text, "html.parser")

    # pokemondb move pages have a table with "Japanese" as a row header
    # Look in the vitals-table or any table
    for table in soup.find_all("table"):
        for row in table.find_all("tr"):
            cells = row.find_all(["th", "td"])
            if len(cells) >= 2:
                header = cells[0].get_text(strip=True)
                if "japanese" in header.lower() or "日本語" in header:
                    # Value cell may have multiple spans (kana + kanji)
                    # We want the kana/romaji text — take all text
                    val = cells[1].get_text(" ", strip=True)
                    # Strip leading/trailing noise
                    val = val.strip()
                    if val:
                        return val

    # Fallback: look for a dedicated "other languages" section
    for h2 in soup.find_all(["h2", "h3"]):
        if "other language" in h2.get_text().lower():
            tbl = h2.find_next("table")
            if tbl:
                for row in tbl.find_all("tr"):
                    cells = row.find_all(["th", "td"])
                    if len(cells) >= 2:
                        header = cells[0].get_text(strip=True).lower()
                        if "japanese" in header:
                            return cells[1].get_text(" ", strip=True).strip()
    return None


def main():
    with TRILINGUAL_FILE.open(encoding="utf-8") as f:
        tri = json.load(f)
    with ZH_HANT_FILE.open(encoding="utf-8") as f:
        zhHant = json.load(f)

    zh_moves = zhHant["moves"]           # {en_name: zh_name}
    existing_en = {v["en"].lower() for v in tri["move"].values()}

    # Build list of missing moves
    missing = [
        (en, zh) for en, zh in zh_moves.items()
        if en.lower() not in existing_en
    ]
    print(f"Missing moves: {len(missing)}")

    # Find the highest existing numeric key to append after it
    max_key = max(int(k) for k in tri["move"].keys())

    session = requests.Session()
    session.headers.update(HEADERS)

    added = 0
    failed = []

    for idx, (en_name, zh_name) in enumerate(sorted(missing), 1):
        slug = to_slug(en_name)
        print(f"[{idx}/{len(missing)}] {en_name} ({slug}) ... ", end="", flush=True)

        ja = fetch_ja_name(slug, session)
        if ja:
            # Clean up: pokemondb often shows "Japanese kana (romaji)" — keep only kana/kanji
            # Strip parenthetical romaji if present
            ja = re.sub(r"\s*\(.*?\)\s*$", "", ja).strip()
            print(f"ja={ja}")
            max_key += 1
            tri["move"][str(max_key)] = {
                "en":     en_name,
                "ja":     ja,
                "ja_hrkt": "",
                "zh":     zh_name,
                "zh_src": "local",
            }
            added += 1
        else:
            print("FAILED — skipping")
            failed.append(en_name)

        time.sleep(DELAY)

    # Save
    with TRILINGUAL_FILE.open("w", encoding="utf-8") as f:
        json.dump(tri, f, ensure_ascii=False, indent=2)

    print(f"\nAdded {added} moves. Failed: {len(failed)}")
    if failed:
        print("Failed moves (need manual fix):")
        for m in failed:
            print(f"  {m}")


if __name__ == "__main__":
    main()
