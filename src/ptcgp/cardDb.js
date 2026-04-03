'use strict';

/**
 * PTCGP card database module.
 * Loads data/ptcgp_cards.json and provides search/lookup utilities.
 */

const fs   = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../data/ptcgp_cards.json');

let _cards   = null; // array of card objects
let _byUid   = null; // Map<uid, card>  (keys are always 3-digit-padded)
let _loaded  = false;

function load() {
  if (_loaded) return;
  _loaded = true;

  if (!fs.existsSync(DB_PATH)) {
    console.warn('[cardDb] Database not found. Run: node scripts/build-from-txt.js');
    _cards  = [];
    _byUid  = new Map();
    return;
  }

  try {
    const raw  = fs.readFileSync(DB_PATH, 'utf8');
    const db   = JSON.parse(raw);
    _cards     = db.cards ?? [];
    _byUid     = new Map(_cards.map(c => [c.uid, c]));
    console.log(`[cardDb] Loaded ${_cards.length} PTCGP cards (generated ${db.generated?.slice(0, 10)})`);
  } catch (e) {
    console.error('[cardDb] Failed to parse database:', e.message);
    _cards = [];
    _byUid = new Map();
  }
}

/**
 * Normalise a uid to 3-digit-padded form.
 * Accepts both "A1-1" and "A1-001".
 */
function normaliseUid(uid) {
  if (!uid) return uid;
  // Support set IDs that themselves contain hyphens (e.g. "P-A-5" → "P-A-005")
  const lastDash = uid.lastIndexOf('-');
  if (lastDash === -1) return uid;
  const setId  = uid.slice(0, lastDash);
  const numStr = uid.slice(lastDash + 1);
  if (!setId || !/^\d+$/.test(numStr)) return uid;
  return `${setId}-${numStr.padStart(3, '0')}`;
}

/**
 * Get a card by uid.
 * Accepts both "A1-001" (padded) and "A1-1" (unpadded) formats.
 * Returns undefined if not found.
 */
function getCard(uid) {
  load();
  return _byUid.get(normaliseUid(uid));
}

/**
 * Search cards where any language name or uid contains the query (case-insensitive).
 * Returns up to `limit` matches.
 */
function search(query, limit = 25) {
  load();
  if (!query || !query.trim()) return _cards.slice(0, limit);

  const q = query.trim().toLowerCase();
  const results = [];

  for (const card of _cards) {
    if (results.length >= limit) break;
    const { zh = '', ja = '', en = '' } = card.names;
    if (
      card.uid.toLowerCase().includes(q) ||
      zh.toLowerCase().includes(q) ||
      ja.toLowerCase().includes(q) ||
      en.toLowerCase().includes(q)
    ) {
      results.push(card);
    }
  }

  return results;
}

/**
 * Filter cards by a compiled predicate function.
 * Returns array of matching cards up to `limit`.
 */
function filterCards(predFn, limit = 100) {
  load();
  return _cards.filter(predFn).slice(0, limit);
}

/** True if the database exists and is loaded. */
function isReady() {
  load();
  return _cards.length > 0;
}

/** Return all cards belonging to a set, in card-number order. */
function getSetCards(setId) {
  load();
  return _cards.filter(c => c.set === setId);
}

/**
 * Return the list of unique sets in database order,
 * each as { id, name (English), count }.
 */
function getSets() {
  load();
  const seen = new Map();
  for (const card of _cards) {
    if (!seen.has(card.set)) seen.set(card.set, { id: card.set, name: card.setName, count: 0 });
    seen.get(card.set).count++;
  }
  return [...seen.values()];
}

module.exports = { load, getCard, search, filterCards, isReady, getSetCards, getSets };
