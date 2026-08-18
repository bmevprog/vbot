import { Client, GatewayIntentBits, Partials } from "discord.js";

import dotenv from "dotenv";

import { handleCf } from "./cf.ts";
import { handleDone, handleLink, handleNew, handleStreaks, initStreaks } from "./streaks.ts";

dotenv.config({ path: ".env" });
const { DISCORD_TOKEN } = process.env;

if (!DISCORD_TOKEN) {
  throw new Error("DISCORD_TOKEN is missing from the environment");
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  partials: [Partials.Message, Partials.GuildScheduledEvent, Partials.Channel, Partials.Reaction],
});

client.once("ready", () => {
  console.log("Bot is ready!");
  initStreaks(client);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "cf") {
    await handleCf(interaction);
    return;
  }

  if (interaction.commandName === "link") {
    await handleLink(interaction);
    return;
  }

  if (interaction.commandName === "done") {
    await handleDone(interaction);
    return;
  }

  if (interaction.commandName === "new") {
    await handleNew(interaction);
    return;
  }

  if (interaction.commandName === "streaks") {
    await handleStreaks(interaction);
    return;
  }
});

client.login(DISCORD_TOKEN);
