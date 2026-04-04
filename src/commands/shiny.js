'use strict';

const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const https = require('https');
const sharp = require('sharp');
const path  = require('path');

const SPRITE_SIZE = 160;
const GAP         = 24;
const FETCH_TIMEOUT = 5000;

// ── HTTP helper ───────────────────────────────────────────────────────────────
function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'PokemonBot/1.0' } }, res => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end',  () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
    req.setTimeout(FETCH_TIMEOUT, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function fetchResized(url) {
  const buf = await fetchBuffer(url);
  return sharp(buf)
    .resize(SPRITE_SIZE, SPRITE_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

// ── Pokémon search (simplified, reads same trilingual.json as /vocab) ─────────
let _index = null;

function loadIndex() {
  if (_index) return _index;
  const tri = require(path.join(__dirname, '../../data/trilingual.json'));
  _index = Object.entries(tri.pokemon || {}).map(([id, e]) => ({
    id,
    en:      e.en      || '',
    ja:      e.ja      || '',
    ja_hrkt: e.ja_hrkt || '',
    zh:      e.zh      || '',
  }));
  return _index;
}

function searchPokemon(query) {
  const q    = query.trim();
  const qLow = q.toLowerCase();
  const idx  = loadIndex();
  return (
    idx.find(e => e.en.toLowerCase() === qLow) ??
    idx.find(e => e.ja === q)                   ??
    idx.find(e => e.zh === q)                   ??
    idx.find(e => e.en.toLowerCase().includes(qLow)) ??
    idx.find(e => e.ja.includes(q))             ??
    idx.find(e => e.zh.includes(q))             ??
    null
  );
}

// Convert English name to PokémonShowdown sprite ID
// e.g. "Mr. Mime" → "mrmime", "Flabébé" → "flabebe"
function toSpriteId(name) {
  return name.toLowerCase()
    .replace(/[éèê]/g, 'e')
    .replace(/[àâ]/g,  'a')
    .replace(/[ùû]/g,  'u')
    .replace(/[^a-z0-9]/g, '');
}

// ── Command ───────────────────────────────────────────────────────────────────
module.exports = {
  data: new SlashCommandBuilder()
    .setName('shiny')
    .setDescription('顯示寶可夢的普通和異色（Shiny）形態 / Normal vs shiny sprite comparison')
    .addStringOption(o => o
      .setName('pokemon')
      .setDescription('寶可夢名稱（中文、日文、英文均可）')
      .setRequired(true)
      .setAutocomplete(true))
    .addStringOption(o => o
      .setName('lang')
      .setDescription('顯示語言 / Display language (預設：繁體中文)')
      .addChoices(
        { name: '繁體中文', value: 'zh' },
        { name: 'English',  value: 'en' },
        { name: '日本語',   value: 'ja' },
      ))
    .addBooleanOption(o => o
      .setName('public')
      .setDescription('公開顯示 / Show publicly (預設：僅自己可見)')),

  async execute(interaction) {
    const query = interaction.options.getString('pokemon');
    const lang  = interaction.options.getString('lang') ?? 'zh';
    const pub   = interaction.options.getBoolean('public') ?? false;
    const entry = searchPokemon(query);

    const notFound = lang === 'en' ? 'Not found' : lang === 'ja' ? '見つかりません' : '找不到';
    if (!entry) {
      await interaction.reply({ content: `❌ ${notFound}: **${query}**`, flags: 64 });
      return;
    }

    await interaction.deferReply({ flags: pub ? undefined : 64 });

    const id        = toSpriteId(entry.en);
    const normalUrl = `https://play.pokemonshowdown.com/sprites/home/${id}.png`;
    const shinyUrl  = `https://play.pokemonshowdown.com/sprites/home-shiny/${id}.png`;

    let normalBuf, shinyBuf;
    try {
      [normalBuf, shinyBuf] = await Promise.all([
        fetchResized(normalUrl),
        fetchResized(shinyUrl),
      ]);
    } catch {
      const noImg = lang === 'en'
        ? `❌ Could not fetch sprite for **${entry.en}**. HOME sprite may be unavailable.`
        : lang === 'ja'
        ? `❌ **${entry.ja || entry.en}** のスプライトを取得できませんでした。`
        : `❌ 無法取得 **${entry.zh || entry.en}** 的圖片，可能該寶可夢暫時沒有 HOME 圖片。`;
      await interaction.editReply({ content: noImg });
      return;
    }

    // Composite normal + shiny side by side
    const totalWidth = SPRITE_SIZE * 2 + GAP;
    const composite  = await sharp({
      create: {
        width: totalWidth, height: SPRITE_SIZE,
        channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([
        { input: normalBuf, left: 0,                top: 0 },
        { input: shinyBuf,  left: SPRITE_SIZE + GAP, top: 0 },
      ])
      .png()
      .toBuffer();

    const file = new AttachmentBuilder(composite, { name: 'shiny.png' });

    const title = lang === 'zh'
      ? `✨ ${entry.zh || entry.en}  /  ${entry.en}`
      : lang === 'ja'
      ? `✨ ${entry.ja || entry.en}  /  ${entry.zh || entry.en}`
      : `✨ ${entry.en}  /  ${entry.zh || ''}`.replace(/  \/$/, '');

    const footer = lang === 'en' ? 'Left: Normal  |  Right: Shiny'
                 : lang === 'ja' ? '左：通常形態　|　右：色違い'
                 :                 '左：通常形態　|　右：異色形態';

    const desc = lang === 'ja'
      ? [entry.ja, entry.ja_hrkt ? `(${entry.ja_hrkt})` : ''].filter(Boolean).join(' ')
      : lang === 'en'
      ? (entry.zh ? `ZH: ${entry.zh}` : '')
      : [entry.ja, entry.ja_hrkt ? `(${entry.ja_hrkt})` : ''].filter(Boolean).join(' ');

    const embed = new EmbedBuilder()
      .setColor(0xFFD700)
      .setTitle(title)
      .setImage('attachment://shiny.png')
      .setFooter({ text: footer });

    if (desc) embed.setDescription(desc);

    await interaction.editReply({ embeds: [embed], files: [file] });
  },

  // ── Autocomplete ─────────────────────────────────────────────────────────────
  async autocomplete(interaction) {
    const q    = interaction.options.getFocused().trim();
    const qLow = q.toLowerCase();
    const idx  = loadIndex();

    const startZh = [], startEn = [], startJa = [];
    const hasZh   = [], hasEn   = [], hasJa   = [];

    for (const e of idx) {
      if (e.zh.startsWith(q))              startZh.push(e);
      else if (e.en.toLowerCase().startsWith(qLow)) startEn.push(e);
      else if (e.ja.startsWith(q))         startJa.push(e);
      else if (e.zh.includes(q))           hasZh.push(e);
      else if (e.en.toLowerCase().includes(qLow))  hasEn.push(e);
      else if (e.ja.includes(q))           hasJa.push(e);
    }

    const ordered = [...startZh, ...startEn, ...startJa, ...hasZh, ...hasEn, ...hasJa];
    const choices = ordered.slice(0, 25).map(e => ({
      name:  `${e.zh}  ${e.en}`.slice(0, 100),
      value: e.en,
    }));

    await interaction.respond(choices);
  },
};
