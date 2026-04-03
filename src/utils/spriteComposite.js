'use strict';

const https = require('https');
const sharp = require('sharp');
const { AttachmentBuilder } = require('discord.js');

const SPRITE_SIZE = 96;  // each sprite resized to this square
const GAP         = 12;  // transparent gap between sprites
const BAR_HEIGHT  = 12;  // HP bar height in px
const BAR_GAP     = 8;   // gap between sprites and HP bar
const BAR_RADIUS  = 6;   // rounded corner radius
const FETCH_TIMEOUT = 5000; // ms before giving up on a sprite fetch

// HP bar colors (RGBA)
const COLOR_GREEN  = [87,  242, 135, 255]; // #57F287 — definitely surviving
const COLOR_YELLOW = [254, 231, 92,  255]; // #FEE75C — roll-dependent
const COLOR_RED    = [237, 66,  69,  255]; // #ED4245 — definitely taken

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, res => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end',  () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);

    req.setTimeout(FETCH_TIMEOUT, () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${url}`));
    });
  });
}

/**
 * Fetch and resize a sprite from an ordered list of URLs.
 * Tries each URL in sequence — returns the first that succeeds.
 * Falls back to a transparent placeholder if all URLs fail.
 */
async function fetchSprite(urls) {
  const urlList = Array.isArray(urls) ? urls : [urls];
  for (const url of urlList) {
    try {
      const buf = await fetchBuffer(url);
      return await sharp(buf)
        .resize(SPRITE_SIZE, SPRITE_SIZE, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toBuffer();
    } catch { /* try next URL */ }
  }
  // All URLs failed — return transparent placeholder
  return sharp({
    create: {
      width: SPRITE_SIZE, height: SPRITE_SIZE,
      channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).png().toBuffer();
}

/**
 * Build an HP bar as a raw pixel buffer (no SVG dependency).
 * Green = definitely surviving, yellow = uncertain range, red = definitely taken.
 */
function makeHPBarBuffer(minRem, maxRem, defHP, width) {
  const h      = BAR_HEIGHT;
  const r      = BAR_RADIUS;
  const greenW  = Math.round(Math.max(0, minRem)          / defHP * width);
  const yellowW = Math.round(Math.max(0, maxRem - minRem) / defHP * width);

  function colorAt(x) {
    if (x < greenW)           return COLOR_GREEN;
    if (x < greenW + yellowW) return COLOR_YELLOW;
    return COLOR_RED;
  }

  const pixels = Buffer.alloc(width * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      // Rounded corners
      const cx = Math.min(x, width - 1 - x);
      const cy = Math.min(y, h - 1 - y);
      if (cx < r && cy < r) {
        const dx = r - cx - 1, dy = r - cy - 1;
        if (dx * dx + dy * dy > (r - 0.5) * (r - 0.5)) {
          pixels[idx] = pixels[idx+1] = pixels[idx+2] = pixels[idx+3] = 0;
          continue;
        }
      }
      const [rv, gv, bv, av] = colorAt(x);
      pixels[idx]     = rv;
      pixels[idx + 1] = gv;
      pixels[idx + 2] = bv;
      pixels[idx + 3] = av;
    }
  }

  return sharp(pixels, { raw: { width, height: h, channels: 4 } }).png().toBuffer();
}

/**
 * Download both HOME sprites, composite them side-by-side, and render an HP bar below.
 * Each sprite falls back to a transparent placeholder on failure, so the image always renders.
 *
 * hpBar: { minRem, maxRem, defHP } — omit to skip the HP bar.
 *
 * Returns an AttachmentBuilder, or throws if compositing itself fails.
 */
async function compositeSprites(attackerUrl, defenderUrl, hpBar = null) {
  const [atkResized, defResized] = await Promise.all([
    fetchSprite(attackerUrl),
    fetchSprite(defenderUrl),
  ]);

  const totalWidth  = SPRITE_SIZE * 2 + GAP;
  const totalHeight = hpBar
    ? SPRITE_SIZE + BAR_GAP + BAR_HEIGHT
    : SPRITE_SIZE;

  const layers = [
    { input: atkResized, left: 0,                top: 0 },
    { input: defResized, left: SPRITE_SIZE + GAP, top: 0 },
  ];

  if (hpBar) {
    const barBuf = await makeHPBarBuffer(hpBar.minRem, hpBar.maxRem, hpBar.defHP, totalWidth);
    layers.push({ input: barBuf, left: 0, top: SPRITE_SIZE + BAR_GAP });
  }

  const composite = await sharp({
    create: {
      width: totalWidth, height: totalHeight,
      channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(layers)
    .png()
    .toBuffer();

  return new AttachmentBuilder(composite, { name: 'sprites.png' });
}

module.exports = { compositeSprites };
