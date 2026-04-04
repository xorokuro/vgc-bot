#!/usr/bin/env python3
"""
Manually add the 21 moves that patch_trilingual_gen9.py failed to scrape.
Japanese names sourced from game data / Bulbapedia.

Run: python patch_trilingual_manual.py
"""
import json, sys, io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace", line_buffering=True)

TRILINGUAL_FILE = Path("data/trilingual.json")

# {en_name: (ja_name, zh_name)}
MANUAL_MOVES = {
    "Alluring Voice":  ("みわくのこえ",      "魅誘之聲"),
    "Attack Cheer":    ("おうえん（こうげき）", "衝衝猛攻"),
    "Blood Moon":      ("ブラッドムーン",      "血月"),
    "Burning Bulwark": ("ほのおのまもり",      "火焰守護"),
    "Defense Cheer":   ("おうえん（ぼうぎょ）", "堅堅固守"),
    "Electro Shot":    ("でんじきゅうでん",    "電光束"),
    "Fickle Beam":     ("きまぐれビーム",      "隨機光"),
    "Hard Press":      ("ハードプレス",        "硬壓"),
    "Heal Cheer":      ("おうえん（かいふく）", "啦啦療癒"),
    "Ivy Cudgel":      ("ツタこんぼう",        "棘藤棒"),
    "Malignant Chain": ("もうどくのくさり",    "邪毒鎖鏈"),
    "Matcha Gotcha":   ("まっちゃほうしゃ",    "刷刷茶炮"),
    "Mighty Cleave":   ("きょりょくぎり",      "強刃攻擊"),
    "Nihil Light":     ("きょむのひかり",      "歸無之光"),
    "Psychic Noise":   ("サイコノイズ",        "精神噪音"),
    "Supercell Slam":  ("らいでんたいあたり",  "閃電強襲"),
    "Syrup Bomb":      ("シロップばくだん",    "糖漿炸彈"),
    "Tachyon Cutter":  ("タキオンカッター",    "迅子利刃"),
    "Temper Flare":    ("やけくそ",            "豁出去"),
    "Thunderclap":     ("じんらい",            "迅雷"),
    "Upper Hand":      ("せんせいパンチ",      "快手還擊"),
}

with TRILINGUAL_FILE.open(encoding="utf-8") as f:
    tri = json.load(f)

existing_en = {v["en"].lower() for v in tri["move"].values()}
max_key = max(int(k) for k in tri["move"].keys())

added = 0
skipped = 0
for en_name, (ja, zh) in MANUAL_MOVES.items():
    if en_name.lower() in existing_en:
        print(f"  SKIP (already exists): {en_name}")
        skipped += 1
        continue
    max_key += 1
    tri["move"][str(max_key)] = {
        "en":      en_name,
        "ja":      ja,
        "ja_hrkt": "",
        "zh":      zh,
        "zh_src":  "local",
    }
    print(f"  Added: {en_name} → {ja} / {zh}")
    added += 1

with TRILINGUAL_FILE.open("w", encoding="utf-8") as f:
    json.dump(tri, f, ensure_ascii=False, indent=2)

print(f"\nDone. Added: {added}, Skipped: {skipped}")
