#!/usr/bin/env python3
"""
Authoritative patch for all 100 Gen 8/9 moves missing from trilingual.json.
Upserts: corrects already-added entries + adds new ones.
Nihil Light is skipped (no official data).

Run: python patch_trilingual_final.py
"""
import json, sys, io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace", line_buffering=True)

TRILINGUAL_FILE = Path("data/trilingual.json")

# Authoritative data: (en, ja, zh)
MOVES = [
    ("Alluring Voice",       "みわくのこえ",              "魅惑之聲"),
    ("Aqua Cutter",          "アクアカッター",             "水波刀"),
    ("Aqua Step",            "アクアステップ",             "流水旋舞"),
    ("Armor Cannon",         "アーマーキャノン",           "鎧農炮"),
    ("Attack Cheer",         "いけいけドンドン",           "衝衝猛攻"),
    ("Axe Kick",             "かかとおとし",               "腳跟落"),
    ("Barb Barrage",         "どくばりセンボン",           "毒千針"),
    ("Bitter Blade",         "むねんのつるぎ",             "悔念劍"),
    ("Bitter Malice",        "うらみつらみ",               "冤冤相報"),
    ("Blazing Torque",       "バーンアクセル",             "灼熱暴衝"),
    ("Bleakwind Storm",      "こがらしあらし",             "枯葉風暴"),
    ("Blood Moon",           "ブラッドムーン",             "血月"),
    ("Burning Bulwark",      "かえんのまもり",             "火焰守護"),
    ("Ceaseless Edge",       "ひけん・ちえなみ",           "秘劍・千重濤"),
    ("Chilling Water",       "ひやみず",                   "潑冷水"),
    ("Chilly Reception",     "さむいギャグ",               "冷笑話"),
    ("Chloroblast",          "クロロブラスト",             "葉綠爆震"),
    ("Collision Course",     "アクセルブレイク",           "全開猛撞"),
    ("Combat Torque",        "ファイトアクセル",           "格鬥暴衝"),
    ("Comeuppance",          "ほうふく",                   "報復"),
    ("Defense Cheer",        "がっちりぼうぎょ",           "堅堅固守"),
    ("Dire Claw",            "フェイタルクロー",           "致命爪"),
    ("Doodle",               "うつしえ",                   "描繪"),
    ("Double Shock",         "でんこうそうげき",           "電光雙擊"),
    ("Electro Drift",        "イナズマドライブ",           "閃電猛衝"),
    ("Electro Shot",         "エレクトロビーム",           "電光彈"),
    ("Esper Wing",           "オーラウイング",             "氣場之翼"),
    ("Fickle Beam",          "きまぐれレーザー",           "隨機光"),
    ("Fillet Away",          "みをけずる",                 "削肉"),
    ("Flower Trick",         "トリックフラワー",           "千變萬花"),
    ("Forest's Curse",       "もりののろい",               "森林詛咒"),
    ("Gigaton Hammer",       "デカハンマー",               "巨力鎚"),
    ("Glaive Rush",          "きょけんとつげき",           "巨劍突擊"),
    ("Hard Press",           "ハードプレス",               "硬壓"),
    ("Headlong Rush",        "ぶちかまし",                 "突飛猛撲"),
    ("Heal Cheer",           "いやしのエール",             "啦啦療癒"),
    ("Hydro Steam",          "ハイドロスチーム",           "水蒸氣"),
    ("Hyper Drill",          "ハイパードリル",             "強力鑽"),
    ("Ice Spinner",          "アイススピナー",             "冰旋"),
    ("Infernal Parade",      "ひゃっきやこう",             "百鬼夜行"),
    ("Ivy Cudgel",           "ツタこんぼう",               "棘藤棒"),
    ("Jet Punch",            "ジェットパンチ",             "噴射拳"),
    ("King's Shield",        "キングシールド",             "王者盾牌"),
    ("Kowtow Cleave",        "ドゲザン",                   "仆斬"),
    ("Land's Wrath",         "グランドフォース",           "大地神力"),
    ("Last Respects",        "おはかまいり",               "掃墓"),
    ("Let's Snuggle Forever","ぽかぼかフレンドタイム",     "親密無間大亂揍"),
    ("Lumina Crash",         "ルミナコリジョン",           "琉光衝激"),
    ("Lunar Blessing",       "みかづきのいのり",           "新月祈禱"),
    ("Magical Torque",       "マジカルアクセル",           "魔法暴衝"),
    ("Make It Rain",         "ゴールドラッシュ",           "淘金潮"),
    ("Malignant Chain",      "じゃどくのくさり",           "邪毒鎖鏈"),
    ("Matcha Gotcha",        "シャカシャカほう",           "刷刷茶砲"),
    ("Mighty Cleave",        "パワフルエッジ",             "迅猛劈開"),
    ("Mortal Spin",          "キラースピン",               "晶光轉轉"),
    ("Mountain Gale",        "ひょうざんおろし",           "冰山風"),
    ("Mystical Power",       "しんぴのちから",             "神秘之力"),
    ("Nature's Madness",     "しぜんのいかり",             "自然之怒"),
    # Nihil Light skipped — no official data
    ("Noxious Torque",       "ポイズンアクセル",           "劇毒暴衝"),
    ("Order Up",             "いっちょうあがり",           "上菜"),
    ("Population Bomb",      "ネズミざん",                 "鼠數兒"),
    ("Pounce",               "とびつく",                   "猛撲"),
    ("Power Shift",          "パワーシフト",               "力量轉換"),
    ("Psyblade",             "サイコブレイド",             "精神劍"),
    ("Psychic Noise",        "サイコノイズ",               "精神噪音"),
    ("Psyshield Bash",       "バリアーラッシュ",           "屏障猛攻"),
    ("Rage Fist",            "ふんどのこぶし",             "憤怒之拳"),
    ("Raging Bull",          "レイジングブル",             "怒牛"),
    ("Raging Fury",          "だいふんがい",               "大憤慨"),
    ("Revival Blessing",     "さいきのいのり",             "復生祈禱"),
    ("Ruination",            "カタストロフィ",             "大災難"),
    ("Salt Cure",            "しおづけ",                   "鹽醃"),
    ("Sandsear Storm",       "ねっさのあらし",             "熱沙風暴"),
    ("Shed Tail",            "しっぽきり",                 "斷尾"),
    ("Shelter",              "たてこもる",                 "閉關"),
    ("Silk Trap",            "スレッドトラップ",           "絲網陷阱"),
    ("Snowscape",            "ゆきげしき",                 "雪景"),
    ("Spicy Extract",        "ハバネロエキス",             "辣椒精華"),
    ("Spin Out",             "ホイールスピン",             "疾速轉輪"),
    ("Springtide Storm",     "はるのあらし",               "陽春風暴"),
    ("Stone Axe",            "がんせきアックス",           "岩石斧"),
    ("Supercell Slam",       "サンダーダイブ",             "雷霆突擊"),
    ("Syrup Bomb",           "みずあめだま",               "糖漿炸彈"),
    ("Tachyon Cutter",       "タキオンカッター",           "迅子利刃"),
    ("Take Heart",           "ブレイブチャージ",           "勇氣填充"),
    ("Temper Flare",         "やけっぱち",                 "豁出去"),
    ("Tera Blast",           "テラバースト",               "太晶爆發"),
    ("Thunderclap",          "じんらい",                   "迅雷"),
    ("Tidy Up",              "おかたづけ",                 "大掃除"),
    ("Torch Song",           "フレアソング",               "閃焰高歌"),
    ("Trailblaze",           "くさわけ",                   "起草"),
    ("Triple Arrows",        "さんぼんのや",               "三重箭"),
    ("Triple Dive",          "トリプルダイブ",             "三重潛水"),
    ("Twin Beam",            "ツインビーム",               "雙光束"),
    ("Upper Hand",           "はやてがえし",               "猛然天降"),
    ("Victory Dance",        "しょうりのまい",             "勝利之舞"),
    ("Wave Crash",           "ウェーブタックル",           "波動衝"),
    ("Wicked Torque",        "ダークアクセル",             "黑暗暴衝"),
    ("Wildbolt Storm",       "かみなりあらし",             "鳴雷風暴"),
    # Dragon Cheer already in trilingual but ensure correct
    ("Dragon Cheer",         "ドラゴンエール",             "龍聲鼓舞"),
]

with TRILINGUAL_FILE.open(encoding="utf-8") as f:
    tri = json.load(f)

# Build reverse map: en_lower → key
en_to_key = {v["en"].lower(): k for k, v in tri["move"].items()}
max_key = max(int(k) for k in tri["move"].keys())

updated = 0
added = 0

for en, ja, zh in MOVES:
    key = en_to_key.get(en.lower())
    if key:
        entry = tri["move"][key]
        changed = entry.get("ja") != ja or entry.get("zh") != zh
        entry["en"]      = en
        entry["ja"]      = ja
        entry["ja_hrkt"] = ""
        entry["zh"]      = zh
        entry["zh_src"]  = "local"
        if changed:
            print(f"  UPDATED: {en}")
            updated += 1
    else:
        max_key += 1
        new_key = str(max_key)
        tri["move"][new_key] = {"en": en, "ja": ja, "ja_hrkt": "", "zh": zh, "zh_src": "local"}
        en_to_key[en.lower()] = new_key
        print(f"  ADDED:   {en}")
        added += 1

with TRILINGUAL_FILE.open("w", encoding="utf-8") as f:
    json.dump(tri, f, ensure_ascii=False, indent=2)

print(f"\nDone. Updated: {updated}, Added: {added}")
