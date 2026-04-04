#!/usr/bin/env python3
"""
One-off patch: add form-exclusive evolution moves to scvi_moves_db.json.

Rotom: each form learns a unique move when it changes form (level=0).
Necrozma: Dusk Mane learns Sunsteel Strike, Dawn Wings learns Moongeist Beam.

Run: python patch_rotom_moves.py
"""
import json
from pathlib import Path

DB = Path("data/scvi_moves_db.json")

# Form-exclusive moves (English move names from pokemondb), stored as level=0
FORM_MOVES = {
    # Rotom forms
    "rotom":            "Thunder Shock",
    "rotom-heat":       "Overheat",
    "rotom-wash":       "Hydro Pump",
    "rotom-frost":      "Blizzard",
    "rotom-fan":        "Air Slash",
    "rotom-mow":        "Leaf Storm",
    # Necrozma fused forms
    "necrozma-dusk":    "Sunsteel Strike",
    "necrozma-dawn":    "Moongeist Beam",
}

with DB.open(encoding="utf-8") as f:
    db = json.load(f)

for form, move_en in FORM_MOVES.items():
    if form not in db:
        print(f"  SKIP {form}: not in db")
        continue

    entry = db[form]

    # Add to evolution_moves if not already there
    if move_en not in entry["evolution_moves"]:
        entry["evolution_moves"].append(move_en)

    # Add to level_up_moves (level=0) if not already there
    already = any(m["move_en"] == move_en and m["level"] == 0
                  for m in entry["level_up_moves"])
    if not already:
        entry["level_up_moves"].insert(0, {"level": 0, "move_en": move_en})
        print(f"  Added {move_en} to {form}")
    else:
        print(f"  {form}: {move_en} already present")

with DB.open("w", encoding="utf-8") as f:
    json.dump(db, f, ensure_ascii=False, indent=2)

print("Done.")
