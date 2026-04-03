'use strict';
const fs   = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/ptcgp_cards.json');

// ── RaenonX file parser (same logic as parse-raenonx.js) ─────────────────────
const RARITIES = new Set(['C','U','R','RR','AR','SR','SAR','IM','S','SSR','UR','PROMO-A','PROMO-B']);
const TYPES    = new Set([
  'Grass','Fire','Water','Lightning','Psychic','Fighting','Darkness','Metal','Dragon','Colorless',
  '草','火','水','雷','超','格鬥','黑暗','鋼','龍','無色','惡','無',
  // Japanese type tokens
  '炎','闘','悪',
]);

function parseFile(filepath, setId) {
  if (!fs.existsSync(filepath)) { console.warn(`⚠  ${filepath} not found — skipping`); return new Map(); }
  const text  = fs.readFileSync(filepath, 'utf8');
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const esc   = setId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re    = new RegExp('^' + esc + '-0*(\\d+)$');
  const seen  = new Map();
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(re);
    if (!m) { i++; continue; }
    const uid = setId + '-' + parseInt(m[1], 10);
    i++;
    while (i < lines.length && RARITIES.has(lines[i])) i++;
    if (i >= lines.length) break;
    let name = '';
    if (TYPES.has(lines[i])) {
      i++;
      name = lines[i] || '';
      i++;
    } else {
      const raw  = lines[i];
      const half = Math.floor(raw.length / 2);
      const a = raw.slice(0, half), b = raw.slice(half);
      name = (a === b) ? a : raw;
      i++;
    }
    while (i < lines.length && !lines[i].match(re)) i++;
    if (!seen.has(uid)) seen.set(uid, name);
  }
  return seen;
}

// ── Load DB ───────────────────────────────────────────────────────────────────
const db    = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
const byUid = new Map(db.cards.map(c => [c.uid, c]));
let patchCount = 0;

function applyPatch(uid, en, zh, ja, mode = 'always') {
  const card = byUid.get(uid);
  if (!card) { console.warn(`⚠  ${uid} not found in DB`); return; }
  let changed = false;
  const apply = (field, val) => {
    if (!val) return;
    if (mode === 'always' || !card.names[field]) {
      if (card.names[field] !== val) { card.names[field] = val; changed = true; }
    }
  };
  apply('en', en);
  apply('zh', zh);
  apply('ja', ja);
  if (changed) {
    patchCount++;
    console.log(`✓ ${uid}  en="${card.names.en}"  zh="${card.names.zh}"  ja="${card.names.ja}"`);
  }
}

// Expand "A2b-16,82,100" → ["A2b-16","A2b-82","A2b-100"]
function expandIds(raw) {
  const parts = raw.split(',').map(s => s.trim());
  const m = parts[0].match(/^([A-Za-z][A-Za-z0-9]*)-(\d+)$/);
  if (!m) return parts;
  const setId = m[1];
  return parts.map((p, i) => (i === 0 || !/^\d+$/.test(p)) ? p : `${setId}-${p}`);
}

// ── 1. Explicit CSV patches (always override) ─────────────────────────────────
const CSV_PATCHES = [
  // A2
  { en:'Cresselia ex',          zh:'克雷色利亞ex',       ja:'クレセリアex',                          ids:'A2-212'        },
  // A2b
  { en:'Charizard ex',          zh:'噴火龍ex',            ja:'リザードンex',                          ids:'A2b-16,82,100' },
  { en:'Wugtrio ex',            zh:'三海地鼠ex',          ja:'ウミトリオex',                          ids:'A2b-25,84,101' },
  { en:'Pikachu ex',            zh:'皮卡丘ex',            ja:'ピカチュウex',                          ids:'A2b-28,86,102' },
  { en:'Giratina ex',           zh:'騎拉帝納ex',          ja:'ギラティナex',                          ids:'A2b-39,87,103' },
  { en:'Lucario ex',            zh:'路卡利歐ex',          ja:'ルカリオex',                            ids:'A2b-45,88,104' },
  { en:'Paldean Clodsire ex',   zh:'帕底亞 土王ex',       ja:'パルデアドオーex',                      ids:'A2b-50,89,105' },
  { en:'Tinkaton ex',           zh:'巨鍛匠ex',            ja:'デカヌチャンex',                        ids:'A2b-56,90,106' },
  { en:'Bibarel ex',            zh:'大尾狸ex',            ja:'ビーダルex',                            ids:'A2b-66,93,107' },
  { en:'Mewtwo ex',             zh:'超夢ex',              ja:'ミュウツーex',                          ids:'A2b-108'       },
  // A3
  { en:'Alolan Raichu ex',      zh:'阿羅拉 雷丘ex',       ja:'アローラライチュウex',                  ids:'A3-58,185,203' },
  { en:'Alolan Muk ex',         zh:'阿羅拉 臭臭泥ex',     ja:'アローラベトベトンex',                  ids:'A3-111,188,206'},
  // A3a
  { en:'Alolan Dugtrio ex',     zh:'阿羅拉 三地鼠ex',     ja:'アローラダグトリオex',                  ids:'A3a-47,80,87'  },
  // A4a
  { en:'Memory Light',          zh:'記憶燈泡',            ja:'メモリーライト',                        ids:'A4a-68'        },
  { en:'Morty',                 zh:'松葉',                ja:'マツバ',                                ids:'A4a-71,85'     },
  { en:'Paldean Clodsire ex',   zh:'帕底亞 土王ex',       ja:'パルデアドオーex',                      ids:'A4a-104'       },
  // B1
  { en:'Mega Pinsir ex',        zh:'超級凱羅斯ex',        ja:'メガカイロスex',                        ids:'B1-2,251,272'  },
  { en:'Mega Blaziken ex',      zh:'超級火焰雞ex',        ja:'メガバシャーモex',                      ids:'B1-36,254,284' },
  { en:'Mega Gyarados ex',      zh:'超級暴鯉龍ex',        ja:'メガギャラドスex',                      ids:'B1-52,255,285' },
  { en:'Mega Ampharos ex',      zh:'超級電龍ex',          ja:'メガデンリュウex',                      ids:'B1-85,258,277' },
  { en:'Mega Altaria ex',       zh:'超級七夕青鳥ex',      ja:'メガチルタリスex',                      ids:'B1-102,259,286'},
  { en:'Mega Absol ex',         zh:'超級阿勃梭魯ex',      ja:'メガアブソルex',                        ids:'B1-151,262,280'},
  { en:'Alolan Dugtrio ex',     zh:'阿羅拉 三地鼠ex',     ja:'アローラダグトリオex',                  ids:'B1-325'        },
  // B1a
  { en:'Mega Venusaur ex',      zh:'超級妙蛙花ex',        ja:'メガフシギバナex',                      ids:'B1a-4,76,83'   },
  { en:'Mega Charizard Y ex',   zh:'超級噴火龍Yex',       ja:'メガリザードンYex',                     ids:'B1a-14,77,87'  },
  { en:'Mega Blastoise ex',     zh:'超級水箭龜ex',        ja:'メガカメックスex',                      ids:'B1a-20,78,84'  },
  { en:'Mega Lopunny ex',       zh:'超級長耳兔ex',        ja:'メガミミロップex',                      ids:'B1a-42,79,85'  },
  { en:'Mega Steelix ex',       zh:'超級大鋼蛇ex',        ja:'メガハガネールex',                      ids:'B1a-52,80,86'  },
  // B2
  { en:'Teal Mask Ogerpon ex',  zh:'厄鬼椪 碧草面具ex',   ja:'碧（みどり）のお面（めん）オーガポンex', ids:'B2-17,180,194' },
  { en:'Alolan Ninetales ex',   zh:'阿羅拉 九尾ex',       ja:'アローラキュウコンex',                  ids:'B2-29,182,196' },
  { en:'Mega Swampert ex',      zh:'超級巨沼怪ex',        ja:'メガラグラージex',                      ids:'B2-36,183,197' },
  { en:'Mega Gardevoir ex',     zh:'超級沙奈朵ex',        ja:'メガサーナイトex',                      ids:'B2-66,185,203' },
  { en:'Mega Mawile ex',        zh:'超級大嘴娃ex',        ja:'メガクチートex',                        ids:'B2-113,188,201'},
  { en:'Mega Kangaskhan ex',    zh:'超級袋獸ex',          ja:'メガガルーラex',                        ids:'B2-127,189,202'},
  // B2a
  { en:'Meowscarada ex',        zh:'魔幻假面喵ex',        ja:'マスカーニャex',                        ids:'B2a-3'         },
  { en:'Armarouge ex',          zh:'紅蓮鎧騎ex',          ja:'グレンアルマex',                        ids:'B2a-20'        },
  { en:'Chien-Pao ex',          zh:'古劍豹ex',            ja:'パオジアンex',                          ids:'B2a-37'        },
  { en:'Bellibolt ex',          zh:'電肚蛙ex',            ja:'ハラバリーex',                          ids:'B2a-42'        },
  { en:'Gholdengo ex',          zh:'賽富豪ex',            ja:'サーフゴーex',                          ids:'B2a-78'        },
  // B2b
  { en:'Mega Charizard X ex',   zh:'超級噴火龍Xex',       ja:'メガリザードンXex',                     ids:'B2b-9'         },
  { en:'Mega Slowbro ex',       zh:'超級呆殼獸ex',        ja:'メガヤドランex',                        ids:'B2b-16'        },
  { en:'Mega Manectric ex',     zh:'超級雷電獸ex',        ja:'メガライボルトex',                      ids:'B2b-27'        },
  { en:'Mega Gengar ex',        zh:'超級耿鬼ex',          ja:'メガゲンガーex',                        ids:'B2b-39'        },
  { en:'Mega Scizor ex',        zh:'超級巨鉗螳螂ex',      ja:'メガハッサムex',                        ids:'B2b-47'        },
];

console.log('=== CSV patches ===');
for (const p of CSV_PATCHES) {
  for (const uid of expandIds(p.ids)) applyPatch(uid, p.en, p.zh, p.ja, 'always');
}

// ── 2. A3 promo patches (OCR-confirmed) ───────────────────────────────────────
const A3_PROMOS = [
  { uid:'A3-240', en:'Alolan Exeggutor', zh:'阿羅拉 椰蛋樹', ja:'アローラナッシー'   },
  { uid:'A3-241', en:'Alolan Ninetales', zh:'阿羅拉 九尾',   ja:'アローラキュウコン' },
  { uid:'A3-242', en:'Mimikyu',          zh:'謎擬Q',          ja:'ミミッキュ'         },
  { uid:'A3-243', en:'Cosmog',           zh:'科斯莫古',       ja:'コスモッグ'         },
  { uid:'A3-244', en:'Crabrawler',       zh:'好勝蟹',         ja:'マケンカニ'         },
  { uid:'A3-245', en:'Lycanroc',         zh:'鬃岩狼人',       ja:'ルガルガン'         },
  { uid:'A3-246', en:'Alolan Grimer',    zh:'阿羅拉 臭泥',    ja:'アローラベトベター' },
  { uid:'A3-247', en:'Toucannon',        zh:'銃嘴大鳥',       ja:'ドデカバシ'         },
  { uid:'A3-248', en:'Rayquaza',         zh:'烈空坐',         ja:'レックウザ'         },
  { uid:'A3-249', en:'Rayquaza ex',      zh:'烈空坐ex',       ja:'レックウザex'       },
  { uid:'A3-250', en:'Rayquaza ex',      zh:'烈空坐ex',       ja:'レックウザex'       },
];

console.log('\n=== A3 promo patches ===');
for (const p of A3_PROMOS) applyPatch(p.uid, p.en, p.zh, p.ja, 'always');

// ── 3. B2b special arts — EN only, fill blank ─────────────────────────────────
const B2B_EN = {
  'B2b-66':'Maintenance',      'B2b-67':'Iris',              'B2b-68':'Calem',
  'B2b-69':'Hiking Trail',     'B2b-70':'Lapras',            'B2b-71':'Empoleon',
  'B2b-72':'Groudon',          'B2b-73':'Morpeko',           'B2b-74':'Revavroom',
  'B2b-75':'Miltank',          'B2b-76':'Mega Charizard X ex','B2b-77':'Mega Slowbro ex',
  'B2b-78':'Mega Manectric ex','B2b-79':'Mega Gengar ex',    'B2b-80':'Mega Scizor ex',
  'B2b-81':'Iris',             'B2b-82':'Calem',             'B2b-83':'Mega Slowbro ex',
  'B2b-84':'Mega Manectric ex','B2b-85':'Mew',               'B2b-86':'Mew',
  'B2b-87':'Scyther',          'B2b-88':'Pineco',            'B2b-89':'Phantump',
  'B2b-90':'Trevenant',        'B2b-91':'Charmander',        'B2b-92':'Charmeleon',
  'B2b-93':'Ponyta',           'B2b-94':'Rapidash',          'B2b-95':'Slowpoke',
  'B2b-96':'Pikachu',          'B2b-97':'Raichu',            'B2b-98':'Electrike',
  'B2b-99':'Hawlucha',         'B2b-100':'Gastly',           'B2b-101':'Haunter',
  'B2b-102':'Zorua',           'B2b-103':'Zoroark',          'B2b-104':'Forretress',
  'B2b-105':'Dratini',         'B2b-106':'Dragonair',        'B2b-107':'Dragonite',
  'B2b-108':'Axew',            'B2b-109':'Fraxure',          'B2b-110':'Haxorus',
  'B2b-111':'Mega Charizard X ex','B2b-112':'Mega Slowbro ex','B2b-113':'Mega Manectric ex',
  'B2b-114':'Mega Gengar ex',  'B2b-115':'Mega Scizor ex',   'B2b-116':'Arboliva',
  'B2b-117':'Metal Core Barrier',
};

console.log('\n=== B2b special arts (EN fill) ===');
for (const [uid, en] of Object.entries(B2B_EN)) applyPatch(uid, en, '', '', 'fill');

// ── 4. RaenonX ZH names from text dumps (fill blank only) ────────────────────
const a3Map  = parseFile('C:/Users/sagen/Downloads/A3.txt',  'A3');
const b2aMap = parseFile('C:/Users/sagen/Downloads/B2a.txt', 'B2a');
const a4bMap = parseFile('C:/Users/sagen/Downloads/A4b.txt', 'A4b');

console.log(`\n=== A3 ZH fill (${a3Map.size} parsed) ===`);
for (const [uid, zh] of a3Map)  applyPatch(uid, '', zh, '', 'fill');

console.log(`\n=== B2a ZH fill (${b2aMap.size} parsed) ===`);
for (const [uid, zh] of b2aMap) applyPatch(uid, '', zh, '', 'fill');

// A4b.txt is a Japanese-language dump — clear zh only if it contains Japanese kana
// (catches cards where the first bad run wrote Japanese into zh)
console.log('\n=== A4b: clearing Japanese-contaminated zh names ===');
const JP_RE = /[\u3040-\u30FF]/; // hiragana or katakana
for (const uid of a4bMap.keys()) {
  const card = byUid.get(uid);
  if (card && card.names.zh && JP_RE.test(card.names.zh)) {
    card.names.zh = '';
    console.log(`  cleared japanese zh for ${uid}`);
  }
}
console.log(`\n=== A4b JA fill (${a4bMap.size} parsed) ===`);
for (const [uid, ja] of a4bMap) applyPatch(uid, '', '', ja, 'fill');

// ── Write back ────────────────────────────────────────────────────────────────
fs.writeFileSync(DB_PATH, JSON.stringify(db));
console.log(`\n✅  Patched ${patchCount} card name fields. Saved to ${path.relative(process.cwd(), DB_PATH)}`);
