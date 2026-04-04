'use strict';

const path = require('path');

// Lazily built name-translation maps
// Each map: lowercase_english_name → { ja, zh }
let _maps = null;

// ── KO text translation ────────────────────────────────────────────────────────

const NHKO_JA = { 1: '一撃', 2: '二撃', 3: '三撃', 4: '四撃', 5: '五撃', 6: '六撃', 7: '七撃', 8: '八撃' };
const NHKO_ZH = { 1: '一擊擊倒', 2: '兩擊擊倒', 3: '三擊擊倒', 4: '四擊擊倒', 5: '五擊擊倒', 6: '六擊擊倒', 7: '七擊擊倒', 8: '八擊擊倒' };

/**
 * Translate the KO chance text produced by @smogon/calc (always English).
 * Handles: "guaranteed NHKO", "X% chance to NHKO", and "possible NHKO" patterns.
 * Falls back to English for anything else.
 * @param {string} text
 * @param {'en'|'ja'|'zh'} lang
 */
function translateKOText(text, lang) {
  if (!text || lang === 'en') return text;

  // Terrain names that can appear in "after X recovery" (Grassy Terrain healing)
  const TERRAIN_RECOVERY_KEY = {
    'Grassy Terrain':   'tGrassy',
    'Electric Terrain': 'tElectric',
    'Psychic Terrain':  'tPsychic',
    'Misty Terrain':    'tMisty',
  };

  // Weather names that appear in "after X damage" (sandstorm/hail chip damage)
  const WEATHER_DAMAGE_KEY = {
    'sandstorm': 'wSand',
    'hail':      'wSnow',
    'snow':      'wSnow',
  };

  // Strip "after X recovery" OR "after X damage" suffix
  let recoverySuffix = '';
  const suffixM = text.match(/^(.*?) after (.+?) (recovery|damage)$/i);
  let baseText = text;
  if (suffixM) {
    baseText          = suffixM[1];
    const rawSuffix   = suffixM[2];
    const suffixType  = suffixM[3].toLowerCase(); // 'recovery' or 'damage'
    const terrainKey  = TERRAIN_RECOVERY_KEY[rawSuffix];
    const weatherKey  = WEATHER_DAMAGE_KEY[rawSuffix.toLowerCase()];
    const suffixTr    = terrainKey  ? ui(terrainKey, lang)
                      : weatherKey  ? ui(weatherKey, lang)
                      : translate(rawSuffix, 'item', lang);
    if (suffixType === 'recovery') {
      if (lang === 'ja') recoverySuffix = `（${suffixTr}回復後）`;
      if (lang === 'zh') recoverySuffix = `（${suffixTr}回復後）`;
    } else {
      if (lang === 'ja') recoverySuffix = `（${suffixTr}ダメージ後）`;
      if (lang === 'zh') recoverySuffix = `（${suffixTr}傷害後）`;
    }
  }

  // Normalise "OHKO" → "1HKO" so both patterns share one regex
  const t = baseText.replace(/OHKO/gi, '1HKO');

  // "guaranteed NHKO"
  const gm = t.match(/^guaranteed (\d+)HKO$/i);
  if (gm) {
    const n = parseInt(gm[1]);
    if (lang === 'ja') return `確定${NHKO_JA[n] ?? n + '撃'}` + recoverySuffix;
    if (lang === 'zh') return `確定${NHKO_ZH[n] ?? n + '擊擊倒'}` + recoverySuffix;
  }

  // "X% chance to NHKO"
  const cm = t.match(/^([\d.]+)% chance to (\d+)HKO$/i);
  if (cm) {
    const pct = cm[1], n = parseInt(cm[2]);
    if (lang === 'ja') return `${pct}%で${NHKO_JA[n] ?? n + '撃'}圏内` + recoverySuffix;
    if (lang === 'zh') return `${pct}%的機率${NHKO_ZH[n] ?? n + '擊擊倒'}` + recoverySuffix;
  }

  // "possible NHKO" (low-probability KO, no percentage given)
  const pm = t.match(/^possible (\d+)HKO$/i);
  if (pm) {
    const n = parseInt(pm[1]);
    if (lang === 'ja') return `${NHKO_JA[n] ?? n + '撃'}の可能性あり` + recoverySuffix;
    if (lang === 'zh') return `有機會${NHKO_ZH[n] ?? n + '擊擊倒'}` + recoverySuffix;
  }

  return text;
}

// ── Static UI string translations ─────────────────────────────────────────────

const UI = {
  en: {
    attacker:       'Attacker',
    defender:       'Defender',
    fieldConds:     'Field Conditions',
    doubles:        'Doubles',
    singles:        'Singles',
    critHit:        'Critical Hit',
    helpingHand:    'Helping Hand',
    tailwindAtk:    'Tailwind (Atk)',
    tailwindDef:    'Tailwind (Def)',
    fairyAura:      'Fairy Aura',
    darkAura:       'Dark Aura',
    beadsOfRuin:    'Beads of Ruin',
    swordOfRuin:    'Sword of Ruin',
    tabletsOfRuin:  'Tablets of Ruin',
    vesselOfRuin:   'Vessel of Ruin',
    reflect:        'Reflect',
    lightScreen:    'Light Screen',
    auroraVeil:     'Aurora Veil',
    friendGuard:    'Friend Guard',
    wonderRoom:     'Wonder Room',
    magicRoom:      'Magic Room',
    wSun:           'Sun',
    wRain:          'Rain',
    wSand:          'Sand',
    wSnow:          'Snow',
    wHarsh:         'Harsh Sunshine',
    wHeavy:         'Heavy Rain',
    wStrong:        'Strong Winds',
    tElectric:      'Electric Terrain',
    tGrassy:        'Grassy Terrain',
    tMisty:         'Misty Terrain',
    tPsychic:       'Psychic Terrain',
    nature:         'Nature',
    ability:        'Ability',
    item:           'Item',
    teraType:       'Tera Type',
    boosts:         'Boosts',
    evs:            'EV',
    ivs:            'IV',
    ivsValue:       '31 all',
    outOf:          'out of {hp} HP',
    hp:             'HP',
    status:         'Status',
    damageRoll:     'Damage Roll',
    yourChallenge:  'Your Challenge',
    challengeDesc:  'Defender has **{hp} HP** — guess a number within the damage range! Any value that falls between the min and max roll counts as correct.',
    noKO:           '*(does not guarantee a KO)*',
    randomScenario: 'Random scenario',
    lv50:           'Lv.50',
    allIVs:         'All IVs: 31',
    gen9:           'Gen 9',
    baseStats:      'Base Stats & Move',
    makeGuess:      'Make a Guess',
    seeAnswer:      'See Answer',
    reroll:         'Reroll',
    statsTitle:     'Base Stats & Move Info',
    statsNotFound:  'stats not found',
    bpVariable:     'Variable',
    hitsLabel:      'hits',
    alwaysCrits:    'Always crits',
    typeLabel:      'Type',
    categoryLabel:  'Category',
    bpLabel:        'BP',
    vs:             'vs.',
    timeUp:         "⏰ **Time's up!** Nobody guessed in time.\nThe answer was **{min}–{max} HP** ({minPct}%–{maxPct}% of {hp} HP).{desc}",
    revealed:       '🔍 {user} revealed the answer!\nThe damage was **{min}–{max} HP** ({minPct}%–{maxPct}% of {hp} HP).{desc}',
    correct:        '✅ {user} got it in **{elapsed}s**! `{guess}` is correct.\nAnswer: **{min}–{max} HP** ({minPct}%–{maxPct}% of {hp} HP).{desc}',
    wrong:          '❌ {user} guessed `{guess}` — wrong!',
    roundEnded:     '⏰ This round has already ended.',
    notANumber:     '❌ `{val}` is not a valid number.',
    errorCalc:      '❌ **Calculation failed.**',
    errorRandom:    '❌ Could not generate a valid random scenario after 15 attempts. Please try again!',
    errorMeta:      '❌ Could not generate a valid meta scenario after 15 attempts. Please try again!',
    errorGuess:     '❌ Could not generate a valid scenario. Please try again!',
  },
  ja: {
    attacker:       '攻撃側',
    defender:       '防御側',
    fieldConds:     'フィールド状態',
    doubles:        'ダブル',
    singles:        'シングル',
    critHit:        '急所',
    helpingHand:    'てだすけ',
    tailwindAtk:    'おいかぜ（攻）',
    tailwindDef:    'おいかぜ（守）',
    fairyAura:      'フェアリーオーラ',
    darkAura:       'ダークオーラ',
    beadsOfRuin:    'わざわいのたま',
    swordOfRuin:    'わざわいのつるぎ',
    tabletsOfRuin:  'わざわいのおふだ',
    vesselOfRuin:   'わざわいのうつわ',
    reflect:        'リフレクター',
    lightScreen:    'ひかりのかべ',
    auroraVeil:     'オーロラベール',
    friendGuard:    'フレンドガード',
    wonderRoom:     'ワンダールーム',
    magicRoom:      'マジックルーム',
    wSun:           'にほんばれ',
    wRain:          'あめ',
    wSand:          'すなあらし',
    wSnow:          'ゆき',
    wHarsh:         'ひでり',
    wHeavy:         'おおあめ',
    wStrong:        'らんきりゅう',
    tElectric:      'エレキフィールド',
    tGrassy:        'グラスフィールド',
    tMisty:         'ミストフィールド',
    tPsychic:       'サイコフィールド',
    nature:         'せいかく',
    ability:        'とくせい',
    item:           'もちもの',
    teraType:       'テラスタイプ',
    boosts:         'ランク変化',
    evs:            'EV',
    ivs:            'IV',
    ivsValue:       '全31',
    outOf:          '{hp} HP 中',
    hp:             'HP',
    status:         '状態異常',
    damageRoll:     'ダメージロール',
    yourChallenge:  'チャレンジ',
    challengeDesc:  '防御側のHPは **{hp}** — ダメージ範囲内の数字を当ててください！最小値と最大値の間なら正解です。',
    noKO:           '*(確定数に届かない)*',
    randomScenario: 'ランダムシナリオ',
    lv50:           'Lv.50',
    allIVs:         '個体値: 全31',
    gen9:           'Gen 9',
    baseStats:      '種族値・技',
    makeGuess:      '当てる',
    seeAnswer:      '答えを見る',
    reroll:         '再抽選',
    statsTitle:     '種族値・技データ',
    statsNotFound:  'データなし',
    bpVariable:     '可変',
    hitsLabel:      '回',
    alwaysCrits:    '必ず急所',
    typeLabel:      'タイプ',
    categoryLabel:  '分類',
    bpLabel:        '威力',
    vs:             'vs.',
    timeUp:         '⏰ **時間切れ！** 誰も当てられませんでした。\n答えは **{min}～{max} HP** ({minPct}%～{maxPct}% / {hp} HP){desc}',
    revealed:       '🔍 {user} が答えを公開しました！\nダメージは **{min}～{max} HP** ({minPct}%～{maxPct}% / {hp} HP){desc}',
    correct:        '✅ {user} が **{elapsed}秒** で正解！ `{guess}` は正解です。\n答え: **{min}～{max} HP** ({minPct}%～{maxPct}% / {hp} HP){desc}',
    wrong:          '❌ {user} が `{guess}` と回答しました — 不正解！',
    roundEnded:     '⏰ このラウンドはすでに終了しています。',
    notANumber:     '❌ `{val}` は有効な数字ではありません。',
    errorCalc:      '❌ **計算に失敗しました。**',
    errorRandom:    '❌ 有効なランダムシナリオを15回試みても生成できませんでした。もう一度お試しください！',
    errorMeta:      '❌ 有効なメタシナリオを15回試みても生成できませんでした。もう一度お試しください！',
    errorGuess:     '❌ 有効なシナリオを生成できませんでした。もう一度お試しください！',
  },
  zh: {
    attacker:       '攻擊方',
    defender:       '防禦方',
    fieldConds:     '場地狀態',
    doubles:        '雙打',
    singles:        '單打',
    critHit:        '擊中要害',
    helpingHand:    '幫助',
    tailwindAtk:    '順風（攻）',
    tailwindDef:    '順風（守）',
    fairyAura:      '妖精氣場',
    darkAura:       '暗黑氣場',
    beadsOfRuin:    '災禍之玉',
    swordOfRuin:    '災禍之劍',
    tabletsOfRuin:  '災禍之簡',
    vesselOfRuin:   '災禍之鼎',
    reflect:        '反射壁',
    lightScreen:    '光牆',
    auroraVeil:     '極光帷幕',
    friendGuard:    '友情防守',
    wonderRoom:     '奇妙空間',
    magicRoom:      '魔法空間',
    wSun:           '大晴天',
    wRain:          '雨天',
    wSand:          '沙暴',
    wSnow:          '下雪',
    wHarsh:         '烈日',
    wHeavy:         '大雨',
    wStrong:        '亂流',
    tElectric:      '電氣場地',
    tGrassy:        '青草場地',
    tMisty:         '薄霧場地',
    tPsychic:       '精神場地',
    nature:         '性格',
    ability:        '特性',
    item:           '道具',
    teraType:       '太晶屬性',
    boosts:         '能力等級',
    evs:            'EV',
    ivs:            'IV',
    ivsValue:       '全31',
    outOf:          '共 {hp} HP',
    hp:             'HP',
    status:         '狀態異常',
    damageRoll:     '傷害值',
    yourChallenge:  '你的挑戰',
    challengeDesc:  '防禦方的HP為 **{hp}** — 請猜測一個在傷害範圍內的數字！最小值和最大值之間的任何數字均算正確。',
    noKO:           '未能確定擊倒',
    randomScenario: '設定',
    lv50:           'Lv.50',
    allIVs:         '個體值: 全31',
    gen9:           'Gen 9',
    baseStats:      '種族值・招式',
    makeGuess:      '猜測',
    seeAnswer:      '查看答案',
    reroll:         '重新生成',
    statsTitle:     '種族值・招式資料',
    statsNotFound:  '找不到資料',
    bpVariable:     '可變',
    hitsLabel:      '下',
    alwaysCrits:    '必中要害',
    typeLabel:      '屬性',
    categoryLabel:  '分類',
    bpLabel:        '威力',
    vs:             'vs.',
    timeUp:         '⏰ **時間到！** 沒有人猜對。\n答案是 **{min}～{max} HP** ({minPct}%～{maxPct}% / {hp} HP){desc}',
    revealed:       '🔍 {user} 揭曉了答案！\n傷害為 **{min}～{max} HP** ({minPct}%～{maxPct}% / {hp} HP){desc}',
    correct:        '✅ {user} 在 **{elapsed}秒** 內答對了！`{guess}` 是正確的。\n答案: **{min}～{max} HP** ({minPct}%～{maxPct}% / {hp} HP){desc}',
    wrong:          '❌ {user} 猜測了 `{guess}` — 錯誤！',
    roundEnded:     '⏰ 這一輪已經結束了。',
    notANumber:     '❌ `{val}` 不是有效的數字。',
    errorCalc:      '❌ **計算失敗。**',
    errorRandom:    '❌ 嘗試15次後仍無法生成有效的隨機場景。請再試一次！',
    errorMeta:      '❌ 嘗試15次後仍無法生成有效的對戰場景。請再試一次！',
    errorGuess:     '❌ 無法生成有效的場景。請再試一次！',
  },
};

// ── Type name translations ────────────────────────────────────────────────────

const TYPE_NAMES = {
  en: {
    Normal: 'Normal', Fire: 'Fire', Water: 'Water', Electric: 'Electric',
    Grass: 'Grass', Ice: 'Ice', Fighting: 'Fighting', Poison: 'Poison',
    Ground: 'Ground', Flying: 'Flying', Psychic: 'Psychic', Bug: 'Bug',
    Rock: 'Rock', Ghost: 'Ghost', Dragon: 'Dragon', Dark: 'Dark',
    Steel: 'Steel', Fairy: 'Fairy', Stellar: 'Stellar',
  },
  ja: {
    Normal: 'ノーマル', Fire: 'ほのお', Water: 'みず', Electric: 'でんき',
    Grass: 'くさ', Ice: 'こおり', Fighting: 'かくとう', Poison: 'どく',
    Ground: 'じめん', Flying: 'ひこう', Psychic: 'エスパー', Bug: 'むし',
    Rock: 'いわ', Ghost: 'ゴースト', Dragon: 'ドラゴン', Dark: 'あく',
    Steel: 'はがね', Fairy: 'フェアリー', Stellar: 'ステラ',
  },
  zh: {
    Normal: '一般', Fire: '火', Water: '水', Electric: '電',
    Grass: '草', Ice: '冰', Fighting: '格鬥', Poison: '毒',
    Ground: '地面', Flying: '飛行', Psychic: '超能力', Bug: '蟲',
    Rock: '岩石', Ghost: '幽靈', Dragon: '龍', Dark: '惡',
    Steel: '鋼', Fairy: '妖精', Stellar: '星晶',
  },
};

// ── Move category translations ────────────────────────────────────────────────

const CATEGORY_NAMES = {
  en: { Physical: 'Physical', Special: 'Special', Status: 'Status' },
  ja: { Physical: '物理', Special: '特殊', Status: '変化' },
  zh: { Physical: '物理', Special: '特殊', Status: '變化' },
};

// ── Stat name translations (for boost display) ────────────────────────────────

const STAT_NAMES = {
  en: { atk: 'ATK', def: 'DEF', spa: 'SPA', spd: 'SPD', spe: 'SPE', hp: 'HP' },
  ja: { atk: 'こうげき', def: 'ぼうぎょ', spa: 'とくこう', spd: 'とくぼう', spe: 'すばやさ', hp: 'HP' },
  zh: { atk: '攻擊', def: '防禦', spa: '特攻', spd: '特防', spe: '速度', hp: 'HP' },
};

// Nature modifier stat suffixes, e.g. '+Atk' → '+こうげき'
const NATURE_MOD_PARTS = {
  en: { '+Atk': '+Atk', '-Atk': '-Atk', '+Def': '+Def', '-Def': '-Def', '+SpA': '+SpA', '-SpA': '-SpA', '+SpD': '+SpD', '-SpD': '-SpD', '+Spe': '+Spe', '-Spe': '-Spe' },
  ja: { '+Atk': '+こうげき', '-Atk': '-こうげき', '+Def': '+ぼうぎょ', '-Def': '-ぼうぎょ', '+SpA': '+とくこう', '-SpA': '-とくこう', '+SpD': '+とくぼう', '-SpD': '-とくぼう', '+Spe': '+すばやさ', '-Spe': '-すばやさ' },
  zh: { '+Atk': '+攻擊', '-Atk': '-攻擊', '+Def': '+防禦', '-Def': '-防禦', '+SpA': '+特攻', '-SpA': '-特攻', '+SpD': '+特防', '-SpD': '-特防', '+Spe': '+速度', '-Spe': '-速度' },
};

// ── Pokémon dexClass → English name (for VGC alternate forms) ────────────────
// Key format: "NNNN-FF" (zero-padded dex number + form number).
// Only non-base forms need entries; base form (FF=00) falls through to
// the trilingual.json dex-number lookup, which covers all species.
const POKEMON_FORM_MAP = {
  // Alolan forms
  '0026-01': 'Raichu-Alola',
  '0037-01': 'Vulpix-Alola',
  '0038-01': 'Ninetales-Alola',
  '0027-01': 'Sandshrew-Alola',
  '0028-01': 'Sandslash-Alola',
  '0105-01': 'Marowak-Alola',
  // Galarian forms
  '0110-01': 'Weezing-Galar',
  // Rotom forms
  '0479-01': 'Rotom-Heat',
  '0479-02': 'Rotom-Wash',
  '0479-03': 'Rotom-Frost',
  '0479-04': 'Rotom-Fan',
  '0479-05': 'Rotom-Mow',
  // Origin formes
  '0483-01': 'Dialga-Origin',
  '0484-01': 'Palkia-Origin',
  '0487-01': 'Giratina-Origin',
  // Forces of Nature — Therian
  '0641-01': 'Tornadus-Therian',
  '0642-01': 'Thundurus-Therian',
  '0645-01': 'Landorus-Therian',
  // Lycanroc
  '0745-01': 'Lycanroc-Midnight',
  '0745-02': 'Lycanroc-Dusk',
  // Meowstic-F
  '0678-01': 'Meowstic-F',
  // Indeedee-F
  '0876-01': 'Indeedee-F',
  // Morpeko Hangry
  '0877-01': 'Morpeko-Hangry',
  // Zacian / Zamazenta crowned
  '0888-01': 'Zacian-Crowned',
  '0889-01': 'Zamazenta-Crowned',
  // Urshifu-Rapid-Strike
  '0892-01': 'Urshifu-Rapid-Strike',
  // Calyrex riders
  '0898-01': 'Calyrex-Ice',
  '0898-02': 'Calyrex-Shadow',
  // Ursaluna-Bloodmoon
  '0901-01': 'Ursaluna-Bloodmoon',
  // Basculegion-F
  '0902-01': 'Basculegion-F',
  // Enamorus-Therian
  '0905-01': 'Enamorus-Therian',
  // Oinkologne-F
  '0916-01': 'Oinkologne-F',
  // Hisuian forms
  '0549-01': 'Lilligant-Hisui',
  // Palafin-Hero
  '0963-01': 'Palafin-Hero',
  // Ogerpon masks (site order: 01=Wellspring, 02=Hearthflame, 03=Cornerstone)
  '1017-01': 'Ogerpon-Wellspring',
  '1017-02': 'Ogerpon-Hearthflame',
  '1017-03': 'Ogerpon-Cornerstone',
  // Terapagos
  '1024-01': 'Terapagos-Terastal',
  '1024-02': 'Terapagos-Stellar',
  // Toxtricity
  '0849-01': 'Toxtricity-Low-Key',
  // Eiscue Noice
  '0875-01': 'Eiscue-Noice',
  // Wooper Paldea
  '0194-01': 'Wooper-Paldea',
};

// Lazy reverse-map: Japanese type name → English type key (built once from TYPE_NAMES.ja)
const _jaTypeRevMap = (() => {
  const m = {};
  for (const [enKey, jaName] of Object.entries(TYPE_NAMES.ja)) m[jaName] = enKey;
  return m;
})();

// Lazy reverse-map: Japanese item name → { key: lowercase, display: proper English }
let _jaItemRevMap = null;
function _getJaItemRevMap() {
  if (_jaItemRevMap) return _jaItemRevMap;
  const maps = _getMaps();

  // Collect properly-capitalised English names from every source file.
  // (All these files are already required inside _getMaps, so no extra I/O.)
  const enDisplay = {};
  try {
    const t = require(path.join(__dirname, '../../data/trilingual.json'));
    for (const e of Object.values(t.item || {}))
      if (e.en) enDisplay[e.en.toLowerCase()] = e.en;
  } catch { /* ok */ }
  try {
    const s = require(path.join(__dirname, '../../data/supplement.json'));
    for (const [k, e] of Object.entries(s.item || {}))
      if (e.en) enDisplay[k.toLowerCase()] = e.en;
  } catch { /* ok */ }
  try {
    const zh = require(path.join(__dirname, '../../data/zh-Hant.json'));
    for (const n of Object.keys(zh.items || {}))
      enDisplay[n.toLowerCase()] = n;
  } catch { /* ok */ }
  try {
    const m = require(path.join(__dirname, '../../data/manual.json'));
    for (const [k, e] of Object.entries(m.item || {}))
      if (!k.startsWith('_') && e.en) enDisplay[k.toLowerCase()] = e.en;
  } catch { /* ok */ }

  _jaItemRevMap = {};
  for (const [enKey, { ja }] of Object.entries(maps.item)) {
    if (ja) _jaItemRevMap[ja] = { key: enKey, display: enDisplay[enKey] || enKey };
  }
  return _jaItemRevMap;
}

// Lazy map: dex-number string → { en, zh } (base form, zh-Hant overrides applied)
let _dexNumMap = null;
function _getDexNumMap() {
  if (_dexNumMap) return _dexNumMap;
  const maps      = _getMaps(); // ensures zh-Hant etc. are applied
  const trilingual = require(path.join(__dirname, '../../data/trilingual.json'));
  _dexNumMap = {};
  for (const [dexNum, entry] of Object.entries(trilingual.pokemon)) {
    const enKey    = (entry.en || '').toLowerCase();
    const mapEntry = maps.pokemon[enKey];
    _dexNumMap[dexNum] = {
      en: entry.en,
      ja: mapEntry?.ja ?? entry.ja ?? entry.en,
      zh: mapEntry?.zh ?? entry.zh ?? entry.en,
    };
  }
  return _dexNumMap;
}

// ── Name lookup maps ──────────────────────────────────────────────────────────

function _buildMap(categoryData) {
  const map = {};
  for (const entry of Object.values(categoryData)) {
    if (entry.en) {
      map[entry.en.toLowerCase()] = {
        ja: entry.ja || entry.en,
        zh: entry.zh || entry.en,
      };
    }
  }
  return map;
}

function _getMaps() {
  if (_maps) return _maps;
  const trilingual   = require(path.join(__dirname, '../../data/trilingual.json'));
  _maps = {
    pokemon: _buildMap(trilingual.pokemon),
    move:    _buildMap(trilingual.move),
    item:    _buildMap(trilingual.item),
    ability: _buildMap(trilingual.ability),
    nature:  _buildMap(trilingual.nature),
  };

  // Layer 1: supplement.json — Gen 9+ JA names from PokeAPI (fills missing entries)
  try {
    const supp = require(path.join(__dirname, '../../data/supplement.json'));
    for (const cat of ['ability', 'move', 'item']) {
      if (!supp[cat]) continue;
      for (const [enKey, entry] of Object.entries(supp[cat])) {
        if (!_maps[cat][enKey]) {
          _maps[cat][enKey] = { ja: entry.ja || enKey, zh: entry.zh || entry.ja || enKey };
        }
      }
    }
  } catch { /* supplement.json not generated yet — run scripts/fetch-supplement.js */ }

  // Layer 2: zh-Hant.json — Traditional Chinese for Gen 1–9 (overrides ZH in all categories)
  // Keys are English display names; values are Traditional Chinese strings.
  try {
    const zhHant = require(path.join(__dirname, '../../data/zh-Hant.json'));
    const CAT_MAP = {
      ability: 'abilities',
      move:    'moves',
      item:    'items',
      nature:  'natures',
      pokemon: 'pokemon',
    };
    for (const [cat, zhKey] of Object.entries(CAT_MAP)) {
      const zhSection = zhHant[zhKey];
      if (!zhSection) continue;
      for (const [enName, zhName] of Object.entries(zhSection)) {
        if (!zhName || typeof zhName !== 'string') continue;
        const key = enName.toLowerCase();
        if (_maps[cat][key]) {
          _maps[cat][key].zh = zhName;   // update existing entry's ZH
        } else {
          _maps[cat][key] = { ja: enName, zh: zhName }; // new entry (ZH only; JA falls back to EN)
        }
      }
    }
  } catch { /* zh-Hant.json not found */ }

  // Layer 3: manual.json — hand-curated VGC alternate forms + a few missing abilities.
  // Entries have _manual:true so they can be grepped and verified later.
  try {
    const manual = require(path.join(__dirname, '../../data/manual.json'));
    for (const cat of ['pokemon', 'ability', 'move', 'item']) {
      const section = manual[cat];
      if (!section) continue;
      for (const [key, entry] of Object.entries(section)) {
        if (key.startsWith('_')) continue; // skip metadata keys
        _maps[cat][key] = { ja: entry.ja || key, zh: entry.zh || entry.ja || key };
      }
    }
  } catch { /* manual.json not found */ }

  return _maps;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Translate a Pokémon / move / item / ability / nature name.
 * Falls back to the English name if no translation exists.
 * @param {string} name - English name
 * @param {'pokemon'|'move'|'item'|'ability'|'nature'} category
 * @param {'en'|'ja'|'zh'} lang
 */
function translate(name, category, lang) {
  if (!name || lang === 'en') return name;
  const maps  = _getMaps();
  const entry = maps[category]?.[name.toLowerCase()];
  return (entry && entry[lang]) || name;
}

/**
 * Get a static UI string, substituting {key} placeholders with values.
 * @param {string} key
 * @param {'en'|'ja'|'zh'} lang
 * @param {Record<string,string|number>} [vars]
 */
function ui(key, lang = 'en', vars = {}) {
  const str = (UI[lang] ?? UI.en)[key] ?? (UI.en[key] ?? key);
  return str.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

/**
 * Translate a type name (Normal, Fire, etc.).
 */
function translateType(typeName, lang) {
  if (!typeName || lang === 'en') return typeName;
  return TYPE_NAMES[lang]?.[typeName] ?? typeName;
}

/**
 * Translate a move category (Physical, Special, Status).
 */
function translateCategory(categoryName, lang) {
  if (!categoryName || lang === 'en') return categoryName;
  return CATEGORY_NAMES[lang]?.[categoryName] ?? categoryName;
}

/**
 * Translate a stat key (atk, def, spa, spd, spe, hp) to its display name.
 */
function translateStat(statKey, lang) {
  return STAT_NAMES[lang]?.[statKey] ?? statKey.toUpperCase();
}

/**
 * Translate a nature modifier part like '+Atk' or '-SpD'.
 */
function translateNatureMod(mod, lang) {
  if (lang === 'en') return mod;
  return NATURE_MOD_PARTS[lang]?.[mod] ?? mod;
}

/**
 * Translate a Pokémon by its dexClass string (e.g. "dex-0898-02").
 * Returns the translated name, or null if the dex number is unknown.
 * Falls back to the base-form name for form-00 Pokémon not in POKEMON_FORM_MAP.
 * @param {string} dexClass
 * @param {'en'|'ja'|'zh'} lang
 * @returns {string|null}
 */
function translateByDexClass(dexClass, lang) {
  if (!dexClass) return null;
  const m = dexClass.match(/^dex-(\d+)-(\d+)$/);
  if (!m) return null;
  const dexNum  = m[1].replace(/^0+/, '') || '0'; // strip leading zeros for map lookup
  const formKey = `${m[1]}-${m[2]}`;              // e.g. "0898-02"

  // 1. Check explicit form map (non-base forms)
  const enName = POKEMON_FORM_MAP[formKey];
  if (enName) return translate(enName, 'pokemon', lang);

  // 2. Fall back to base dex-number entry from trilingual.json
  const dexMap = _getDexNumMap();
  const entry  = dexMap[dexNum];
  if (!entry) return null;
  if (lang === 'en') return entry.en;
  if (lang === 'zh') return entry.zh;
  return null; // 'ja' → caller should use the original Japanese name
}

/**
 * Translate an item by its Japanese name (as scraped from pokedb.tokyo).
 * Returns the translated name, or the original Japanese if not found.
 * @param {string} jaName
 * @param {'en'|'ja'|'zh'} lang
 * @returns {string}
 */
function translateItemByJa(jaName, lang) {
  if (!jaName || lang === 'ja') return jaName;
  const revMap = _getJaItemRevMap();
  const entry  = revMap[jaName];
  if (!entry) return jaName;
  if (lang === 'en') return entry.display;
  return translate(entry.key, 'item', lang);
}

/**
 * Translate a tera type given its Japanese name (e.g. "ほのお" → "Fire" / "火").
 * Falls back to the Japanese name if no mapping is found.
 * @param {string} jaTypeName
 * @param {'en'|'ja'|'zh'} lang
 * @returns {string}
 */
function translateTeraType(jaTypeName, lang) {
  if (!jaTypeName || lang === 'ja') return jaTypeName;
  const enKey = _jaTypeRevMap[jaTypeName];
  if (!enKey) return jaTypeName;
  if (lang === 'en') return enKey;
  return TYPE_NAMES[lang]?.[enKey] ?? jaTypeName;
}

// ── Reverse zh→any lookup ──────────────────────────────────────────────────────

let _zhMaps = null;

function _getZhMaps() {
  if (_zhMaps) return _zhMaps;
  const tri   = require(path.join(__dirname, '../../data/trilingual.json'));
  const maps2 = _getMaps();
  _zhMaps = {};
  for (const cat of ['pokemon', 'move', 'item', 'ability', 'nature']) {
    _zhMaps[cat] = {};
    for (const entry of Object.values(tri[cat] || {})) {
      const enKey    = (entry.en || '').toLowerCase();
      const mapEntry = maps2[cat]?.[enKey];
      const zh       = mapEntry?.zh || entry.zh;
      if (zh && entry.en) {
        _zhMaps[cat][zh] = { en: entry.en, ja: mapEntry?.ja || entry.ja || entry.en };
      }
    }
  }
  return _zhMaps;
}

/**
 * Translate a Traditional Chinese name to another language.
 * Falls back to the Chinese name if no mapping is found.
 * @param {string} zhName
 * @param {'pokemon'|'move'|'item'|'ability'|'nature'} category
 * @param {'en'|'ja'|'zh'} lang
 */
function translateFromZh(zhName, category, lang) {
  if (!zhName || lang === 'zh') return zhName;
  const entry = _getZhMaps()[category]?.[zhName];
  if (!entry) return zhName;
  return lang === 'en' ? entry.en : (entry.ja || zhName);
}

/**
 * Language choices for slash command options.
 */
const LANG_CHOICES = [
  { name: 'English',    value: 'en' },
  { name: '日本語',     value: 'ja' },
  { name: '繁體中文',   value: 'zh' },
];

// ── Pokémon search list (for team_search autocomplete) ────────────────────────

let _pokemonSearchList = null;

/**
 * Returns a cached, sorted list of all searchable Pokémon for autocomplete.
 * Each entry: { label: "English / 中文", value: string, searchKey: string }
 *
 * value encoding:
 *   - Base species  → unpadded dex number string, e.g. "1017"  (matches ANY form)
 *   - Specific form → zero-padded formKey,         e.g. "1017-02" (Hearthflame only)
 *
 * Base forms appear first in dex order; each is immediately followed by its
 * non-base forms (Wellspring, Hearthflame, …) so autocomplete results are grouped.
 */
function getPokemonSearchList() {
  if (_pokemonSearchList) return _pokemonSearchList;

  const dexMap = _getDexNumMap(); // dexNum → { en, zh }

  // Group non-base forms by their unpadded dex number for interleaving.
  const formsByDex = new Map();
  for (const [formKey, enName] of Object.entries(POKEMON_FORM_MAP)) {
    const dexNum = formKey.split('-')[0].replace(/^0+/, '') || '0';
    if (!formsByDex.has(dexNum)) formsByDex.set(dexNum, []);
    const zhName = translate(enName, 'pokemon', 'zh');
    const jaName = translate(enName, 'pokemon', 'ja');
    formsByDex.get(dexNum).push({
      label:     `${enName} / ${zhName}`,
      value:     formKey,                   // "NNNN-FF" zero-padded
      searchKey: `${enName.toLowerCase()} ${zhName.toLowerCase()} ${jaName.toLowerCase()} ${formKey}`,
    });
  }

  const list = [];
  // Sort dex numbers numerically; insert base form then its alternate forms.
  const sortedNums = Object.keys(dexMap).sort((a, b) => parseInt(a) - parseInt(b));
  for (const dexNum of sortedNums) {
    const entry = dexMap[dexNum];
    if (!entry?.en) continue;
    const zhName = entry.zh || entry.en;
    const jaName = entry.ja || entry.en;
    list.push({
      label:     `${entry.en} / ${zhName}`,
      value:     dexNum,                    // unpadded dex number
      searchKey: `${entry.en.toLowerCase()} ${zhName.toLowerCase()} ${jaName.toLowerCase()} ${dexNum}`,
    });
    const forms = formsByDex.get(dexNum) || [];
    list.push(...forms);
  }

  _pokemonSearchList = list;
  return list;
}

/**
 * Returns true if a team member's dexClass matches a Pokémon search query.
 *
 * query: unpadded dexNum  → matches ANY form of that species (e.g. "1017" = any Ogerpon)
 *        zero-padded formKey → matches ONLY that specific form (e.g. "1017-02" = Hearthflame)
 *
 * @param {{ dexClass?: string }} member
 * @param {string} query
 */
function memberMatchesPokemonQuery(member, query) {
  if (!member?.dexClass) return false;
  const m = member.dexClass.match(/^dex-(\d+)-(\d+)$/);
  if (!m) return false;

  if (query.includes('-')) {
    // Specific form: compare the "NNNN-FF" formKey directly.
    return `${m[1]}-${m[2]}` === query;
  }
  // Any form of this species: compare unpadded dex numbers.
  return (m[1].replace(/^0+/, '') || '0') === (query.replace(/^0+/, '') || '0');
}

module.exports = {
  translate,
  ui,
  translateType,
  translateCategory,
  translateStat,
  translateNatureMod,
  translateKOText,
  translateByDexClass,
  translateItemByJa,
  translateTeraType,
  translateFromZh,
  LANG_CHOICES,
  getPokemonSearchList,
  memberMatchesPokemonQuery,
};
