'use strict';
const fs = require('fs');

const RARITIES = new Set(['C','U','R','RR','AR','SR','SAR','IM','S','SSR','UR','PROMO-A','PROMO-B']);
const TYPES    = new Set([
  'Grass','Fire','Water','Lightning','Psychic','Fighting','Darkness','Metal','Dragon','Colorless',
  '草','火','水','雷','超','格鬥','黑暗','鋼','龍','無色','惡','無',
]);

function parseFile(filepath, setId) {
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
      i++;                      // skip type
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

const b2a = fs.existsSync('C:/Users/sagen/Downloads/B2a.txt')
  ? parseFile('C:/Users/sagen/Downloads/B2a.txt', 'B2a') : new Map();
const a3  = fs.existsSync('C:/Users/sagen/Downloads/A3.txt')
  ? parseFile('C:/Users/sagen/Downloads/A3.txt',  'A3')  : new Map();

// B2b EN names from earlier parse (B2b.txt no longer in Downloads)
const B2B_EN = {
  'B2b-66':'Maintenance','B2b-67':'Iris','B2b-68':'Calem','B2b-69':'Hiking Trail',
  'B2b-70':'Lapras','B2b-71':'Empoleon','B2b-72':'Groudon','B2b-73':'Morpeko',
  'B2b-74':'Revavroom','B2b-75':'Miltank','B2b-76':'Mega Charizard X ex',
  'B2b-77':'Mega Slowbro ex','B2b-78':'Mega Manectric ex','B2b-79':'Mega Gengar ex',
  'B2b-80':'Mega Scizor ex','B2b-81':'Iris','B2b-82':'Calem','B2b-83':'Mega Slowbro ex',
  'B2b-84':'Mega Manectric ex','B2b-85':'Mew','B2b-86':'Mew','B2b-87':'Scyther',
  'B2b-88':'Pineco','B2b-89':'Phantump','B2b-90':'Trevenant','B2b-91':'Charmander',
  'B2b-92':'Charmeleon','B2b-93':'Ponyta','B2b-94':'Rapidash','B2b-95':'Slowpoke',
  'B2b-96':'Pikachu','B2b-97':'Raichu','B2b-98':'Electrike','B2b-99':'Hawlucha',
  'B2b-100':'Gastly','B2b-101':'Haunter','B2b-102':'Zorua','B2b-103':'Zoroark',
  'B2b-104':'Forretress','B2b-105':'Dratini','B2b-106':'Dragonair','B2b-107':'Dragonite',
  'B2b-108':'Axew','B2b-109':'Fraxure','B2b-110':'Haxorus','B2b-111':'Mega Charizard X ex',
  'B2b-112':'Mega Slowbro ex','B2b-113':'Mega Manectric ex','B2b-114':'Mega Gengar ex',
  'B2b-115':'Mega Scizor ex','B2b-116':'Arboliva','B2b-117':'Metal Core Barrier',
};

console.log('B2a:', b2a.size, '| A3:', a3.size);
if (b2a.size) {
  console.log('\n=== B2a 86-131 (ZH names) ===');
  for (let n = 86; n <= 131; n++) console.log('B2a-'+n, JSON.stringify(b2a.get('B2a-'+n) ?? 'MISSING'));
}
if (a3.size) {
  console.log('\n=== A3 240-250 (promo ZH names) ===');
  for (let n = 240; n <= 250; n++) console.log('A3-'+n, JSON.stringify(a3.get('A3-'+n) ?? 'MISSING'));
}
console.log('\n=== B2b 66-117 (EN names) ===');
for (let n = 66; n <= 117; n++) console.log('B2b-'+n, JSON.stringify(B2B_EN['B2b-'+n] ?? 'MISSING'));
