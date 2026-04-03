'use strict';

/**
 * Generate a team preview image from scraped pokedb.tokyo member data.
 *
 * Layout (6 columns × 1 row):
 *   ┌────────────────────────────────────────────────────────────────────────┐
 *   │  [Sprite]  [Sprite]  [Sprite]  [Sprite]  [Sprite]  [Sprite]            │
 *   │  [T] [I]   [T] [I]   [T] [I]   [T] [I]   [T] [I]   [T] [I]            │
 *   └────────────────────────────────────────────────────────────────────────┘
 *   T = tera-type coloured badge, I = item icon (user-supplied or CDN)
 *
 * Pokémon sprites:  PokémonShowdown HOME sprites (primary), PokeAPI (fallback)
 * Item sprites:     data/items/{itemId}.png  (user-supplied via bot portal)
 *                   Fallback → HOME CDN guess → no icon
 * Tera badge:       Pure SVG — no external assets needed.
 */

const sharp = require('sharp');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

// ── Layout ────────────────────────────────────────────────────────────────────
const COL_W     = 132;   // width of each Pokémon column
const COL_H     = 164;   // height of each column
const SPRITE_SZ = 96;    // Pokémon sprite size (square)
const ITEM_SZ   = 36;    // item icon size (square)
const TERA_SZ   = 26;    // tera badge size (square)
const BG        = { r: 18, g: 18, b: 28, alpha: 1 };  // dark navy background

// ── Disk sprite cache ─────────────────────────────────────────────────────────
const SPRITE_CACHE_DIR = path.join(__dirname, '../../data/poke_sprites');
const ITEM_LOCAL_DIR   = path.join(__dirname, '../../data/items');        // user-provided
const ITEM_CACHE_DIR   = path.join(__dirname, '../../data/item_sprites'); // CDN-cached
const TERA_CACHE_DIR   = path.join(__dirname, '../../data/tera_sprites'); // tera type icons

for (const d of [SPRITE_CACHE_DIR, ITEM_CACHE_DIR, TERA_CACHE_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// ── HTTP helper ───────────────────────────────────────────────────────────────
function fetchBuf(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'PokemonBot/1.0' } }, res => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const chunks = [];
      res.on('data',  c => chunks.push(c));
      res.on('end',   () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// Fetch + disk-cache a remote image, return Buffer or null on failure
async function fetchCached(urls, cacheFile) {
  if (cacheFile && fs.existsSync(cacheFile)) {
    try { return fs.readFileSync(cacheFile); } catch { /* fall through */ }
  }
  for (const url of (Array.isArray(urls) ? urls : [urls])) {
    try {
      const buf = await fetchBuf(url);
      if (cacheFile) fs.writeFile(cacheFile, buf, () => {});
      return buf;
    } catch { /* try next */ }
  }
  return null;
}

// ── Tera type data ────────────────────────────────────────────────────────────
// IDs follow the game's internal type order (confirmed: tt-9 = ほのお = Fire).
// This differs from PokéAPI order — do NOT mix them up.

// typeId → Discord application emoji ID (the exact same icons used throughout the bot)
// IDs sourced from buildEmbed.js TYPE_EMOJI; fetched from Discord CDN as PNG.
const TERA_EMOJI_ID = {
   0: '1485645329276866590', // Normal
   1: '1485645343231185057', // Fighting
   2: '1485645338940276776', // Flying
   3: '1485645327007486075', // Poison
   4: '1485645332867186699', // Ground
   5: '1485645323325149365', // Rock
   6: '1485644797862613155', // Bug
   7: '1485645336725950646', // Ghost
   8: '1485645319747407943', // Steel
   9: '1485645341406531624', // Fire
  10: '1485645317410914374', // Water
  11: '1485645334884520097', // Grass
  12: '1485645346829893753', // Electric
  13: '1485645325451661432', // Psychic
  14: '1485645330962972753', // Ice
  15: '1485645349589618808', // Dragon
  16: '1485645351351484657', // Dark
  17: '1485645345143914536', // Fairy
  18: '1485645315418755243', // Stellar
};

// Fetch (and disk-cache) the type icon from Discord CDN, then resize to fit the badge slot.
// Falls back to null so the caller can use the SVG badge instead.
async function getTeraSprite(typeId, size) {
  const emojiId = TERA_EMOJI_ID[typeId];
  if (!emojiId) return null;
  const cacheFile = path.join(TERA_CACHE_DIR, `${typeId}.png`);
  const buf = await fetchCached(
    [`https://cdn.discordapp.com/emojis/${emojiId}.png`],
    cacheFile,
  );
  if (!buf) return null;
  try {
    return await sharp(buf)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
  } catch { return null; }
}

const TERA = {
   0: { color: '#A8A77A', abbr: 'ノ' }, // Normal   ノーマル
   1: { color: '#C22E28', abbr: '格' }, // Fighting かくとう
   2: { color: '#A98FF3', abbr: '飛' }, // Flying   ひこう
   3: { color: '#A33EA1', abbr: '毒' }, // Poison   どく
   4: { color: '#E2BF65', abbr: '地' }, // Ground   じめん
   5: { color: '#B6A136', abbr: '岩' }, // Rock     いわ
   6: { color: '#A6B91A', abbr: '虫' }, // Bug      むし
   7: { color: '#735797', abbr: '霊' }, // Ghost    ゴースト
   8: { color: '#B7B7CE', abbr: '鋼' }, // Steel    はがね
   9: { color: '#EE8130', abbr: '炎' }, // Fire     ほのお
  10: { color: '#6390F0', abbr: '水' }, // Water    みず
  11: { color: '#7AC74C', abbr: '草' }, // Grass    くさ
  12: { color: '#F7D02C', abbr: '電' }, // Electric でんき
  13: { color: '#F95587', abbr: '超' }, // Psychic  エスパー
  14: { color: '#96D9D6', abbr: '氷' }, // Ice      こおり
  15: { color: '#6F35FC', abbr: '竜' }, // Dragon   ドラゴン
  16: { color: '#705746', abbr: '悪' }, // Dark     あく
  17: { color: '#D685AD', abbr: '妖' }, // Fairy    フェアリー
  18: { color: '#40B5A5', abbr: '星' }, // Stellar  ステラ
};

function teraaBadgeSvg(typeId, sz = TERA_SZ) {
  const t     = TERA[typeId] ?? { color: '#888888', abbr: '?' };
  const r     = sz / 2;
  const safe  = t.abbr.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  return Buffer.from(
    `<svg width="${sz}" height="${sz}" xmlns="http://www.w3.org/2000/svg">` +
    `<circle cx="${r}" cy="${r}" r="${r - 1}" fill="${t.color}" stroke="rgba(255,255,255,0.7)" stroke-width="1.5"/>` +
    `<text x="${r}" y="${r + 5}" font-size="13" font-family="sans-serif" ` +
    `fill="white" text-anchor="middle" font-weight="bold">${safe}</text>` +
    `</svg>`,
  );
}

// ── Pokémon sprite ────────────────────────────────────────────────────────────
// dexClass "dex-NNNN-FF" → sprite Buffer or null
function parseDexClass(dexClass) {
  const m = (dexClass ?? '').match(/dex-(\d+)-(\d+)/);
  if (!m) return null;
  return { num: m[1], numPad: m[1].padStart(4, '0'), form: m[2].padStart(2, '0') };
}

// dexClass → PokémonShowdown HOME sprite name for Pokémon whose form number
// would otherwise resolve to the wrong (base) sprite via the numeric PS URL.
// Key format: "dex-NNNN-FF" (zero-padded as scraped from pokedb.tokyo).
// HOME form numbering matches the game's internal order.
const PS_FORM_NAMES = {
  // Rotom appliances (HOME: 1=Heat, 2=Wash, 3=Frost, 4=Fan, 5=Mow)
  'dex-0479-01': 'rotom-heat',
  'dex-0479-02': 'rotom-wash',
  'dex-0479-03': 'rotom-frost',
  'dex-0479-04': 'rotom-fan',
  'dex-0479-05': 'rotom-mow',
  // Tornadus / Thundurus / Landorus / Enamorus Therian (form 1)
  'dex-0641-01': 'tornadus-therian',
  'dex-0642-01': 'thundurus-therian',
  'dex-0645-01': 'landorus-therian',
  'dex-0905-01': 'enamorus-therian',
  // Kyurem fusions (HOME: 1=Black, 2=White)
  'dex-0646-01': 'kyurem-black',
  'dex-0646-02': 'kyurem-white',
  // Giratina Origin (form 1)
  'dex-0487-01': 'giratina-origin',
  // Hoopa Unbound (form 1)
  'dex-0720-01': 'hoopa-unbound',
  // Necrozma fusions (HOME: 1=Dusk-Mane, 2=Dawn-Wings, 3=Ultra)
  'dex-0800-01': 'necrozma-dusk',
  'dex-0800-02': 'necrozma-dawn',
  'dex-0800-03': 'necrozma-ultra',
  // Zacian / Zamazenta Crowned (form 1)
  'dex-0888-01': 'zacian-crowned',
  'dex-0889-01': 'zamazenta-crowned',
  // Urshifu Rapid Strike (form 1)
  'dex-0892-01': 'urshifu-rapidstrike',
  // Calyrex fusions (HOME: 1=Ice Rider, 2=Shadow Rider)
  'dex-0898-01': 'calyrex-ice',
  'dex-0898-02': 'calyrex-shadow',
  // Palafin Hero (form 1) — very common in SV VGC
  'dex-0964-01': 'palafin-hero',
  // Tatsugiri (HOME: 1=Droopy, 2=Stretchy)
  'dex-1006-01': 'tatsugiri-droopy',
  'dex-1006-02': 'tatsugiri-stretchy',
  // Ogerpon masks (HOME: 1=Wellspring, 2=Hearthflame, 3=Cornerstone)
  'dex-1017-01': 'ogerpon-wellspring',
  'dex-1017-02': 'ogerpon-hearthflame',
  'dex-1017-03': 'ogerpon-cornerstone',
  // Terapagos (HOME: 1=Terastal, 2=Stellar)
  'dex-1024-01': 'terapagos-terastal',
  'dex-1024-02': 'terapagos-stellar',
};

async function getPokeSprite(dexClass) {
  const p = parseDexClass(dexClass);
  if (!p) return null;

  const cacheFile = path.join(SPRITE_CACHE_DIR, `${p.numPad}_${p.form}.png`);
  const num       = parseInt(p.num, 10);
  const isBase    = p.form === '00';
  const psNamed   = PS_FORM_NAMES[dexClass];

  // Build URL priority list:
  // - Named-form Pokémon: PS named sprite is most reliable, then HOME CDN
  // - Base forms: PS numeric is reliable
  // - Unknown non-base forms: HOME CDN first (has correct form), then PS numeric as fallback
  const urls = [];
  if (psNamed) {
    urls.push(`https://play.pokemonshowdown.com/sprites/home/${psNamed}.png`);
  }
  if (isBase) {
    urls.push(`https://play.pokemonshowdown.com/sprites/home/${num}.png`);
    urls.push(`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home/${num}.png`);
  }
  // HOME CDN carries the correct form via numPad+form — highest priority for unknown non-base forms
  urls.push(`https://resource.pokemon-home.com/battledata/img/pokei128/poke_icon_${p.numPad}_${p.form}_n_00000000_f_n.png`);
  if (!isBase && !psNamed) {
    // Last resort: base-form sprite so something shows rather than nothing
    urls.push(`https://play.pokemonshowdown.com/sprites/home/${num}.png`);
    urls.push(`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home/${num}.png`);
  }

  return fetchCached(urls, cacheFile);
}

// ── Item sprite ───────────────────────────────────────────────────────────────
async function getItemSprite(itemId) {
  if (!itemId) return null;

  // 1. User-provided file (highest priority, placed in data/items/{itemId}.png)
  const local = path.join(ITEM_LOCAL_DIR, `${itemId}.png`);
  if (fs.existsSync(local)) return fs.readFileSync(local);

  // 2. CDN-cached file from previous fetches
  const cacheFile = path.join(ITEM_CACHE_DIR, `${itemId}.png`);

  // Try Pokémon HOME item CDN (guessed URL — fill in correct path if different)
  return fetchCached([
    `https://resource.pokemon-home.com/battledata/img/item/item_${String(itemId).padStart(4, '0')}.png`,
  ], cacheFile);
}

// ── Resize helper ─────────────────────────────────────────────────────────────
async function resizeTo(buf, size) {
  if (!buf) return null;
  try {
    return await sharp(buf)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
  } catch { return null; }
}

// ── Placeholder sprite (transparent square) ───────────────────────────────────
function placeholder(size) {
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).png().toBuffer();
}

// ── Public: build team image ──────────────────────────────────────────────────
/**
 * @param {Array<{dexClass, name, teraTypeId, teraTypeName, itemId, itemName}>} members
 * @returns {Promise<Buffer>} PNG buffer
 */
async function buildTeamImage(members) {
  const count = Math.min(members.length, 6);
  const W     = COL_W * count;
  const H     = COL_H;

  // Fetch all sprites in parallel
  const spriteBufs = await Promise.all(
    members.slice(0, count).map(m => getPokeSprite(m.dexClass)),
  );
  const itemBufs = await Promise.all(
    members.slice(0, count).map(m => getItemSprite(m.itemId)),
  );

  // Resize all sprites in parallel
  const [spriteResized, itemResized] = await Promise.all([
    Promise.all(spriteBufs.map(b => b ? resizeTo(b, SPRITE_SZ) : placeholder(SPRITE_SZ))),
    Promise.all(itemBufs.map(b => b ? resizeTo(b, ITEM_SZ) : null)),
  ]);

  const composites = [];

  for (let i = 0; i < count; i++) {
    const x0     = i * COL_W;
    const member = members[i];

    // Sprite: centered horizontally, top-padded
    const spriteX = x0 + Math.floor((COL_W - SPRITE_SZ) / 2);
    const spriteY = 6;
    if (spriteResized[i]) {
      composites.push({ input: spriteResized[i], left: spriteX, top: spriteY });
    }

    // Tera badge: bottom-left of column
    if (member.teraTypeId != null) {
      const tid     = parseInt(member.teraTypeId, 10);
      const teraBuf = await getTeraSprite(tid, TERA_SZ)
        ?? await sharp(teraaBadgeSvg(tid)).png().toBuffer().catch(() => null);
      if (teraBuf) composites.push({ input: teraBuf, left: x0 + 4, top: H - TERA_SZ - 4 });
    }

    // Item icon: bottom-right of column
    if (itemResized[i]) {
      composites.push({
        input: itemResized[i],
        left:  x0 + COL_W - ITEM_SZ - 4,
        top:   H - ITEM_SZ - 4,
      });
    }

    // Column separator (except after last column)
    if (i < count - 1) {
      const lineH   = H - 20;
      const lineSvg = Buffer.from(
        `<svg width="1" height="${lineH}" xmlns="http://www.w3.org/2000/svg">` +
        `<rect width="1" height="${lineH}" fill="rgba(255,255,255,0.12)"/>` +
        `</svg>`,
      );
      composites.push({ input: lineSvg, left: x0 + COL_W - 1, top: 10 });
    }
  }

  return sharp({
    create: { width: W, height: H, channels: 4, background: BG },
  })
    .composite(composites)
    .png()
    .toBuffer();
}

// ── Public: build teams LIST image (up to 5 rows, each row = one team's sprites) ─
// Layout per row:
//   [num badge 28px] [6 × COL_W sprite columns]
// Used by the /teams list embed to replace raw Pokémon name text.

const LIST_NUM_W   = 28;    // left column: row number badge
const LIST_ROW_H   = 120;   // height per team row
const LIST_SPRITE  = 78;    // sprite size inside each row
const LIST_ITEM_SZ = 26;    // item icon
const LIST_TERA_SZ = 18;    // tera badge

/**
 * @param {Array<Array<{dexClass,teraTypeId,itemId}>>} teamsMembers
 *   Up to 5 elements; each element is the .members array of one team.
 * @returns {Promise<Buffer>} PNG buffer
 */
async function buildTeamsListImage(teamsMembers) {
  const rowCount = Math.min(teamsMembers.length, 5);
  const W = LIST_NUM_W + 6 * COL_W;
  const H = LIST_ROW_H * rowCount;

  const composites = [];

  for (let row = 0; row < rowCount; row++) {
    const members = (teamsMembers[row] || []).slice(0, 6);
    const y0 = row * LIST_ROW_H;

    // Row separator — 3px, clearly visible
    if (row > 0) {
      composites.push({
        input: Buffer.from(
          `<svg width="${W}" height="3" xmlns="http://www.w3.org/2000/svg">` +
          `<rect width="${W}" height="3" fill="rgba(255,255,255,0.45)"/></svg>`,
        ),
        left: 0, top: y0 - 1,
      });
    }

    // Row number badge
    const numSvg = Buffer.from(
      `<svg width="${LIST_NUM_W}" height="${LIST_ROW_H}" xmlns="http://www.w3.org/2000/svg">` +
      `<text x="${LIST_NUM_W / 2}" y="${LIST_ROW_H / 2 + 5}" font-size="13" ` +
      `font-family="monospace" fill="rgba(255,255,255,0.35)" text-anchor="middle" ` +
      `font-weight="bold">${row + 1}</text></svg>`,
    );
    composites.push({ input: await sharp(numSvg).png().toBuffer(), left: 0, top: y0 });

    // Fetch all sprites + items for this row in parallel
    const [spriteBufs, itemBufs] = await Promise.all([
      Promise.all(members.map(m => getPokeSprite(m.dexClass))),
      Promise.all(members.map(m => getItemSprite(m.itemId))),
    ]);

    for (let col = 0; col < members.length; col++) {
      const member = members[col];
      const x0     = LIST_NUM_W + col * COL_W;

      // Sprite — centred in column
      const spriteBuf = spriteBufs[col]
        ? await resizeTo(spriteBufs[col], LIST_SPRITE)
        : await placeholder(LIST_SPRITE);
      if (spriteBuf) {
        composites.push({
          input: spriteBuf,
          left:  x0 + Math.floor((COL_W - LIST_SPRITE) / 2),
          top:   y0 + Math.floor((LIST_ROW_H - LIST_SPRITE) / 2) - 6,
        });
      }

      // Tera badge — bottom-left of column
      if (member.teraTypeId != null) {
        const tid     = parseInt(member.teraTypeId, 10);
        const teraBuf = await getTeraSprite(tid, LIST_TERA_SZ)
          ?? await sharp(teraaBadgeSvg(tid, LIST_TERA_SZ)).png().toBuffer().catch(() => null);
        if (teraBuf) composites.push({ input: teraBuf, left: x0 + 4, top: y0 + LIST_ROW_H - LIST_TERA_SZ - 4 });
      }

      // Item icon — bottom-right of column
      const itemResized = itemBufs[col] ? await resizeTo(itemBufs[col], LIST_ITEM_SZ) : null;
      if (itemResized) {
        composites.push({
          input: itemResized,
          left:  x0 + COL_W - LIST_ITEM_SZ - 4,
          top:   y0 + LIST_ROW_H - LIST_ITEM_SZ - 4,
        });
      }

      // Column separator
      if (col < members.length - 1) {
        const lineH = LIST_ROW_H - 20;
        composites.push({
          input: Buffer.from(
            `<svg width="1" height="${lineH}" xmlns="http://www.w3.org/2000/svg">` +
            `<rect width="1" height="${lineH}" fill="rgba(255,255,255,0.08)"/></svg>`,
          ),
          left: x0 + COL_W - 1, top: y0 + 10,
        });
      }
    }
  }

  return sharp({
    create: { width: W, height: H, channels: 4, background: BG },
  })
    .composite(composites)
    .png()
    .toBuffer();
}

module.exports = { buildTeamImage, buildTeamsListImage };
