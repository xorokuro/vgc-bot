'use strict';

/**
 * Multilingual display names for each PTCGP set.
 * zh = Traditional Chinese, en = English (Japanese names TBD).
 */
const SET_NAMES = {
  A1:  { zh: '最強的基因',   en: 'Genetic Apex' },
  A1a: { zh: '幻遊島',       en: 'Mythical Island' },
  A2:  { zh: '時空激鬥',     en: 'Space-Time Smackdown' },
  A2a: { zh: '超克之光',     en: 'Triumphant Light' },
  A2b: { zh: '嗨放異彩',     en: 'Shining Rivalry' },
  A3:  { zh: '雙天之守護者', en: 'Celestial Guardians' },
  A3a: { zh: '異次元危機',   en: 'Extradimensional Crisis' },
  A3b: { zh: '伊布花園',     en: 'Eevee Groove' },
  A4:  { zh: '天與海的指引', en: 'Wisdom of Sea and Sky' },
  A4a: { zh: '未知水域',     en: 'Secluded Springs' },
  A4b: { zh: '高級擴充包ex', en: 'Deluxe Pack ex' },
  B1:  { zh: '超級崛起',     en: 'Mega Rising' },
  B1a: { zh: '紅蓮烈焰',     en: 'Crimson Blaze' },
  B2:  { zh: '幻夢遊行',     en: 'Fantastical Parade' },
  B2a: { zh: '帕底亞驚奇',   en: 'Paldean Sweets' },
  B2b: { zh: '超級異彩',     en: 'Mega Shine' },
  'P-A': { zh: 'Promo A',    en: 'Promo-A' },
  'P-B': { zh: 'Promo B',    en: 'Promo-B' },
};

/**
 * Get the display name for a set in the given language.
 * Falls back to English, then the set ID.
 * @param {string} setId  e.g. 'A2'
 * @param {'zh'|'en'} lang
 */
function getSetName(setId, lang = 'zh') {
  const names = SET_NAMES[setId] ?? {};
  return names[lang] ?? names.en ?? setId;
}

module.exports = { SET_NAMES, getSetName };
