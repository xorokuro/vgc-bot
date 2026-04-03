'use strict';

const path = require('path');
const {
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const { toID } = require('@smogon/calc');
const { TYPE_EMOJI } = require('../utils/buildEmbed');
const { translateType } = require('../utils/i18n');

// ── Type chart (Gen 9) ────────────────────────────────────────────────────────
// For each attacking type: which defending types it hits for 2x / 0.5x / 0x

const TYPE_CHART = {
  Normal:   { super: [],                                         notVery: ['Rock', 'Steel'],                               immune: ['Ghost'] },
  Fire:     { super: ['Grass', 'Ice', 'Bug', 'Steel'],           notVery: ['Fire', 'Water', 'Rock', 'Dragon'],             immune: [] },
  Water:    { super: ['Fire', 'Ground', 'Rock'],                 notVery: ['Water', 'Grass', 'Dragon'],                    immune: [] },
  Electric: { super: ['Water', 'Flying'],                        notVery: ['Electric', 'Grass', 'Dragon'],                 immune: ['Ground'] },
  Grass:    { super: ['Water', 'Ground', 'Rock'],                notVery: ['Fire', 'Grass', 'Poison', 'Flying', 'Bug', 'Dragon', 'Steel'], immune: [] },
  Ice:      { super: ['Grass', 'Ground', 'Flying', 'Dragon'],    notVery: ['Fire', 'Water', 'Ice', 'Steel'],               immune: [] },
  Fighting: { super: ['Normal', 'Ice', 'Rock', 'Dark', 'Steel'], notVery: ['Poison', 'Flying', 'Psychic', 'Bug', 'Fairy'], immune: ['Ghost'] },
  Poison:   { super: ['Grass', 'Fairy'],                         notVery: ['Poison', 'Ground', 'Rock', 'Ghost'],           immune: ['Steel'] },
  Ground:   { super: ['Fire', 'Electric', 'Poison', 'Rock', 'Steel'], notVery: ['Grass', 'Bug'],                           immune: ['Flying'] },
  Flying:   { super: ['Grass', 'Fighting', 'Bug'],               notVery: ['Electric', 'Rock', 'Steel'],                   immune: [] },
  Psychic:  { super: ['Fighting', 'Poison'],                     notVery: ['Psychic', 'Steel'],                            immune: ['Dark'] },
  Bug:      { super: ['Grass', 'Psychic', 'Dark'],               notVery: ['Fire', 'Fighting', 'Flying', 'Ghost', 'Steel', 'Fairy', 'Poison'], immune: [] },
  Rock:     { super: ['Fire', 'Ice', 'Flying', 'Bug'],           notVery: ['Fighting', 'Ground', 'Steel'],                 immune: [] },
  Ghost:    { super: ['Psychic', 'Ghost'],                       notVery: ['Dark'],                                        immune: ['Normal'] },
  Dragon:   { super: ['Dragon'],                                 notVery: ['Steel'],                                       immune: ['Fairy'] },
  Dark:     { super: ['Psychic', 'Ghost'],                       notVery: ['Fighting', 'Dark', 'Fairy'],                   immune: [] },
  Steel:    { super: ['Ice', 'Rock', 'Fairy'],                   notVery: ['Fire', 'Water', 'Electric', 'Steel'],          immune: [] },
  Fairy:    { super: ['Fighting', 'Dragon', 'Dark'],             notVery: ['Fire', 'Poison', 'Steel'],                     immune: [] },
};

const ALL_TYPES = Object.keys(TYPE_CHART);

/**
 * Returns an object { weak4x, weak2x, resist2x, resist4x, immune }
 * where each value is an array of Title-cased type names.
 * @param {string[]} types - Title-cased type names, e.g. ['Grass', 'Poison']
 */
function calcTypeMatchups(types) {
  const groups = { weak4x: [], weak2x: [], resist2x: [], resist4x: [], immune: [] };

  for (const atkType of ALL_TYPES) {
    const chart = TYPE_CHART[atkType];
    let mult = 1;
    for (const defType of types) {
      if (chart.immune.includes(defType)) { mult = 0; break; }
      if (chart.super.includes(defType))   mult *= 2;
      else if (chart.notVery.includes(defType)) mult *= 0.5;
    }
    if      (mult >= 4)    groups.weak4x.push(atkType);
    else if (mult === 2)   groups.weak2x.push(atkType);
    else if (mult === 0.25) groups.resist4x.push(atkType);
    else if (mult === 0.5) groups.resist2x.push(atkType);
    else if (mult === 0)   groups.immune.push(atkType);
  }
  return groups;
}

// ── Data loading ──────────────────────────────────────────────────────────────

let _vocabData    = null; // { pokemon, move, item, ability, nature }  —  filtered arrays (all three names present)
let _searchIndex  = null; // flat array of all entries regardless of missing names, for search
let _etym         = null; // etymology by dex ID
let _pokedexMap   = null; // lowercase EN name ↁE{ types_en, types_zh }

function loadVocabData() {
  if (_vocabData) return _vocabData;
  const tri = require(path.join(__dirname, '../../data/trilingual.json'));
  const toList = (section) =>
    Object.entries(section)
      .map(([id, e]) => ({ id, en: e.en || '', ja: e.ja || '', ja_hrkt: e.ja_hrkt || '', zh: e.zh || '' }))
      .filter(e => e.en && e.ja && e.zh);
  _vocabData = {
    pokemon: toList(tri.pokemon),
    move:    toList(tri.move),
    item:    toList(tri.item),
    ability: toList(tri.ability),
    nature:  toList(tri.nature),
  };
  return _vocabData;
}

// ── Form-aware search index ───────────────────────────────────────────────────

/**
 * Convert a pokedex_db name_en into a human-readable display name.
 * "urshifu-single-strike" ↁE"Urshifu (Single Strike)"
 * "charizard-mega-x"      ↁE"Charizard (Mega X)"
 * "rattata-alola"         ↁE"Rattata (Alola)"
 */
function prettifyFormName(nameEn, speciesEn) {
  const title = w => w.charAt(0).toUpperCase() + w.slice(1);
  if (nameEn === speciesEn) return speciesEn.split('-').map(title).join(' ');
  const formPart    = nameEn.slice(speciesEn.length + 1);        // "single-strike"
  const speciesLabel = speciesEn.split('-').map(title).join(' '); // "Urshifu"
  const formLabel    = formPart.split('-').map(title).join(' ');  // "Single Strike"
  return `${speciesLabel} (${formLabel})`;
}

// Suffixes we never want as separate search entries (same typing, cosmetic only)
const SKIP_FORM_SUFFIXES = new Set([
  'gmax', 'totem', 'totem-alola', 'totem-busted', 'totem-disguised',
  'cosplay', 'spiky-eared', 'starter', 'own-tempo',
  // Alcremie sweets —all Normal type
  ...['berry','clover','flower','love','ribbon','star','strawberry'].flatMap(s =>
    ['caramel-swirl','lemon-cream','matcha-cream','mint-cream','rainbow-swirl',
     'ruby-cream','ruby-swirl','salted-cream','vanilla-cream'].map(d => `${d}-${s}-sweet`)
  ),
]);

function loadSearchIndex() {
  if (_searchIndex) return _searchIndex;
  const tri = require(path.join(__dirname, '../../data/trilingual.json'));
  const db  = require(path.join(__dirname, '../../data/pokedex_db.json'));

  // Group pokedex_db by species name, collecting distinct type combos
  const bySpecies = {};
  for (const dbEntry of Object.values(db)) {
    const s = dbEntry.species_en_name || dbEntry.name_en;
    if (!bySpecies[s]) bySpecies[s] = [];
    bySpecies[s].push(dbEntry);
  }

  _searchIndex = [];

  for (const [cat, section] of Object.entries(tri)) {
    for (const [id, e] of Object.entries(section)) {
      const baseName = (e.en || '').toLowerCase();

      // For non-pokemon categories, or species with no form variants, add a single entry
      const forms = cat === 'pokemon' ? (bySpecies[baseName] || []) : [];

      // Collect forms with distinct type signatures (skip cosmetic-only suffixes)
      const seenSigs = new Set();
      const distinctForms = [];
      for (const f of forms) {
        const species = f.species_en_name || f.name_en;
        const suffix  = f.name_en !== species ? f.name_en.slice(species.length + 1) : '';
        if (suffix && SKIP_FORM_SUFFIXES.has(suffix)) continue;
        const sig = (f.types_en || []).slice().sort().join(',');
        if (!seenSigs.has(sig)) {
          seenSigs.add(sig);
          distinctForms.push(f);
        }
      }

      if (distinctForms.length > 1) {
        // Multiple distinct typings —create one entry per form
        for (const f of distinctForms) {
          const species = f.species_en_name || f.name_en;
          _searchIndex.push({
            category: cat,
            id,
            en:      prettifyFormName(f.name_en, species),
            ja:      e.ja      || '',
            ja_hrkt: e.ja_hrkt || '',
            zh:      f.name_zh || e.zh || '',
            db_key:  f.name_en,  // used for type lookup and sprite
          });
        }
      } else {
        // Single entry (base form or all forms same typing)
        _searchIndex.push({
          category: cat,
          id,
          en:      e.en      || '',
          ja:      e.ja      || '',
          ja_hrkt: e.ja_hrkt || '',
          zh:      e.zh      || '',
          db_key:  null,
        });
      }
    }
  }

  return _searchIndex;
}

/**
 * Search across all categories for an entry whose EN, JA, ZH, or db_key matches.
 * EN and db_key matching is case-insensitive.
 */
function searchEntry(query) {
  const q    = query.trim();
  const qLow = q.toLowerCase();
  const index = loadSearchIndex();
  return (
    index.find(e => e.en.toLowerCase() === qLow) ??
    index.find(e => e.db_key === qLow) ??
    index.find(e => e.ja === q) ??
    index.find(e => e.zh === q) ??
    index.find(e => e.en.toLowerCase().includes(qLow)) ??
    null
  );
}

function loadEtym() {
  if (_etym) return _etym;
  try { _etym = require(path.join(__dirname, '../../data/etymology.json')).pokemon || {}; }
  catch { _etym = {}; }
  return _etym;
}

function loadPokedexMap() {
  if (_pokedexMap) return _pokedexMap;
  const db = require(path.join(__dirname, '../../data/pokedex_db.json'));
  _pokedexMap = {};
  for (const entry of Object.values(db)) {
    if (!entry.name_en) continue;
    const val = { types_en: entry.types_en || [], types_zh: entry.types_zh || [] };
    // Index by full form name (e.g. "urshifu-single-strike")
    _pokedexMap[entry.name_en.toLowerCase()] = val;
    // Also index by bare species name (e.g. "urshifu") if not already set,
    // so trilingual entries that don't include the form suffix still match.
    if (entry.species_en_name && !_pokedexMap[entry.species_en_name.toLowerCase()]) {
      _pokedexMap[entry.species_en_name.toLowerCase()] = val;
    }
  }
  return _pokedexMap;
}

function randomEntry(category) {
  const data = loadVocabData();
  const pool = category === 'any'
    ? Object.values(data).flat()
    : (data[category] ?? data.pokemon);
  return pool[Math.floor(Math.random() * pool.length)];
}

function guessCategory(entry) {
  const data = loadVocabData();
  for (const [cat, pool] of Object.entries(data)) {
    if (pool.some(e => e.id === entry.id && e.en === entry.en)) return cat;
  }
  return 'pokemon';
}

function spriteUrl(entry) {
  // Use the form-specific db_key for the sprite when available (e.g. urshifu-rapid-strike)
  return `https://play.pokemonshowdown.com/sprites/home/${toID(entry.db_key ?? entry.en)}.png`;
}

// ── Type helpers ──────────────────────────────────────────────────────────────

/** Convert lowercase type from pokedex_db to Title-case used by TYPE_EMOJI / translateType */
function toTitleType(t) {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Render a list of types as "emoji Name" joined by spaces */
function typeList(types, lang) {
  return types.map(t => `${TYPE_EMOJI[t] ?? ''} ${translateType(t, lang)}`).join('  ');
}

// ── Embed builder ─────────────────────────────────────────────────────────────

const CATEGORY_COLOR = { pokemon: 0xEE1515, move: 0x4A90D9, item: 0xF5C518, ability: 0x57C87A, nature: 0xE67E22 };
const CATEGORY_LABEL = { pokemon: 'Pokémon', move: 'Move', item: 'Item', ability: 'Ability', nature: 'Nature' };

function buildVocabEmbed(entry, category) {
  const resolvedCat = category === 'any' ? guessCategory(entry) : category;
  const etymData    = resolvedCat === 'pokemon' ? (loadEtym()[entry.id] ?? {}) : {};
  const color       = CATEGORY_COLOR[resolvedCat] ?? 0xEE1515;
  const catLabel    = CATEGORY_LABEL[resolvedCat] ?? 'Pokémon';

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(entry.en)
    .setFooter({ text: `${catLabel}${/^\d+$/.test(entry.id) ? ` · #${entry.id.padStart(4, '0')}` : ''} · Pokémon Vocabulary` });

  if (resolvedCat === 'pokemon') embed.setThumbnail(spriteUrl(entry));

  // Trilingual names
  const nameLines = [];
  if (entry.ja) nameLines.push(`🇯🇵 **日本語** ${entry.ja}${entry.ja_hrkt ? ` (${entry.ja_hrkt})` : ''}`);
  if (entry.zh) nameLines.push(`🇹🇼 **繁體中文** ${entry.zh}`);
  if (nameLines.length) embed.setDescription(nameLines.join('\n'));

  // ── Type + weakness info (Pokémon only) ──────────────────────────────────────
  if (resolvedCat === 'pokemon') {
    const dexEntry = loadPokedexMap()[(entry.db_key ?? entry.en).toLowerCase()];
    if (dexEntry && dexEntry.types_en.length) {
      const titleTypes = dexEntry.types_en.map(toTitleType);

      const ja = t => `${TYPE_EMOJI[t] ?? ''} ${translateType(t, 'ja')}`;

      // Type row: emoji + JA name
      embed.addFields({ name: 'タイプ / 屬性', value: titleTypes.map(ja).join('   ') });

      // Matchups
      const matchups = calcTypeMatchups(titleTypes);

      if (matchups.weak4x.length) {
        embed.addFields({
          name: '4× 弱点 / 四倍弱點',
          value: matchups.weak4x.map(ja).join('  '),
        });
      }
      if (matchups.weak2x.length) {
        embed.addFields({
          name: '2× 弱点 / 弱點',
          value: matchups.weak2x.map(ja).join('  '),
        });
      }
      if (matchups.resist2x.length || matchups.resist4x.length) {
        const all = [
          ...matchups.resist4x.map(t => `${ja(t)} ¼`),
          ...matchups.resist2x.map(t => `${ja(t)} ½`),
        ];
        embed.addFields({ name: '耐性 / 抗性', value: all.join('  ') });
      }
      if (matchups.immune.length) {
        embed.addFields({
          name: '無効 / 免疫',
          value: matchups.immune.map(ja).join('  '),
        });
      }
    }
  }

  // Etymology —both EN and JA (Pokémon only)
  if (etymData.en) {
    const t = etymData.en;
    embed.addFields({ name: 'Etymology (EN)', value: t.length > 1024 ? t.slice(0, 1021) + '…' : t });
  }
  if (etymData.ja) {
    const t = etymData.ja;
    embed.addFields({ name: '語源 (JA)', value: t.length > 1024 ? t.slice(0, 1021) + '…' : t });
  }

  return embed;
}

function makeNextButton(category) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`vocab_next|${category}`)
      .setLabel('Next →')
      .setStyle(ButtonStyle.Primary),
  );
}

// ── Command definition ────────────────────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName('vocab')
    .setDescription('Look up or flash a random Pokémon vocabulary entry (EN / JA / ZH)')
    .addStringOption(o => o
      .setName('search')
      .setDescription('Search by any name —English, Japanese (ウーラオス), or Traditional Chinese (武道�E師)')
      .setAutocomplete(true))
    .addStringOption(o => o
      .setName('category')
      .setDescription('Filter by category —also narrows search autocomplete (default: Pokémon)')
      .addChoices(
        { name: 'Pokémon',  value: 'pokemon' },
        { name: 'Move',     value: 'move'    },
        { name: 'Item',     value: 'item'    },
        { name: 'Ability',  value: 'ability' },
        { name: 'Nature',   value: 'nature'  },
        { name: 'Any',      value: 'any'     },
      )),

  async execute(interaction) {
    const query    = interaction.options.getString('search');
    const category = interaction.options.getString('category') ?? 'pokemon';

    if (query) {
      const result = searchEntry(query);
      if (!result) {
        await interaction.reply({ content: `No entry found for **${query}**. Try the English, Japanese, or Traditional Chinese name.`, flags: 64 });
        return;
      }
      const embed = buildVocabEmbed(result, result.category);
      // Show a "Random →" button so they can keep going if they want
      await interaction.reply({ embeds: [embed], components: [makeNextButton(result.category)] });
      return;
    }

    const entry = randomEntry(category);
    const embed = buildVocabEmbed(entry, category);
    await interaction.reply({ embeds: [embed], components: [makeNextButton(category)] });
  },

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'search') { await interaction.respond([]); return; }

    const q        = focused.value;
    const qLow     = q.toLowerCase();
    const category = interaction.options.getString('category');
    const index    = loadSearchIndex();
    const pool     = (category && category !== 'any')
      ? index.filter(e => e.category === category)
      : index;

    // Separate into starts-with and contains buckets for each language
    const startEn  = [], startJa  = [], startZh  = [];
    const hasEn    = [], hasJa    = [], hasZh    = [];

    for (const e of pool) {
      const enLow = e.en.toLowerCase();
      if (enLow.startsWith(qLow))        startEn.push(e);
      else if (e.ja.startsWith(q))       startJa.push(e);
      else if (e.zh.startsWith(q))       startZh.push(e);
      else if (enLow.includes(qLow))     hasEn.push(e);
      else if (e.ja.includes(q))         hasJa.push(e);
      else if (e.zh.includes(q))         hasZh.push(e);
    }

    const ordered = [...startEn, ...startJa, ...startZh, ...hasEn, ...hasJa, ...hasZh];

    // Deduplicate by EN name and build Discord choices
    const seen    = new Set();
    const choices = [];
    for (const e of ordered) {
      if (choices.length >= 25) break;
      // Use db_key as value for form entries (e.g. "urshifu-rapid-strike"),
      // otherwise use the display EN name so searchEntry can find it.
      const value = e.db_key ?? e.en ?? e.ja ?? e.zh;
      if (seen.has(value)) continue;
      seen.add(value);

      // Display: all three names separated by em-dashes, capped at 100 chars
      const parts = [e.en, e.ja, e.zh].filter(Boolean).join(' — ');
      const name  = parts.length > 100 ? parts.slice(0, 99) + '…' : parts;
      choices.push({ name, value });
    }

    await interaction.respond(choices);
  },

  handleButton: async function(interaction) {
    const [, category] = interaction.customId.split('|');
    const cat   = category ?? 'pokemon';
    const entry = randomEntry(cat);
    const embed = buildVocabEmbed(entry, cat);
    await interaction.update({ embeds: [embed], components: [makeNextButton(cat)] });
  },
};
