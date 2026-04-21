'use strict';

const path = require('path');
const fs   = require('fs');

const DATA_DIR = path.join(__dirname, '../../data');

let _seasons     = null;
let _champSeasons = null;
const _cache = new Map();

function getAvailableSeasons() {
  if (_seasons) return _seasons;
  _seasons = fs.readdirSync(DATA_DIR)
    .filter(d => /^season_\d+$/.test(d))
    .map(d => parseInt(d.slice(7), 10))
    .sort((a, b) => a - b);
  return _seasons;
}

function getLatestSeason() {
  const s = getAvailableSeasons();
  return s[s.length - 1] ?? null;
}

// Returns champion season keys like ['m1', 'm2'] sorted by number
function getChampionSeasons() {
  if (_champSeasons) return _champSeasons;
  _champSeasons = fs.readdirSync(DATA_DIR)
    .filter(d => /^champ_m\d+$/.test(d))
    .map(d => d.slice(6)) // 'm1', 'm2', ...
    .sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)));
  return _champSeasons;
}

function getLatestChampionSeason() {
  const s = getChampionSeasons();
  return s[s.length - 1] ?? null;
}

function loadSeasonData(season, format) {
  const key = `${season}_${format}`;
  if (_cache.has(key)) return _cache.get(key);
  const file = path.join(DATA_DIR, `season_${season}`, `${format}.json`);
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    _cache.set(key, data);
    return data;
  } catch {
    return null;
  }
}

function loadChampionData(season, format) {
  const key = `champ_${season}_${format}`;
  if (_cache.has(key)) return _cache.get(key);
  const file = path.join(DATA_DIR, `champ_${season}`, `${format}.json`);
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    _cache.set(key, data);
    return data;
  } catch {
    return null;
  }
}

function getSpriteUrl(entry) {
  const id = entry.sprite_id || entry.pid;
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home/${id}.png`;
}

function refreshCache() {
  _seasons      = null;
  _champSeasons = null;
  _cache.clear();
}

// Auto-refresh every 6 hours
setInterval(refreshCache, 6 * 60 * 60 * 1000);

/**
 * Find a pokemon entry in a loaded season data object by Chinese name.
 * Tries exact match first, then substring.
 */
function findPokemon(data, query) {
  const q = query.trim().toLowerCase();
  for (const entry of Object.values(data)) {
    if (!entry || typeof entry !== 'object' || !entry.full_name) continue;
    if (entry.full_name.toLowerCase() === q) return entry;
  }
  for (const entry of Object.values(data)) {
    if (!entry || typeof entry !== 'object' || !entry.full_name) continue;
    if (entry.full_name.toLowerCase().includes(q)) return entry;
  }
  return null;
}

/** Returns all pokemon entries sorted by rank (filters out metadata keys). */
function getRankedEntries(data, maxN = 150) {
  return Object.values(data)
    .filter(e => e && typeof e === 'object' && e.rank != null)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, maxN);
}

module.exports = {
  getAvailableSeasons, getLatestSeason, loadSeasonData,
  getChampionSeasons, getLatestChampionSeason, loadChampionData,
  getSpriteUrl, findPokemon, getRankedEntries,
};
