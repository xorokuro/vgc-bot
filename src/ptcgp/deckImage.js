'use strict';

/**
 * src/ptcgp/deckImage.js
 *
 * Generates a card-grid PNG for a PTCGP decklist using sharp.
 * Cards are laid out 5 per row; each gets a count badge in the bottom-right.
 * Missing images get a gray placeholder so layout stays consistent.
 */

const fs     = require('fs');
const sharp  = require('sharp');
const cardDb = require('./cardDb');

// ── Layout constants ──────────────────────────────────────────────────────────

const CARD_W  = 185;
const CARD_H  = 259; // ~1.4:1 aspect (standard PTCGP card ratio)
const COLS    = 5;
const GAP     = 6;
const PAD     = 14;
const BG      = { r: 18, g: 36, b: 26, alpha: 1 }; // dark green background

// ── Image helpers ─────────────────────────────────────────────────────────────

const LANG_ORDERS = {
  zh: ['zh_TW', 'en_US', 'ja_JP'],
  ja: ['ja_JP', 'en_US', 'zh_TW'],
  en: ['en_US', 'ja_JP', 'zh_TW'],
};

/**
 * Load and resize a card image from the DB.
 * Returns a Buffer, or null if unavailable.
 */
async function loadCardImage(uid, lang = 'zh') {
  const card = cardDb.getCard(uid);
  if (!card) return null;
  const order   = LANG_ORDERS[lang] ?? LANG_ORDERS.zh;
  const imgPath = order.map(l => card.images?.[l]).find(p => p && fs.existsSync(p));
  if (!imgPath) return null;
  try {
    return await sharp(imgPath)
      .resize(CARD_W, CARD_H, { fit: 'cover', position: 'top' })
      .toBuffer();
  } catch {
    return null;
  }
}

/**
 * Create a gray placeholder card with the card name.
 */
function makePlaceholder(label) {
  // Escape XML characters
  const safe = String(label).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const svg = `<svg width="${CARD_W}" height="${CARD_H}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${CARD_W}" height="${CARD_H}" rx="10" fill="#3a3a4a"/>
    <text x="${CARD_W / 2}" y="${CARD_H / 2 - 8}" text-anchor="middle"
      font-size="13" fill="#aaaaaa" font-family="sans-serif">${safe}</text>
    <text x="${CARD_W / 2}" y="${CARD_H / 2 + 12}" text-anchor="middle"
      font-size="11" fill="#777777" font-family="sans-serif">(no image)</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * Create a circular count badge SVG at 34×34 px.
 */
function makeBadge(count) {
  const svg = `<svg width="34" height="34" xmlns="http://www.w3.org/2000/svg">
    <circle cx="17" cy="17" r="16" fill="#bb1111" stroke="#ffffff" stroke-width="2.5"/>
    <text x="17" y="23" text-anchor="middle"
      font-size="17" font-weight="bold" fill="white" font-family="sans-serif">${count}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Build a grid PNG for a decklist.
 *
 * @param {Array<{uid: string, count: number, displayName?: string}>} entries
 *   Ordered list of cards (Pokémon first, then Trainers).
 * @param {'zh'|'ja'|'en'} [lang='zh']  Preferred image/name language.
 * @returns {Promise<Buffer>} PNG buffer ready to attach to a Discord message.
 */
async function buildDeckImage(entries, lang = 'zh') {
  if (!entries.length) throw new Error('Empty entries');

  const ROWS = Math.ceil(entries.length / COLS);
  const W    = PAD * 2 + COLS * CARD_W + (COLS - 1) * GAP;
  const H    = PAD * 2 + ROWS * CARD_H + (ROWS - 1) * GAP;

  // Resolve all card images + badges in parallel
  const [cardBuffers, badgeBuffers] = await Promise.all([
    Promise.all(entries.map(async e => {
      const buf = await loadCardImage(e.uid, lang);
      return buf ?? makePlaceholder(e.displayName ?? e.uid);
    })),
    Promise.all(entries.map(e => makeBadge(e.count))),
  ]);

  // Build composite input list
  const composites = [];
  for (let i = 0; i < entries.length; i++) {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x   = PAD + col * (CARD_W + GAP);
    const y   = PAD + row * (CARD_H + GAP);

    composites.push({ input: cardBuffers[i], left: x, top: y });
    composites.push({ input: badgeBuffers[i], left: x + CARD_W - 34, top: y + CARD_H - 34 });
  }

  return sharp({
    create: { width: W, height: H, channels: 4, background: BG },
  })
    .composite(composites)
    .png({ compressionLevel: 6 })
    .toBuffer();
}

module.exports = { buildDeckImage };
