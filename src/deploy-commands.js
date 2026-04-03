'use strict';

require('dotenv').config();
const { REST, Routes } = require('discord.js');
const calcCommand  = require('./commands/calc');
const metaCommand  = require('./commands/meta');
const vocabCommand = require('./commands/vocab');
const cardCommand       = require('./commands/card');
const expansionCommand  = require('./commands/expansion');
const metaPocketCommand = require('./commands/meta_pocket');
const cardMetaCommand   = require('./commands/card_meta');
const usageCommand      = require('./commands/usage');
const topCommand        = require('./commands/top');
const deckSearchCommand = require('./commands/deck_search');
const pokemonSearchCommand = require('./commands/dex');
const teamsCommand      = require('./commands/teams');
const teamSearchCommand = require('./commands/team_search');

if (!process.env.DISCORD_TOKEN) throw new Error('DISCORD_TOKEN is not set in .env');
if (!process.env.CLIENT_ID)     throw new Error('CLIENT_ID is not set in .env');

const commands = [
  calcCommand.data.toJSON(),
  metaCommand.data.toJSON(),
  vocabCommand.data.toJSON(),
  cardCommand.data.toJSON(),
  expansionCommand.data.toJSON(),
  metaPocketCommand.data.toJSON(),
  cardMetaCommand.data.toJSON(),
  usageCommand.data.toJSON(),
  topCommand.data.toJSON(),
  deckSearchCommand.data.toJSON(),
  pokemonSearchCommand.data.toJSON(),
  teamsCommand.data.toJSON(),
  teamSearchCommand.data.toJSON(),
];
const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    const route = process.env.GUILD_ID
      // Guild-scoped: shows up instantly (great for testing)
      ? Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID)
      // Global: up to 1 hour propagation time
      : Routes.applicationCommands(process.env.CLIENT_ID);

    const scope = process.env.GUILD_ID ? `guild ${process.env.GUILD_ID}` : 'globally';
    console.log(`🔄  Registering ${commands.length} command(s) ${scope}…`);

    const data = await rest.put(route, { body: commands });
    console.log(`✅  Successfully registered ${data.length} command(s).`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
