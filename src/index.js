'use strict';

require('dotenv').config();
const {
  Client, Collection, GatewayIntentBits, Events, EmbedBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
} = require('discord.js');
const calcCommand  = require('./commands/calc');
const metaCommand  = require('./commands/meta');
const vocabCommand = require('./commands/vocab');
const cardCommand       = require('./commands/card');
const expansionCommand  = require('./commands/expansion');
const metaPocketCommand = require('./commands/meta_pocket');
const cardMetaCommand   = require('./commands/card_meta');
const usageCommand      = require('./commands/usage');
const movesearchCommand = require('./commands/movesearch');
const topCommand        = require('./commands/top');
const deckSearchCommand = require('./commands/deck_search');
const pokemonSearchCommand = require('./commands/dex');
const teamsCommand      = require('./commands/teams');
const teamSearchCommand = require('./commands/team_search');
const shinyCommand      = require('./commands/shiny');
const searchMiscCommand = require('./commands/search_misc');
const pokedexCommand    = require('./commands/pokedex');
const helpCommand       = require('./commands/help');
const { ui, translateType, translateCategory } = require('./utils/i18n');
const { startDailyRefresh } = require('./ptcgp/metaScraper');

if (!process.env.DISCORD_TOKEN) {
  console.error('❌  DISCORD_TOKEN is not set.  Copy .env.example → .env and fill it in.');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.commands = new Collection();
client.commands.set(calcCommand.data.name, calcCommand);
client.commands.set(metaCommand.data.name, metaCommand);
client.commands.set(vocabCommand.data.name, vocabCommand);
client.commands.set(cardCommand.data.name,       cardCommand);
client.commands.set(expansionCommand.data.name,  expansionCommand);
client.commands.set(metaPocketCommand.data.name, metaPocketCommand);
client.commands.set(cardMetaCommand.data.name,   cardMetaCommand);
client.commands.set(usageCommand.data.name,      usageCommand);
client.commands.set(movesearchCommand.data.name, movesearchCommand);
client.commands.set(topCommand.data.name,        topCommand);
client.commands.set(deckSearchCommand.data.name, deckSearchCommand);
client.commands.set(pokemonSearchCommand.data.name, pokemonSearchCommand);
client.commands.set(teamsCommand.data.name,      teamsCommand);
client.commands.set(teamSearchCommand.data.name, teamSearchCommand);
client.commands.set(shinyCommand.data.name,      shinyCommand);
client.commands.set(searchMiscCommand.data.name, searchMiscCommand);
client.commands.set(pokedexCommand.data.name,    pokedexCommand);
client.commands.set(helpCommand.data.name,       helpCommand);

// ── Ready ─────────────────────────────────────────────────────────────────────
client.once(Events.ClientReady, c => {
  console.log(`✅  Logged in as ${c.user.tag}  (${c.user.id})`);
  console.log(`    Serving ${c.guilds.cache.size} guild(s)`);
  console.log(`    Run "npm run deploy" first if slash commands are not showing up`);

  // Pre-fetch and daily-refresh PTCGP meta data (latest set only)
  startDailyRefresh(['B2b']);
});

// ── Interaction handler ───────────────────────────────────────────────────────
client.on(Events.InteractionCreate, async interaction => {

  // ── Autocomplete ─────────────────────────────────────────────────────────────
  if (interaction.isAutocomplete()) {
    const command = client.commands.get(interaction.commandName);
    if (command?.autocomplete) await command.autocomplete(interaction).catch(() => interaction.respond([]));
    return;
  }

  // ── Button: Guess the damage — opens a modal ─────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('guess_btn|')) {
    const [, minDmg, maxDmg, defHP, guessKey] = interaction.customId.split('|');
    const modal = new ModalBuilder()
      .setCustomId(`guess_modal|${minDmg}|${maxDmg}|${defHP}|${guessKey}`)
      .setTitle('Guess the Damage!');
    const input = new TextInputBuilder()
      .setCustomId('guess_val')
      .setLabel(`Guess a number in the damage range (${defHP} HP)`)
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Any number in the range counts — e.g. 85')
      .setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
    return;
  }

  // ── Button: Expansion pagination ─────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('exp_page|')) {
    await expansionCommand.handleButton(interaction);
    return;
  }

  // ── Select menu: Expansion card viewer ───────────────────────────────────────
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('exp_card|')) {
    await expansionCommand.handleSelectMenu(interaction);
    return;
  }

  // ── Button: Expansion jump to page ───────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('exp_jump|')) {
    await expansionCommand.handleJumpButton(interaction);
    return;
  }

  // ── Modal: Expansion jump submit ─────────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId.startsWith('exp_jump_modal|')) {
    await expansionCommand.handleJumpModal(interaction);
    return;
  }

  // ── Button: Meta pocket pagination ───────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('mp_page|')) {
    await metaPocketCommand.handleButton(interaction).catch(e => { console.error('[mp_page]', e); });
    return;
  }

  // ── Button: Meta pocket jump to page ─────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('mp_jump|')) {
    await metaPocketCommand.handleJumpButton(interaction).catch(e => { console.error('[mp_jump]', e); });
    return;
  }

  // ── Modal: Meta pocket jump submit ────────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId.startsWith('mp_jump_modal|')) {
    await metaPocketCommand.handleJumpModal(interaction).catch(e => { console.error('[mp_jump_modal]', e); });
    return;
  }

  // ── Select menu: Meta pocket deck detail ──────────────────────────────────────
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('mp_deck|')) {
    await metaPocketCommand.handleSelectMenu(interaction).catch(e => { console.error('[mp_deck]', e); });
    return;
  }

  // ── Select menu: Meta pocket card image viewer ─────────────────────────────
  if (interaction.isStringSelectMenu() && interaction.customId === 'mp_cardview') {
    await metaPocketCommand.handleCardView(interaction).catch(e => { console.error('[mp_cardview]', e); });
    return;
  }

  // ── Button: Card meta search ─────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('cm_search|')) {
    await cardMetaCommand.handleButton(interaction).catch(e => { console.error('[cm_search]', e); });
    return;
  }

  // ── Button: Card meta result pagination ──────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('cm_page|')) {
    await cardMetaCommand.handlePageButton(interaction).catch(e => { console.error('[cm_page]', e); });
    return;
  }

  // ── Select menu: Card meta deck detail ───────────────────────────────────────
  if (interaction.isStringSelectMenu() && interaction.customId === 'cm_deck') {
    await cardMetaCommand.handleSelectMenu(interaction).catch(e => { console.error('[cm_deck]', e); });
    return;
  }

  // ── Button: Card search pagination ───────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('sc_page|')) {
    await cardCommand.handleButton(interaction);
    return;
  }

  // ── Select menu: Card search detail viewer ────────────────────────────────────
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('sc_card|')) {
    await cardCommand.handleSelectMenu(interaction);
    return;
  }

  // ── Button: Card search jump to page ─────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('sc_jump|')) {
    await cardCommand.handleJumpButton(interaction);
    return;
  }

  // ── Modal: Card search jump submit ────────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId.startsWith('sc_jump_modal|')) {
    await cardCommand.handleJumpModal(interaction);
    return;
  }

  // ── Button: Vocab next ───────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('vocab_next|')) {
    await vocabCommand.handleButton(interaction);
    return;
  }

  // ── Button: HOME top rankings pagination ──────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('tp|')) {
    await topCommand.handleButton(interaction).catch(e => { console.error('[tp]', e); });
    return;
  }

  // ── Button: HOME usage detail tabs ───────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('up|')) {
    await usageCommand.handleButton(interaction).catch(e => { console.error('[up]', e); });
    return;
  }

  // ── Select menu: HOME usage detail dropdowns ──────────────────────────────────
  if (interaction.isStringSelectMenu() && /^up_(mv|ab|tr)_sel\|/.test(interaction.customId)) {
    await usageCommand.handleSelectMenu(interaction).catch(e => { console.error('[up_sel]', e); });
    return;
  }

  // ── Button: Deck search confirm ──────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('ds_search|')) {
    await deckSearchCommand.handleButton(interaction).catch(e => { console.error('[ds_search]', e); });
    return;
  }

  // ── Button: Deck search result pagination ────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('ds_page|')) {
    await deckSearchCommand.handlePageButton(interaction).catch(e => { console.error('[ds_page]', e); });
    return;
  }

  // ── Button: Teams navigation ─────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('tms|')) {
    await teamsCommand.handleButton(interaction).catch(e => { console.error('[tms]', e); });
    return;
  }

  // ── Button: Teams jump to page ────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('tms_jump|')) {
    await teamsCommand.handleJumpButton(interaction).catch(e => { console.error('[tms_jump]', e); });
    return;
  }

  // ── Modal: Teams jump submit ──────────────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId.startsWith('tms_jump_modal|')) {
    await teamsCommand.handleJumpModal(interaction).catch(e => { console.error('[tms_jump_modal]', e); });
    return;
  }

  // ── Select menu: Teams preview ────────────────────────────────────────────────
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('tms_preview|')) {
    await teamsCommand.handlePreview(interaction).catch(e => { console.error('[tms_preview]', e); });
    return;
  }

  // ── Button: Team search navigation ────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('tms_s|')) {
    await teamSearchCommand.handleButton(interaction).catch(e => { console.error('[tms_s]', e); });
    return;
  }

  // ── Select menu: Team search preview ─────────────────────────────────────────
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('tms_s_pre|')) {
    await teamSearchCommand.handlePreview(interaction).catch(e => { console.error('[tms_s_pre]', e); });
    return;
  }

  // ── Button: Dex search result pagination ─────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('dex_page|')) {
    await pokemonSearchCommand.handlePageButton(interaction).catch(e => { console.error('[dex_page]', e); });
    return;
  }

  // ── Select menu: Pokémon search detail card ───────────────────────────────────
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('dex_detail|')) {
    await pokemonSearchCommand.handleSelectMenu(interaction).catch(e => { console.error('[dex_detail]', e); });
    return;
  }

  // ── Select menu: Deck search result ──────────────────────────────────────────
  if (interaction.isStringSelectMenu() && interaction.customId === 'ds_deck') {
    await deckSearchCommand.handleSelectMenu(interaction).catch(e => { console.error('[ds_deck]', e); });
    return;
  }

  // ── Button: Help category navigation ─────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('help|')) {
    await helpCommand.handleButton(interaction).catch(e => { console.error('[help]', e); });
    return;
  }

  // ── Button: Calculator — open modal ──────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'calc_open') {
    const modal = new ModalBuilder()
      .setCustomId('calc_eval')
      .setTitle('🧮 Calculator');
    const input = new TextInputBuilder()
      .setCustomId('calc_expr')
      .setLabel('Expression  (use x or * for multiply)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('e.g.  45 x 1.5 + 12 / 4')
      .setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
    return;
  }

  // ── Modal: Calculator — evaluate ─────────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId === 'calc_eval') {
    const raw  = interaction.fields.getTextInputValue('calc_expr');
    const expr = raw.replace(/[xX×]/g, '*').replace(/[^0-9+\-*/.() ]/g, '');
    let result;
    try {
      // eslint-disable-next-line no-new-func
      result = Function(`'use strict'; return (${expr})`)();
      if (typeof result !== 'number' || !isFinite(result)) throw new Error('not a finite number');
      result = Math.round(result * 10000) / 10000;
    } catch {
      await interaction.reply({ content: `❌ Could not evaluate: \`${raw}\``, flags: 64 });
      return;
    }
    await interaction.reply({ content: `🧮 \`${raw}\` = **${result}**`, flags: 64 });
    return;
  }

  // ── Button: See Answer ────────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('see_answer|')) {
    const [, guessKey] = interaction.customId.split('|');
    const calcState = calcCommand.guessStates.get(guessKey);
    const metaState = metaCommand.guessStates.get(guessKey);
    const state = calcState || metaState;
    if (!state) {
      await interaction.reply({ content: ui('roundEnded', 'en'), flags: 64 });
      return;
    }
    if (calcState) calcCommand.guessStates.delete(guessKey);
    if (metaState) metaCommand.guessStates.delete(guessKey);
    const { calcDesc, minDmg, maxDmg, defHP, lang = 'en' } = state;
    const minPct   = (minDmg / defHP * 100).toFixed(1);
    const maxPct   = (maxDmg / defHP * 100).toFixed(1);
    const descLine = calcDesc ? `\n-# ${calcDesc}` : '';
    await interaction.reply({
      content: ui('revealed', lang, {
        user: interaction.user.toString(),
        min: minDmg, max: maxDmg, minPct, maxPct, hp: defHP, desc: descLine,
      }),
    });
    try { await interaction.message.edit({ components: [] }); } catch { /* best-effort */ }
    return;
  }

  // ── Modal: Guess result ───────────────────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId.startsWith('guess_modal|')) {
    const [, minDmgStr, maxDmgStr, defHPStr, guessKey] = interaction.customId.split('|');
    const minDmg = parseInt(minDmgStr, 10);
    const maxDmg = parseInt(maxDmgStr, 10);
    const defHP  = parseInt(defHPStr,  10);
    const raw    = interaction.fields.getTextInputValue('guess_val').trim();
    const guess  = parseInt(raw, 10);

    const calcGuessState = calcCommand.guessStates.get(guessKey);
    const metaGuessState = metaCommand.guessStates.get(guessKey);
    const state = calcGuessState || metaGuessState;
    const activeStates = calcGuessState ? calcCommand.guessStates : metaCommand.guessStates;

    if (!state) {
      await interaction.reply({ content: ui('roundEnded', 'en'), flags: 64 });
      return;
    }

    const lang = state.lang ?? 'en';

    if (isNaN(guess)) {
      await interaction.reply({ content: ui('notANumber', lang, { val: raw }), flags: 64 });
      return;
    }

    const minPct   = (minDmg / defHP * 100).toFixed(1);
    const maxPct   = (maxDmg / defHP * 100).toFixed(1);
    const descLine = state.calcDesc ? `\n-# ${state.calcDesc}` : '';
    const user     = interaction.user.toString();

    if (guess >= minDmg && guess <= maxDmg) {
      const elapsed = ((Date.now() - state.startTime) / 1000).toFixed(1);
      activeStates.delete(guessKey);
      await interaction.reply({
        content: ui('correct', lang, {
          user, elapsed, guess, min: minDmg, max: maxDmg, minPct, maxPct, hp: defHP, desc: descLine,
        }),
      });
      try { await interaction.message.edit({ components: [] }); } catch { /* best-effort */ }
    } else {
      state.wrongCount += 1;
      await interaction.reply({
        content: ui('wrong', lang, { user, guess }),
      });
    }
    return;
  }

  // ── Button: Base Stats & Move Info (ephemeral) ────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('stats|')) {
    const parts = interaction.customId.split('|');
    const attackerName = parts[1] ?? '';
    const defenderName = parts[2] ?? '';
    const moveName     = parts[3] ?? '';
    const lang         = parts[4] ?? 'en';

    const { getBaseStats } = require('./utils/pokeData');
    const { Move }         = require('@smogon/calc');
    const { TYPE_EMOJI, CATEGORY_EMOJI } = require('./utils/buildEmbed');
    const { translate }    = require('./utils/i18n');
    const genderEmoji      = s => s.replace(/♀/g, '♀️').replace(/♂/g, '♂️');

    const fmtStats = name => {
      const bs = getBaseStats(name);
      if (!bs) return `**${genderEmoji(translate(name, 'pokemon', lang))}** — ${ui('statsNotFound', lang)}`;
      const bst = bs.hp + bs.atk + bs.def + bs.spa + bs.spd + bs.spe;
      return `\`HP ${bs.hp} · Atk ${bs.atk} · Def ${bs.def} · SpA ${bs.spa} · SpD ${bs.spd} · Spe ${bs.spe}\`\nBST: **${bst}**`;
    };

    const fields = [
      { name: `⚔️ ${genderEmoji(translate(attackerName, 'pokemon', lang))}`, value: fmtStats(attackerName), inline: true },
      { name: `🛡️ ${genderEmoji(translate(defenderName, 'pokemon', lang))}`, value: fmtStats(defenderName), inline: true },
    ];

    if (moveName) {
      try {
        const m = new Move(9, moveName);
        const bpLine = m.bp === 0
          ? ui('bpVariable', lang)
          : m.hits > 1
            ? `${m.bp} × ${m.hits} hits = **${m.bp * m.hits} total**`
            : `**${m.bp}**`;
        const critNote  = m.isCrit ? `  ·  ${ui('alwaysCrits', lang)}` : '';
        const typeEmoji = TYPE_EMOJI[m.type] ?? '';
        const catEmoji  = CATEGORY_EMOJI[m.category] ?? '';
        fields.push({
          name:  `${catEmoji} ${translate(moveName, 'move', lang)}`,
          value: `${typeEmoji} ${ui('typeLabel', lang)}: **${translateType(m.type, lang)}**  ·  ${catEmoji} ${ui('categoryLabel', lang)}: **${translateCategory(m.category, lang)}**  ·  ${ui('bpLabel', lang)}: ${bpLine}${critNote}`,
          inline: false,
        });
      } catch { /* move lookup failed */ }
    }

    const embed = new EmbedBuilder()
      .setTitle(ui('statsTitle', lang))
      .setColor(0x5865F2)
      .addFields(...fields);

    await interaction.reply({ embeds: [embed], flags: 64 });
    return;
  }

  // ── Button: Types & Matchup (ephemeral) ───────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('types|')) {
    const parts        = interaction.customId.split('|');
    const attackerName = parts[1] ?? '';
    const defenderName = parts[2] ?? '';
    const attackerTera = parts[3] || null;
    const defenderTera = parts[4] || null;
    const lang         = parts[5] ?? 'en';

    const { getTypeWeaknesses } = require('./utils/pokeData');
    const { TYPE_EMOJI }        = require('./utils/buildEmbed');
    const { translate }         = require('./utils/i18n');
    const genderEmoji           = s => s.replace(/♀/g, '♀️').replace(/♂/g, '♂️');

    const fmtTypes = types =>
      types.map(t => (TYPE_EMOJI[t] ?? '') + ' ' + t).join('  ');

    const fmtGroup = (types) =>
      types.length ? types.map(t => (TYPE_EMOJI[t] ?? '') + ' ' + t).join('  ') : '—';

    const buildSection = (name, teraType) => {
      const info = getTypeWeaknesses(name, teraType);
      if (!info) return { name: genderEmoji(translate(name, 'pokemon', lang)), value: 'No data found.', inline: false };

      const teraLine = teraType ? `\nTera: ${TYPE_EMOJI[teraType] ?? ''} **${teraType}**` : '';
      const typeLabel = `**Type:** ${fmtTypes(info.types)}${teraLine}`;

      const lines = [typeLabel];
      if (info['4'].length)    lines.push(`**4× Weak:** ${fmtGroup(info['4'])}`);
      if (info['2'].length)    lines.push(`**2× Weak:** ${fmtGroup(info['2'])}`);
      if (info['0.5'].length)  lines.push(`**½× Resist:** ${fmtGroup(info['0.5'])}`);
      if (info['0.25'].length) lines.push(`**¼× Resist:** ${fmtGroup(info['0.25'])}`);
      if (info['0'].length)    lines.push(`**Immune (0×):** ${fmtGroup(info['0'])}`);

      return { name: `${genderEmoji(translate(name, 'pokemon', lang))}`, value: lines.join('\n'), inline: false };
    };

    const embed = new EmbedBuilder()
      .setTitle('🏷️ Types & Matchup')
      .setColor(0x5865F2)
      .addFields(
        { name: '⚔️ Attacker', value: '\u200b', inline: false },
        buildSection(attackerName, attackerTera),
        { name: '🛡️ Defender', value: '\u200b', inline: false },
        buildSection(defenderName, defenderTera),
      );

    await interaction.reply({ embeds: [embed], flags: 64 });
    return;
  }

  // ── Button: Reroll calc random ────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('random_reroll|')) {
    const lang = interaction.customId.split('|')[1] ?? 'en';
    await interaction.deferUpdate();
    const data = calcCommand.generateRandomResult();
    if (!data) {
      await interaction.editReply({ content: ui('errorRandom', lang), embeds: [], components: [] });
      return;
    }
    const { buildResultEmbed, makeStatsRow } = require('./utils/buildEmbed');
    const { attacker, defender, moveObj, field, result, attackerEVs, defenderEVs } = data;
    const { embed, files } = await buildResultEmbed(
      attacker, defender, moveObj, field, result, attackerEVs, defenderEVs, { isRandom: true, lang });
    const rerollRow = calcCommand.makeCalcRerollButton(lang);
    const statsRow  = makeStatsRow(attacker.name, defender.name, moveObj.name, lang);
    await interaction.editReply({ embeds: [embed], files, components: [rerollRow, statsRow] });
    return;
  }

  // ── Button: Reroll calc guess ─────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('guess_reroll|')) {
    await interaction.deferUpdate();
    const parts       = interaction.customId.split('|');
    const oldGuessKey = parts[1];
    const lang        = parts[2] ?? 'en';
    const oldState    = calcCommand.guessStates.get(oldGuessKey);
    calcCommand.guessStates.delete(oldGuessKey);
    const useStatChanges = oldState?.useStatChanges ?? false;
    const data = calcCommand.generateRandomResult({ useStatChanges });
    if (!data) {
      await interaction.editReply({ content: ui('errorGuess', lang), embeds: [], components: [] });
      return;
    }
    const { buildResultEmbed, makeStatsRow, makeGuessRow } = require('./utils/buildEmbed');
    const { attacker, defender, moveObj, field, result, attackerEVs, defenderEVs } = data;
    const { embed, files, minDmg, maxDmg, defHP, calcDesc } = await buildResultEmbed(
      attacker, defender, moveObj, field, result, attackerEVs, defenderEVs,
      { isRandom: true, hideRoll: true, lang },
    );
    const newGuessKey = interaction.id;
    const guessRow = makeGuessRow(minDmg, maxDmg, defHP, newGuessKey, `guess_reroll|${newGuessKey}|${lang}`, lang);
    const statsRow = makeStatsRow(attacker.name, defender.name, moveObj.name, lang, true);
    await interaction.editReply({ embeds: [embed], files, components: [guessRow, statsRow] });
    calcCommand.guessStates.set(newGuessKey, { startTime: Date.now(), wrongCount: 0, calcDesc, minDmg, maxDmg, defHP, useStatChanges, lang });
    setTimeout(async () => {
      if (!calcCommand.guessStates.has(newGuessKey)) return;
      calcCommand.guessStates.delete(newGuessKey);
      const minPct  = (minDmg / defHP * 100).toFixed(1);
      const maxPct  = (maxDmg / defHP * 100).toFixed(1);
      const descLine = calcDesc ? `\n-# ${calcDesc}` : '';
      try {
        await interaction.editReply({
          content: ui('timeUp', lang, { min: minDmg, max: maxDmg, minPct, maxPct, hp: defHP, desc: descLine }),
          components: [],
        });
      } catch { /* interaction token expired */ }
    }, 180_000);
    return;
  }

  // ── Button: Reroll meta guess ─────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('meta_guess_reroll|')) {
    await interaction.deferUpdate();
    const parts       = interaction.customId.split('|');
    const oldGuessKey = parts[1];
    const lang        = parts[2] ?? 'en';
    const oldState    = metaCommand.guessStates.get(oldGuessKey);
    metaCommand.guessStates.delete(oldGuessKey);
    const isDoubles      = oldState?.isDoubles ?? true;
    const useStatChanges = oldState?.useStatChanges ?? false;
    const data = metaCommand.generateMetaResult({ isDoubles, useStatChanges });
    if (!data) {
      await interaction.editReply({ content: ui('errorGuess', lang), embeds: [], components: [] });
      return;
    }
    const { buildResultEmbed, makeStatsRow, makeGuessRow } = require('./utils/buildEmbed');
    const { attacker, defender, moveObj, field, result, attackerEVs, defenderEVs } = data;
    const { embed, files, minDmg, maxDmg, defHP, calcDesc } = await buildResultEmbed(
      attacker, defender, moveObj, field, result, attackerEVs, defenderEVs,
      { isRandom: true, hideRoll: true, footerSuffix: ' · Meta: HOME Doubles Seasons 1–40', lang },
    );
    const newGuessKey = interaction.id;
    const guessRow = makeGuessRow(minDmg, maxDmg, defHP, newGuessKey, `meta_guess_reroll|${newGuessKey}|${lang}`, lang);
    const statsRow = makeStatsRow(attacker.name, defender.name, moveObj.name, lang, true);
    await interaction.editReply({ embeds: [embed], files, components: [guessRow, statsRow] });
    metaCommand.guessStates.set(newGuessKey, { startTime: Date.now(), wrongCount: 0, calcDesc, minDmg, maxDmg, defHP, isDoubles, useStatChanges, lang });
    setTimeout(async () => {
      if (!metaCommand.guessStates.has(newGuessKey)) return;
      metaCommand.guessStates.delete(newGuessKey);
      const minPct  = (minDmg / defHP * 100).toFixed(1);
      const maxPct  = (maxDmg / defHP * 100).toFixed(1);
      const descLine = calcDesc ? `\n-# ${calcDesc}` : '';
      try {
        await interaction.editReply({
          content: ui('timeUp', lang, { min: minDmg, max: maxDmg, minPct, maxPct, hp: defHP, desc: descLine }),
          components: [],
        });
      } catch { /* interaction token expired */ }
    }, 180_000);
    return;
  }

  // ── Button: Reroll meta random ────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('meta_reroll|')) {
    const parts          = interaction.customId.split('|');
    const isDoubles      = parts[1] !== '0';
    const lang           = parts[2] ?? 'en';
    const useStatChanges = parts[3] === '1';
    await interaction.deferUpdate();
    const data = metaCommand.generateMetaResult({ isDoubles, useStatChanges });
    if (!data) {
      await interaction.editReply({ content: ui('errorMeta', lang), embeds: [], components: [] });
      return;
    }
    const { buildResultEmbed, makeStatsRow } = require('./utils/buildEmbed');
    const { attacker, defender, moveObj, field, result, attackerEVs, defenderEVs,
            attackerDamageMoves, attackerNature, defenderNature } = data;
    const { embed, files } = await buildResultEmbed(
      attacker, defender, moveObj, field, result, attackerEVs, defenderEVs,
      { isRandom: true, footerSuffix: ' · Meta: HOME Doubles Seasons 1–40', lang });
    const stateKey = interaction.id;
    metaCommand.scenarioStates.set(stateKey, {
      attackerName: attacker.name, attackerAbility: attacker.ability,
      attackerItem: attacker.item, attackerNature, attackerEVs, attackerBoosts: attacker.boosts ?? {},
      defenderName: defender.name, defenderAbility: defender.ability,
      defenderItem: defender.item, defenderNature, defenderEVs, defenderBoosts: defender.boosts ?? {},
      weather: field.weather, terrain: field.terrain, isDoubles,
      isHelpingHand: !!field.attackerSide?.isHelpingHand,
      isFriendGuard: !!field.defenderSide?.isFriendGuard,
      isFairyAura: !!field.isFairyAura, isDarkAura: !!field.isDarkAura,
      isBeadsOfRuin: !!field.isBeadsOfRuin, isSwordOfRuin: !!field.isSwordOfRuin,
      isTabletsOfRuin: !!field.isTabletsOfRuin, isVesselOfRuin: !!field.isVesselOfRuin,
      damageMoves: attackerDamageMoves, currentMove: moveObj.name,
      lang, useStatChanges,
    });
    setTimeout(() => metaCommand.scenarioStates.delete(stateKey), 30 * 60 * 1000);
    const rerollRow = metaCommand.makeMetaRerollButton(isDoubles, lang, useStatChanges);
    const moveRow   = metaCommand.makeMetaMoveSelectRow(attackerDamageMoves, moveObj.name, stateKey, lang);
    const statsRow  = makeStatsRow(attacker.name, defender.name, moveObj.name, lang);
    await interaction.editReply({ embeds: [embed], files, components: [rerollRow, moveRow, statsRow] });
    return;
  }

  // ── Select menu: Switch move (meta random) ────────────────────────────────────
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('meta_move_select|')) {
    const stateKey    = interaction.customId.split('|')[1];
    const state       = metaCommand.scenarioStates.get(stateKey);
    if (!state) {
      await interaction.reply({ content: '⏰ This scenario has expired. Use Reroll to start a new one.', flags: 64 });
      return;
    }
    await interaction.deferUpdate();
    const newMove = interaction.values[0];
    state.currentMove = newMove;
    const { attacker, defender, moveObj, field } = metaCommand.buildScenarioFromState(state, newMove);
    const result = require('@smogon/calc').calculate(9, attacker, defender, moveObj, field);
    const { buildResultEmbed, makeStatsRow } = require('./utils/buildEmbed');
    const { embed, files } = await buildResultEmbed(
      attacker, defender, moveObj, field, result, state.attackerEVs, state.defenderEVs,
      { isRandom: true, footerSuffix: ' · Meta: HOME Doubles Seasons 1–40', lang: state.lang },
    );
    const rerollRow = metaCommand.makeMetaRerollButton(state.isDoubles, state.lang, state.useStatChanges);
    const moveRow   = metaCommand.makeMetaMoveSelectRow(state.damageMoves, newMove, stateKey, state.lang);
    const statsRow  = makeStatsRow(attacker.name, defender.name, moveObj.name, state.lang);
    await interaction.editReply({ embeds: [embed], files, components: [rerollRow, moveRow, statsRow] });
    return;
  }

  // ── Slash commands ───────────────────────────────────────────────────────────
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) {
    console.warn(`Unknown command received: ${interaction.commandName}`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`[${interaction.commandName}]`, err);
    const payload = { content: '❌  Something went wrong.', flags: 64 };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

client.on('error', err => console.error('[discord error]', err));
process.on('unhandledRejection', err => console.error('[unhandled rejection]', err));

client.login(process.env.DISCORD_TOKEN);
