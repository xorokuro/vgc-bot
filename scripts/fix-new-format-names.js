'use strict';

/**
 * Fix wrong card names in new-format sets (A2, A2a, A2b) caused by
 * position-based tcgdex matching when local file count > tcgdex card count.
 *
 * New-format files embed the Pokémon's name code in the filename:
 *   cPK_10_005370_00_UMIDIGDA_C_M_zh_TW_UT.png → code = UMIDIGDA → Wiglett
 *
 * This script:
 *   1. Extracts the name code from each new-format card's filename
 *   2. Looks up the correct English name from a hardcoded code→name table
 *   3. Looks up zh/ja from trilingual.json using the English name
 *   4. Updates only cards whose names differ from what the code says
 *
 * Run: node scripts/fix-new-format-names.js
 */

const fs   = require('fs');
const path = require('path');

const DB_PATH  = path.join(__dirname, '../data/ptcgp_cards.json');
const TRI_PATH = path.join(__dirname, '../data/trilingual.json');

// ── Name code → English Pokémon/card name ─────────────────────────────────────
// Keys are the exact strings in PTCGP image filenames (case-sensitive).
// Pokémon names must exactly match the English names in trilingual.json.
const CODE_TO_EN = {
  // ── Gen 1 ──────────────────────────────────────────────────────────────────
  'BEEDLE':         'Weedle',
  'COCOON':         'Kakuna',
  'SPEARex':        'Beedrill ex',
  'KAILIOS':        'Pinsir',
  'HITOKAGE':       'Charmander',
  'LIZARDO':        'Charmeleon',
  'LIZARDONex':     'Charizard ex',
  'MEWTWOex':       'Mewtwo ex',
  'BOOBER':         'Magmar',
  'BOOBURN':        'Magmortar',
  'ELEBOO':         'Electabuzz',
  'ELEKIBLE':       'Electivire',
  'MAGMAG':         'Slugma',
  'MAGCARGOT':      'Magcargo',
  'MENOKURAGE':     'Tentacool',
  'DOKUKURAGE':     'Tentacruel',
  'BIRIRIDAMA':     'Voltorb',
  'MARUMINE':       'Electrode',
  'COIL':           'Magnemite',
  'RARECOIL':       'Magneton',
  'JIBACOIL':       'Magnezone',
  'CASEY':          'Abra',
  'YUNGERER':       'Kadabra',
  'FOODIN':         'Alakazam',
  'WANRIKY':        'Machop',
  'GORIKY':         'Machoke',
  'KAIRIKY':        'Machamp',
  'BARRIERD':       'Mr. Mime',
  'KAPOERER':       'Hitmontop',
  'SAWAMULAR':      'Hitmonlee',
  'EBIWALAR':       'Hitmonchan',
  'ARBO':           'Ekans',
  'ARBOK':          'Arbok',
  'RAICHU':         'Raichu',
  'KORATTA':        'Rattata',
  'RATTA':          'Raticate',
  'PURIN':          'Jigglypuff',
  'PUKURIN':        'Wigglytuff',
  'BERORINGA':      'Lickitung',
  'BEROBELT':       'Lickilicky',
  'BEROBELTex':     'Lickilicky ex',
  'KABIGON':        'Snorlax',
  'NAZONOKUSA':     'Oddish',
  'KUSAIHANA':      'Gloom',
  'KIREIHANA':      'Bellossom',
  'MONJARA':        'Tangela',
  'MOJUMBO':        'Tangrowth',
  'RALTS':          'Ralts',
  'KIRLIA':         'Kirlia',
  'ERUREIDOex':     'Gallade ex',
  'AIRMD':          'Skarmory',
  'NYULA':          'Sneasel',
  'MANYULAex':      'Weavile ex',
  'DORAPION':       'Drapion',
  'SIHORN':         'Rhyhorn',
  'SIDON':          'Rhydon',
  'DOSIDON':        'Rhyperior',
  // ── Gen 2 ──────────────────────────────────────────────────────────────────
  'TOGEPY':         'Togepi',
  'TOGECHICK':      'Togetic',
  'TOGEKISS':       'Togekiss',
  'MUMA':           'Misdreavus',
  'MUMARGIex':      'Mismagius ex',
  'UNKNOWN':        'Unown',
  'USOKKIE':        'Sudowoodo',
  'MARIL':          'Marill',
  'MARILLI':        'Azumarill',
  'HOHO':           'Hoothoot',
  'YORUNOZUKU':     'Noctowl',
  'HELLGAR':        'Houndoom',
  'DELVIL':         'Houndour',
  'GLIGER':         'Gligar',
  'GLION':          'Gliscor',
  // ── Gen 3 ──────────────────────────────────────────────────────────────────
  'NOSEPASS':       'Nosepass',
  'DAINOSE':        'Probopass',
  'DAINOSEex':      'Probopass ex',
  'POCHIENA':       'Poochyena',
  'GRAENA':         'Mightyena',
  'ROSELIA':        'Roselia',
  'ROSERADE':       'Roserade',
  'KUCHEAT':        'Mawile',
  'MUSKIPPA':       'Carnivine',
  // ── Gen 4 ─────────────────────────────────────────────────────────────────
  'NAETLE':         'Turtwig',
  'HAYASHIGAME':    'Grotle',
  'DODAITOSE':      'Torterra',
  'HIKOZARU':       'Chimchar',
  'MOUKAZARU':      'Monferno',
  'GOUKAZARUex':    'Infernape ex',
  'POCHAMA':        'Piplup',
  'POTTAISHI':      'Prinplup',
  'EMPERTE':        'Empoleon',
  'MUKKURU':        'Starly',
  'MUKUBIRD':       'Staravia',
  'MUKUHAWK':       'Staraptor',
  'BIPPA':          'Bidoof',
  'BEADARU':        'Bibarel',
  'BEADARUex':      'Bibarel ex',
  'KOROBOHSHI':     'Kricketot',
  'KOROTOCK':       'Kricketune',
  'BUOYSEL':        'Buizel',
  'FLOAZEL':        'Floatzel',
  'KARANAKUSHI':    'Shellos',
  'TRITODON':       'Gastrodon',
  'CHERINBO':       'Cherubi',
  'CHERRIM':        'Cherrim',
  'FUWANTE':        'Drifloon',
  'FUWARIDE':       'Drifblim',
  'EIPAM':          'Aipom',
  'ETEBOTH':        'Ambipom',
  'MINOMUCCHI':     'Burmy',
  'MINOMADAMKUSAKINOMINO': 'Wormadam',
  'MINOMADAMSUNACHINOMINO': 'Wormadam',
  'MINOMADAMGOMINOMINO': 'Wormadam',
  'GAMALE':         'Mothim',
  'MITSUHONEY':     'Combee',
  'BEEQUEN':        'Vespiquen',
  'EIEVUI':         'Eevee',
  'LEAFIA':         'Leafeon',
  'LEAFIAex':       'Leafeon ex',
  'GLACIA':         'Glaceon',
  'GLACIAex':       'Glaceon ex',
  'DOHMIRROR':      'Bronzor',
  'DOHTAKUN':       'Bronzong',
  'KOLINK':         'Shinx',
  'LUXIO':          'Luxio',
  'RENTORAR':       'Luxray',
  'RAKURAI':        'Electrike',
  'LIVOLT':         'Manectric',
  'YANYANMA':       'Yanma',
  'MEGAYANMAex':    'Yanmega ex',
  'MANAPHY':        'Manaphy',
  'PHIONE':         'Phione',
  'SHAYMIN':        'Shaymin',
  'ROTOM':          'Rotom',
  'FUKAMARU':       'Gible',
  'GABITE':         'Gabite',
  'GABURIAS':       'Garchomp',
  'GABURIASex':     'Garchomp ex',
  'LUCARIO':        'Lucario',
  'LUCARIOex':      'Lucario ex',
  'RIOLU':          'Riolu',
  'HEATRAN':        'Heatran',
  'REGICE':         'Regice',
  'REGIROCK':       'Regirock',
  'REGISTEEL':      'Registeel',
  'REGIGIGAS':      'Regigigas',
  'YOMAWARU':       'Duskull',
  'SAMAYOURU':      'Dusclops',
  'YONOIR':         'Dusknoir',
  'GHOS':           'Gastly',
  'GHOST':          'Haunter',
  'GANGAR':         'Gengar',
  'HIPOPOTAS':      'Hippopotas',
  'HIPPOPOTAS':     'Hippopotas',
  'KABALDON':       'Hippowdon',
  'RAMPALD':        'Rampardos',
  'ZUGAIDOS':       'Cranidos',
  'TORIDEPS':       'Bastiodon',
  'TATETOPS':       'Shieldon',
  'URIMOO':         'Swinub',
  'INOMOO':         'Piloswine',
  'MAMMOO':         'Mamoswine',
  'PIPPI':          'Clefairy',
  'PIXY':           'Clefable',
  'PIKACHU':        'Pikachu',
  'PIKACHUex':      'Pikachu ex',
  'PACHIRISUex':    'Pachirisu ex',
  'PORYGON':        'Porygon',
  'PORYGON2':       'Porygon2',
  'PERAP':          'Chatot',
  'NYARMAR':        'Glameow',
  'BUNYATTO':       'Purugly',
  'MIMIROL':        'Buneary',
  'MIMILOP':        'Lopunny',
  'HERACROS':       'Heracross',
  'SCORUPI':        'Skorupi',
  'DOKUROG':        'Toxicroak',
  'GUREGGRU':       'Croagunk',
  'KEIKOUO':        'Finneon',
  'NEOLANT':        'Lumineon',
  'GOLBAT':         'Golbat',
  'CROBAT':         'Crobat',
  'ZUBAT':          'Zubat',
  'YUKIKABURI':     'Snover',
  'YUKINOOH':       'Abomasnow',
  'SKUNPUU':        'Stunky',
  'SKUTANK':        'Skuntank',
  'ASANAN':         'Meditite',
  'CHAREM':         'Medicham',
  'MIKARUGE':       'Spiritomb',
  'DONGKARASU':     'Honchkrow',
  'YAMIKARASU':     'Murkrow',
  'AGNOM':          'Azelf',
  'AGNOME':         'Azelf',
  'EMRIT':          'Mesprit',
  'YUXIE':          'Uxie',
  'CRESSELIA':      'Cresselia',
  'CRESSELIAex':    'Cresselia ex',
  'DARKRAI':        'Darkrai',
  'DARKRAIex':      'Darkrai ex',
  'ARCEUS':         'Arceus',
  'ARCEUSex':       'Arceus ex',
  'DIALGA':         'Dialga',
  'DIALGAex':       'Dialga ex',
  'ORIGINDIALGA':   'Origin Forme Dialga',
  'PALKIA':         'Palkia',
  'PALKIAex':       'Palkia ex',
  'ORIGINPALKIA':   'Origin Forme Palkia',
  'GIRATINA':       'Giratina',
  'GIRATINAex':     'Giratina ex',
  'ORIGINGIRATINA': 'Giratina',
  'MISMAGIUS':      'Mismagius',
  'ROSERADE':       'Roserade',
  'TOGEKISS':       'Togekiss',
  'PACHIRISU':      'Pachirisu',
  'DOJOACH':        'Barboach',
  'NAMAZUN':        'Whiscash',
  'SANAGIRAS':      'Pupitar',
  'YOGIRAS':        'Larvitar',
  'BANGIRAS':       'Tyranitar',
  'GOMAZOU':        'Phanpy',
  'DONFAN':         'Donphan',
  'KABIGON':        'Snorlax',
  'YUKIMENOKO':     'Froslass',
  'YUKIWARASHI':    'Snorunt',
  'NYULA':          'Sneasel',
  // ── Gen 5+ / Misc ──────────────────────────────────────────────────────────
  // ── Gen 9 / Paldea ─────────────────────────────────────────────────────────
  'NYAHOJA':        'Sprigatito',
  'NYAROTE':        'Floragato',
  'MASQUERNYA':     'Meowscarada',
  'MOTOTOKAGE':     'Cyclizar',
  'UMIDIGDA':       'Wiglett',
  'UMITRIOex':      'Wugtrio ex',
  'HEYRUSHER':      'Dondozo',
  'SYARITATSU':     'Tatsugiri',
  'PAMO':           'Pawmi',
  'PAMOT':          'Pawmo',
  'PARMOT':         'Pawmot',
  'PALDEAKENTAUROS':'Paldean Tauros',
  'PALDEAUPAH':     'Paldean Wooper',
  'PALDEADOOHex':   'Paldean Clodsire ex',
  'COLLECUREI':     'Gimmighoul',
  'KARAMINGO':      'Flamigo',
  'SHIRUSHREW':     'Shroodle',
  'TAGGINGRU':      'Grafaiai',
  'KANUCHAN':       'Tinkatink',
  'NAKANUCHAN':     'Tinkatuff',
  'DEKANUCHANex':   'Tinkaton ex',
  'BURORON':        'Varoom',
  'BUROROROOM':     'Revavroom',
  'SURFUGO':        'Gholdengo',
  'KORATTA':        'Rattata',   // Gen 1 in A2b context
  'RATTA':          'Raticate',  // Gen 1 in A2b context
  'PURIN':          'Jigglypuff',
  'PUKURIN':        'Wigglytuff',
  'BERORINGA':      'Lickitung',
  'PURIN':          'Jigglypuff',
  // ── Trainers & Items ───────────────────────────────────────────────────────
  'AKAGI':          'Cyrus',
  'SHIRONA':        'Cynthia',
  'HIKARI':         'Dawn',
  'MARS':           'Mars',
  'DENZI':          'Volkner',
  'JUN':            'Barry',
  'IRIDA':          'Irida',
  'SEKI':           'Red',        // Red (Trainer from Gen 2; Japanese name = セキ)
  'RED':            'Red',
  'NANJYAMO':       'Iono',
  'GINGADANNOSHITAPPA':   'Team Galactic Grunt',
  'ROCKETDANNOSHITAPPA':  'Team Rocket Grunt',
  'POKEMONCENTERNOONEESAN': 'Pokémon Center Lady',
  'KANNAGITOWNNOTYOUROU': 'Celestic Town Elder',
  'POKEMONTSUUSHIN':      'Pokémon Communication',
  'OOKINAMANTO':          'Giant Cape',
  'GOTSUGOTSUMETTO':      'Rocky Helmet',
  'RAMUNOMI':             'Lum Berry',
  'TATENOKASEKI':         'Armor Fossil',
  'ZUGAINOKASEKI':        'Skull Fossil',
  'MONSTERBALL':          'Poké Ball',
  // Trainer characters (not in trilingual.json — zh/ja will be set by enrich-ptcgp-zh-trainer.js)
  'KAI':            'Irida',
  'SEKI':           'Adaman',
};

// ── Trilingual lookup ─────────────────────────────────────────────────────────

function buildTrilingualLookup(triPath) {
  const data = JSON.parse(fs.readFileSync(triPath, 'utf8'));
  const map  = new Map();
  // Pokémon
  for (const entry of Object.values(data.pokemon ?? {})) {
    const en = (entry.en ?? '').trim();
    if (en) map.set(en.toLowerCase(), { zh: entry.zh ?? '', ja: entry.ja ?? '' });
  }
  // Trainers / items stored under other keys
  for (const section of ['item', 'move', 'ability']) {
    for (const entry of Object.values(data[section] ?? {})) {
      const en = (entry.en ?? '').trim();
      if (en && !map.has(en.toLowerCase())) {
        map.set(en.toLowerCase(), { zh: entry.zh ?? '', ja: entry.ja ?? '' });
      }
    }
  }
  return map;
}

// ── Extract name code from new-format filename ────────────────────────────────

function extractCode(filename) {
  // cPK_10_005370_00_UMIDIGDA_C_M_zh_TW_UT.png
  const m = filename.match(/^c(?:PK|TR)_\d+_\d+_\d+_([A-Za-z0-9]+)_/);
  return m ? m[1] : null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  const db  = JSON.parse(raw);

  const triLookup = buildTrilingualLookup(TRI_PATH);
  console.log(`Loaded ${triLookup.size} entries from trilingual.json`);

  const TARGET_SETS = new Set(['A2', 'A2a', 'A2b']);
  let updated = 0, noCode = 0, noName = 0;
  const statsBySet = {};

  for (const card of db.cards) {
    if (!TARGET_SETS.has(card.set)) continue;

    const imgPath  = card.images?.zh_TW ?? Object.values(card.images ?? {})[0] ?? '';
    const filename = path.basename(imgPath);
    if (!filename.startsWith('c')) { noCode++; continue; }

    const code = extractCode(filename);
    if (!code) { noCode++; continue; }

    const correctEn = CODE_TO_EN[code];
    if (!correctEn) { noName++; continue; }

    // Look up zh/ja from trilingual
    const tri = triLookup.get(correctEn.toLowerCase()) ?? {};

    let changed = false;
    const enChanged = card.names.en !== correctEn;
    if (enChanged) { card.names.en = correctEn; changed = true; }
    if (tri.zh) {
      if (card.names.zh !== tri.zh) { card.names.zh = tri.zh; changed = true; }
    } else if (enChanged && card.names.zh) {
      // No trilingual match (trainer character) — clear stale zh from positional mismatch
      card.names.zh = ''; changed = true;
    }
    if (tri.ja) {
      if (card.names.ja !== tri.ja) { card.names.ja = tri.ja; changed = true; }
    } else if (enChanged && card.names.ja) {
      card.names.ja = ''; changed = true;
    }

    if (changed) {
      updated++;
      if (!statsBySet[card.set]) statsBySet[card.set] = 0;
      statsBySet[card.set]++;
    }
  }

  console.log(`\nUpdated ${updated} cards:`);
  for (const [set, count] of Object.entries(statsBySet)) {
    console.log(`  ${set}: ${count}`);
  }
  console.log(`  Skipped (no code): ${noCode}`);
  console.log(`  Skipped (unknown code): ${noName}`);

  // Report remaining unknown codes (help user add missing entries)
  const unknownCodes = new Map();
  for (const card of db.cards) {
    if (!TARGET_SETS.has(card.set)) continue;
    const filename = path.basename(card.images?.zh_TW ?? '');
    if (!filename.startsWith('c')) continue;
    const code = extractCode(filename);
    if (code && !CODE_TO_EN[code]) {
      const gidm = filename.match(/_(\d{6})_/);
      const key  = code + '|gid=' + (gidm?.[1] ?? '?') + '|set=' + card.set;
      unknownCodes.set(key, card.names.en);
    }
  }
  if (unknownCodes.size > 0) {
    console.log(`\n⚠  ${unknownCodes.size} unknown name codes (not fixed):`);
    for (const [key, dbEn] of unknownCodes) {
      console.log(`  ${key} | current_en="${dbEn}"`);
    }
  }

  db.generated = new Date().toISOString();
  fs.writeFileSync(DB_PATH, JSON.stringify(db));
  console.log('\n✅  Saved. Now re-run enrich-a4b-from-globalid.js to fix A4b.');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
