'use strict';

/**
 * src/ptcgp/sprites.js
 *
 * Central config for official PTCGP sprite emojis.
 *
 * HOW TO SET UP:
 *  1. Upload each PNG to your Discord server as a custom emoji
 *     (Server Settings → Emoji → Upload Emoji)
 *  2. In Discord, type \:emoji_name: to get the full ID string,
 *     e.g.  <:title_ene_gra:1234567890123456789>
 *  3. Paste that string into the matching slot below.
 *
 * If a slot is left as '', the bot falls back to plain text/symbols.
 */

// ── Type sprites ──────────────────────────────────────────────────────────────
// Upload files: title_ene_gra.png, title_ene_fir.png, ...

const TYPE_SPRITE = {
  Grass:     '<:title_ene_gra:1487853971602276515>',
  Fire:      '<:title_ene_fir:1487853968674656347>',
  Water:     '<:title_ene_wat:1487853979873312921>',
  Lightning: '<:title_ene_lig:1487853973279997972>',
  Psychic:   '<:title_ene_psy:1487853978141331596>',
  Fighting:  '<:title_ene_fig:1487853965629460522>',
  Darkness:  '<:title_ene_dar:1487853962223947937>',
  Metal:     '<:title_ene_met:1487853974727033107>',
  Dragon:    '<:title_ene_dra:1487853964320968804>',
  Colorless: '<:title_ene_nor:1487853976413274172>',
};

// ── Rarity base sprites ───────────────────────────────────────────────────────

const RAR_SPRITE = {
  diamond: '<:pack_icn_rarity_detail_01:1487853919244783687>',  // ◇ (C / U / R / RR)
  star:    '<:pack_icn_rarity_detail_02:1487853920796672051>',  // ☆ (AR / SR / SAR)
  crown:   '<:pack_icn_rarity_detail_03:1487853923095285761>',  // ♛ (IM)
  sparkle: '<:pack_icn_rarity_detail_04:1487853924684927131>',  // ✦ (S / SSR / UR)
};

// ── Fallback text symbols (used when sprites not configured) ──────────────────

const TYPE_TEXT = {
  Grass:     '草',
  Fire:      '炎',
  Water:     '水',
  Lightning: '雷',
  Psychic:   '超',
  Fighting:  '鬥',
  Darkness:  '惡',
  Metal:     '鋼',
  Dragon:    '龍',
  Colorless: '無色',
};

const RARITY_TEXT = {
  C:   '◇',
  U:   '◇◇',
  R:   '◇◇◇',
  RR:  '◇◇◇◇',
  AR:  '☆',
  SR:  '☆☆',
  SAR: '☆☆',
  IM:  '♛',
  S:   '✦',
  SSR: '✦✦',
  UR:  '👑',
};

// Rarity → which base sprite to repeat, and how many times
const RARITY_SPRITE_MAP = {
  C:   { base: 'diamond', count: 1 },
  U:   { base: 'diamond', count: 2 },
  R:   { base: 'diamond', count: 3 },
  RR:  { base: 'diamond', count: 4 },
  AR:  { base: 'star',    count: 1 },
  SR:  { base: 'star',    count: 2 },
  SAR: { base: 'star',    count: 2 },
  IM:  { base: 'crown',   count: 1 },
  S:   { base: 'sparkle', count: 1 },
  SSR: { base: 'sparkle', count: 2 },
  UR:  { base: 'sparkle', count: 3 },
};

// ── Public helpers ────────────────────────────────────────────────────────────

/**
 * Returns the type sprite emoji string, or the ZH text label as fallback.
 * For trainer cards (no type), returns '訓練師'.
 */
function typeSprite(type) {
  if (!type) return '訓練師';
  if (TYPE_SPRITE[type]) return TYPE_SPRITE[type];
  return TYPE_TEXT[type] ?? type;
}

/**
 * Returns the rarity sprite string (repeated icon), or text symbol as fallback.
 * e.g. for R with sprites configured: '<:diamond:123><:diamond:123><:diamond:123>'
 *      for R without sprites:         '◇◇◇'
 */
function raritySprite(rarity) {
  if (!rarity) return '—';
  const map = RARITY_SPRITE_MAP[rarity];
  if (map) {
    const sprite = RAR_SPRITE[map.base];
    if (sprite) return sprite.repeat(map.count);
  }
  return RARITY_TEXT[rarity] ?? rarity;
}

/**
 * Full rarity display: sprite (or symbol) + code label.
 * e.g. '◇◇◇ (R)' or '<:diamond:123><:diamond:123><:diamond:123> (R)'
 */
function rarityDisplay(card) {
  const sym = raritySprite(card.rarity);
  return card.rarity ? `${sym} (${card.rarity})` : sym;
}

/**
 * Short text rarity symbol for use in compact list rows where embed space is tight.
 * e.g. '◇◇◇◇' for RR — avoids blowing past Discord's 4096-char embed limit.
 */
function rarityText(rarity) {
  return RARITY_TEXT[rarity] ?? rarity ?? '—';
}

/**
 * Short plain-text type label, safe for select menu option labels.
 * e.g. '[草]', '[炎]', '[訓練師]'
 */
function typeText(type) {
  if (!type) return '[訓練師]';
  const t = TYPE_TEXT[type];
  return t ? `[${t}]` : `[${type}]`;
}

module.exports = { typeSprite, typeText, raritySprite, rarityDisplay, rarityText };
