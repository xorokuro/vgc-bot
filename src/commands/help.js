'use strict';

/**
 * /help — Browse all bot commands, organized by category.
 *
 * Views:  all (overview) | vgc (detailed) | ptcgp (detailed)
 * Button: help|{view}|{lang}
 */

const {
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');

const VALID_LANGS = new Set(['zh', 'en', 'ja']);
const COLOR_VGC   = 0xE8534A;   // red-ish for VGC
const COLOR_PTCGP = 0x4A90D9;   // blue-ish for PTCGP
const COLOR_ALL   = 0x5865F2;   // discord blurple for overview

// ── Command data ──────────────────────────────────────────────────────────────
const COMMANDS = {
  vgc: [
    {
      cmd: '/teams',
      zh: {
        desc:   '瀏覽 VGC 隊伍分享文章（pokedb.tokyo）',
        detail: '依賽季與賽制篩選，下拉選單快速預覽隊伍配置圖',
        params: 'game · format · season · page · lang',
      },
      en: {
        desc:   'Browse VGC team articles (pokedb.tokyo)',
        detail: 'Filter by season & format; preview team sprites from the dropdown',
        params: 'game · format · season · page · lang',
      },
      ja: {
        desc:   'VGC チーム記事を閲覧（pokedb.tokyo）',
        detail: 'シーズン・ルールで絞り込み、ドロップダウンでチームをプレビュー',
        params: 'game · format · season · page · lang',
      },
    },
    {
      cmd: '/team_search',
      zh: {
        desc:   '搜尋含有指定寶可夢的 VGC 隊伍',
        detail: '最多可指定 3 隻必須含有的寶可夢（AND），並可排除特定寶可夢',
        params: 'pokemon1~3 · exclude · game · format · season · lang',
      },
      en: {
        desc:   'Search VGC teams by Pokémon (include & exclude)',
        detail: 'Up to 3 required Pokémon (AND logic) + optional exclude',
        params: 'pokemon1~3 · exclude · game · format · season · lang',
      },
      ja: {
        desc:   '指定ポケモンを含むVGCチームを検索',
        detail: '最大3匹のAND検索＋特定ポケモンの除外指定',
        params: 'pokemon1~3 · exclude · game · format · season · lang',
      },
    },
    {
      cmd: '/top',
      zh: {
        desc:   'Pokémon HOME 賽季使用率 Top 150',
        detail: '查看雙打 / 單打的使用率排行榜，附精靈圖一覽',
        params: 'format · season · lang',
      },
      en: {
        desc:   'Pokémon HOME season usage Top 150',
        detail: 'Doubles / singles usage ranking with sprites',
        params: 'format · season · lang',
      },
      ja: {
        desc:   'Pokémon HOME シーズン使用率 Top 150',
        detail: 'ダブル / シングルの使用率ランキング（スプライト一覧付き）',
        params: 'format · season · lang',
      },
    },
    {
      cmd: '/usage',
      zh: {
        desc:   '查詢個別寶可夢的使用率詳情',
        detail: '顯示招式、道具、特性、夥伴的使用率分布（Pokémon HOME 數據）',
        params: 'season · pokemon · format · lang',
      },
      en: {
        desc:   'Individual Pokémon usage breakdown from HOME',
        detail: 'Move / item / ability / partner usage percentages',
        params: 'season · pokemon · format · lang',
      },
      ja: {
        desc:   '個別ポケモンの使用率詳細（Pokémon HOME）',
        detail: '技・持ち物・特性・パートナーの使用率内訳',
        params: 'season · pokemon · format · lang',
      },
    },
    {
      cmd: '/pokedex',
      zh: {
        desc:   '查詢寶可夢種族值、招式列表、特性',
        detail: '支援朱紫 SV（含 DLC），顯示完整圖鑑資料與精靈圖',
        params: 'game · pokemon · lang · public',
      },
      en: {
        desc:   'Pokémon stats, move list & abilities',
        detail: 'Supports SV + DLC; shows full Pokédex entry with sprite',
        params: 'game · pokemon · lang · public',
      },
      ja: {
        desc:   'ポケモンの種族値・技リスト・特性を表示',
        detail: 'SV＋DLC対応、フル図鑑データ＋スプライト',
        params: 'game · pokemon · lang · public',
      },
    },
    {
      cmd: '/pokemon_search',
      zh: {
        desc:   '依屬性、種族值、招式、特性篩選寶可夢',
        detail: '支援複雜查詢，例如：`火系 AND 速度>=100 AND NOT 龍系`',
        params: 'game · query · show_stats · lang · public',
      },
      en: {
        desc:   'Filter Pokémon by type, stats, moves, or abilities',
        detail: 'Supports complex queries, e.g. `Fire AND speed>=100 AND NOT Dragon`',
        params: 'game · query · show_stats · lang · public',
      },
      ja: {
        desc:   'タイプ・種族値・技・特性でポケモンを絞り込む',
        detail: '複合クエリ対応：例 `炎 AND 素早さ>=100 AND NOT ドラゴン`',
        params: 'game · query · show_stats · lang · public',
      },
    },
    {
      cmd: '/search_misc',
      zh: {
        desc:   '搜尋招式、特性或道具的詳細資訊',
        detail: '支援朱紫 SV 及 PLZA，可用中文、日文或英文查詢',
        params: 'category · query · lang · public',
      },
      en: {
        desc:   'Look up moves, abilities, or items (SV & PLZA)',
        detail: 'Search in zh / ja / en; shows effect, power, PP, and more',
        params: 'category · query · lang · public',
      },
      ja: {
        desc:   '技・特性・持ち物の詳細情報を検索（SV & PLZA）',
        detail: '中文・日本語・英語で検索可能',
        params: 'category · query · lang · public',
      },
    },
    {
      cmd: '/shiny',
      zh: {
        desc:   '並排顯示寶可夢普通 vs 異色（Shiny）精靈圖',
        detail: '快速視覺化比較任意寶可夢的普通與異色外觀',
        params: 'pokemon · lang · public',
      },
      en: {
        desc:   'Normal vs shiny sprite side-by-side comparison',
        detail: 'Visual comparison for any Pokémon form',
        params: 'pokemon · lang · public',
      },
      ja: {
        desc:   '通常と色違いスプライトを並べて比較',
        detail: 'どのポケモンでも通常・色違いを横並びで表示',
        params: 'pokemon · lang · public',
      },
    },
    {
      cmd: '/calc battle',
      zh: {
        desc:   'Gen 9 傷害計算機',
        detail: '支援天氣、場地、強化手、EV、道具、特性、太晶化等全參數',
        params: 'attacker · defender · move · [天氣/場地/EV/道具/特性…]',
      },
      en: {
        desc:   'Gen 9 damage calculator',
        detail: 'Full support: weather, terrain, helping hand, EVs, items, abilities, Tera',
        params: 'attacker · defender · move · [weather/terrain/EVs/item/ability…]',
      },
      ja: {
        desc:   'Gen 9 ダメージ計算機',
        detail: '天候・地形・テラ・EV・持ち物・特性など全パラメータ対応',
        params: 'attacker · defender · move · [天候/地形/EV/持ち物/特性…]',
      },
    },
    {
      cmd: '/meta random',
      zh: {
        desc:   '隨機傷害計算（Pokémon HOME 真實 Meta 配置）',
        detail: '從 HOME 雙打使用率數據中隨機抽取真實攻守組合進行計算',
        params: 'format · stat_changes · lang',
      },
      en: {
        desc:   'Random damage calc using real HOME meta sets',
        detail: 'Randomly pulls attacker / move / defender from HOME usage data',
        params: 'format · stat_changes · lang',
      },
      ja: {
        desc:   'HOMEメタ実構成でランダムダメージ計算',
        detail: 'HOME使用率データからランダムに攻撃・防御ポケモンを選出',
        params: 'format · stat_changes · lang',
      },
    },
    {
      cmd: '/meta guess',
      zh: {
        desc:   '猜傷害小遊戲（Pokémon HOME 真實 Meta 配置）',
        detail: '從真實 Meta 生成傷害情境，猜對傷害區間才顯示完整計算結果',
        params: 'format · stat_changes · lang',
      },
      en: {
        desc:   'Guess-the-damage game using real HOME meta sets',
        detail: 'Guess the damage range to reveal the full calculation',
        params: 'format · stat_changes · lang',
      },
      ja: {
        desc:   'HOMEメタ実構成でダメージ当てゲーム',
        detail: 'ダメージ範囲を当てると全情報が公開される',
        params: 'format · stat_changes · lang',
      },
    },
    {
      cmd: '/vocab',
      zh: {
        desc:   '三語（繁中／英文／日文）寶可夢詞典',
        detail: '查詢寶可夢、招式、道具的三語對照；無輸入時隨機顯示一筆',
        params: 'search · category',
      },
      en: {
        desc:   'Trilingual Pokémon vocabulary (ZH / EN / JA)',
        detail: 'Look up any Pokémon, move, or item across all three languages; random if empty',
        params: 'search · category',
      },
      ja: {
        desc:   '三言語（繁中・英語・日本語）ポケモン辞典',
        detail: 'ポケモン・技・持ち物を三言語で対照表示、空欄でランダム表示',
        params: 'search · category',
      },
    },
  ],

  ptcgp: [
    {
      cmd: '/search_card',
      zh: {
        desc:   '搜尋 PTCGP 卡牌（名稱、UID 或條件式）',
        detail: '支援中英日名稱，或使用篩選式：`hp >= 100 AND type = Fire`',
        params: 'query · display',
      },
      en: {
        desc:   'Search PTCGP cards by name, UID, or filter expression',
        detail: 'Supports zh/ja/en names or filter syntax: `hp >= 100 AND type = Fire`',
        params: 'query · display',
      },
      ja: {
        desc:   'PTCGP カードを名前・UID・条件式で検索',
        detail: '中英日名称、またはフィルター式（`hp >= 100 AND type = Fire`）で検索',
        params: 'query · display',
      },
    },
    {
      cmd: '/expansion',
      zh: {
        desc:   '瀏覽 PTCGP 擴充包完整卡表',
        detail: '輸入擴充包代碼（如 A2、B2b）查看所有卡牌，附卡圖翻頁瀏覽',
        params: 'set · display',
      },
      en: {
        desc:   'Browse a PTCGP expansion\'s full card list',
        detail: 'Enter a set code (e.g. A2, B2b) to view all cards with images',
        params: 'set · display',
      },
      ja: {
        desc:   'PTCGP 拡張パックのカードリストを閲覧',
        detail: 'セットコード（A2・B2bなど）を入力してカード一覧＋画像を表示',
        params: 'set · display',
      },
    },
    {
      cmd: '/meta_pocket',
      zh: {
        desc:   '查看 PTCGP 當前強勢牌組（Limitless TCG）',
        detail: '顯示各牌組的勝率、流行度及代表卡牌圖片',
        params: 'set · lang',
      },
      en: {
        desc:   'Browse PTCGP meta decks (Limitless TCG)',
        detail: 'Shows win rate, popularity, and key card images for each deck',
        params: 'set · lang',
      },
      ja: {
        desc:   'PTCGP 現環境デッキを確認（Limitless TCG）',
        detail: '各デッキの勝率・人気度・代表カード画像を表示',
        params: 'set · lang',
      },
    },
    {
      cmd: '/card_meta',
      zh: {
        desc:   '查找含有某張卡的主流牌組',
        detail: '輸入卡名或 UID，顯示所有使用這張卡的主流牌組清單',
        params: 'card · set · display',
      },
      en: {
        desc:   'Find meta decks that include a specific card',
        detail: 'Enter a card name or UID to see which meta decks run it',
        params: 'card · set · display',
      },
      ja: {
        desc:   '特定カードを採用しているメタデッキを検索',
        detail: 'カード名またはUIDを入力して使用デッキ一覧を表示',
        params: 'card · set · display',
      },
    },
    {
      cmd: '/deck_search',
      zh: {
        desc:   '搜尋含有特定卡牌組合的主流牌組',
        detail: '最多 3 張必須含有的卡（AND），可額外指定排除的卡',
        params: 'card1~3 · exclude · set · display · public',
      },
      en: {
        desc:   'Find meta decks with a specific combination of cards',
        detail: 'Up to 3 required cards (AND logic) + optional exclude',
        params: 'card1~3 · exclude · set · display · public',
      },
      ja: {
        desc:   '特定のカード組み合わせを含むメタデッキを検索',
        detail: '最大3枚の必須カード（AND）＋除外カード指定も可能',
        params: 'card1~3 · exclude · set · display · public',
      },
    },
  ],
};

// ── Localised UI strings ──────────────────────────────────────────────────────
const T = {
  title:       { zh: '📖 指令說明',           en: '📖 Command Guide',         ja: '📖 コマンドガイド'      },
  vgcHead:     { zh: '🎮 VGC 主系列寶可夢',   en: '🎮 VGC / Main Series',     ja: '🎮 VGC / メインシリーズ' },
  ptcgpHead:   { zh: '🃏 PTCGP 集換式卡牌',   en: '🃏 PTCGP Card Game',       ja: '🃏 PTCGP カードゲーム'  },
  btnAll:      { zh: '📋 全部指令',            en: '📋 All Commands',          ja: '📋 全コマンド'          },
  btnVGC:      { zh: '🎮 VGC 主系列',          en: '🎮 VGC / Main Series',     ja: '🎮 VGC / メイン'        },
  btnPTCGP:    { zh: '🃏 PTCGP 卡牌',          en: '🃏 PTCGP',                 ja: '🃏 PTCGP'              },
  paramsLabel: { zh: '參數',                   en: 'Options',                  ja: 'オプション'             },
  footer:      {
    zh: '大多數指令支援 lang 選項（繁中 / English / 日本語）· 選項均有自動補全',
    en: 'Most commands have a lang option (zh / en / ja) · All options support autocomplete',
    ja: 'ほとんどのコマンドは lang オプション対応（zh / en / ja）· オートコンプリート対応',
  },
};
const t = (key, lang) => T[key][lang] ?? T[key].zh;

// ── Overview embed (all commands, compact one-liner each) ─────────────────────
function buildOverviewEmbed(lang) {
  const vgcLines   = COMMANDS.vgc.map(c =>   `\`${c.cmd}\`  ${c[lang].desc}`).join('\n');
  const ptcgpLines = COMMANDS.ptcgp.map(c => `\`${c.cmd}\`  ${c[lang].desc}`).join('\n');

  return new EmbedBuilder()
    .setColor(COLOR_ALL)
    .setTitle(t('title', lang))
    .addFields(
      { name: t('vgcHead', lang),   value: vgcLines,   inline: false },
      { name: t('ptcgpHead', lang), value: ptcgpLines, inline: false },
    )
    .setFooter({ text: t('footer', lang) });
}

// ── Detailed category embed (one field per command) ───────────────────────────
function buildCategoryEmbed(category, lang) {
  const cmds  = COMMANDS[category];
  const head  = t(category === 'vgc' ? 'vgcHead' : 'ptcgpHead', lang);
  const color = category === 'vgc' ? COLOR_VGC : COLOR_PTCGP;
  const pLbl  = t('paramsLabel', lang);

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${t('title', lang)}  ·  ${head}`)
    .setFooter({ text: t('footer', lang) });

  for (const c of cmds) {
    const { desc, detail, params } = c[lang];
    embed.addFields({
      name:  `\`${c.cmd}\``,
      value: `${desc}\n${detail}\n-# ⚙️ ${pLbl}: ${params}`,
      inline: false,
    });
  }
  return embed;
}

// ── Navigation buttons ────────────────────────────────────────────────────────
function buildButtons(view, lang) {
  const mk = (id, labelKey, active) =>
    new ButtonBuilder()
      .setCustomId(`help|${id}|${lang}`)
      .setLabel(t(labelKey, lang))
      .setStyle(active ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(active);

  return new ActionRowBuilder().addComponents(
    mk('all',   'btnAll',   view === 'all'),
    mk('vgc',   'btnVGC',   view === 'vgc'),
    mk('ptcgp', 'btnPTCGP', view === 'ptcgp'),
  );
}

// ── Render helper ─────────────────────────────────────────────────────────────
function render(view, lang) {
  const embed = view === 'all'
    ? buildOverviewEmbed(lang)
    : buildCategoryEmbed(view, lang);
  return { embeds: [embed], components: [buildButtons(view, lang)] };
}

// ── Module export ─────────────────────────────────────────────────────────────
module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('查看所有指令說明 / Show all command descriptions / コマンド一覧')
    .addStringOption(o => o
      .setName('category')
      .setDescription('指令分類（預設：全部）/ Category (default: all)')
      .addChoices(
        { name: '全部 / All',          value: 'all'   },
        { name: '🎮 VGC 主系列',        value: 'vgc'   },
        { name: '🃏 PTCGP 集換式卡牌',  value: 'ptcgp' },
      ))
    .addStringOption(o => o
      .setName('lang')
      .setDescription('說明文字語言（預設：繁體中文）/ Language for help text')
      .addChoices(
        { name: '繁體中文', value: 'zh' },
        { name: 'English',  value: 'en' },
        { name: '日本語',   value: 'ja' },
      )),

  async execute(interaction) {
    const view = interaction.options.getString('category') ?? 'all';
    const lang = interaction.options.getString('lang')     ?? 'zh';
    await interaction.reply({ ...render(view, lang), flags: 64 });
  },

  async handleButton(interaction) {
    const parts = interaction.customId.split('|');
    const view  = parts[1];
    const lang  = VALID_LANGS.has(parts[2]) ? parts[2] : 'zh';
    await interaction.update(render(view, lang));
  },
};
