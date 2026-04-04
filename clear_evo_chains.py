#!/usr/bin/env python3
"""Remove all evolution_chain keys from scvi_moves_db.json so build_scvi_evo.py re-scrapes them."""
import json
from pathlib import Path

DB = Path("data/scvi_moves_db.json")
with DB.open(encoding="utf-8") as f:
    db = json.load(f)

removed = sum(1 for v in db.values() if "evolution_chain" in v)
for v in db.values():
    v.pop("evolution_chain", None)

with DB.open("w", encoding="utf-8") as f:
    json.dump(db, f, ensure_ascii=False, indent=2)

print(f"Cleared evolution_chain from {removed} entries.")
