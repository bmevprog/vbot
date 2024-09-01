import dotenv from "dotenv";
import fetch from 'node-fetch';
import { Client, GatewayIntentBits, Partials } from "discord.js";
import { contest2event, event2discord } from "./event_transforms.js";

dotenv.config({ path: ".env" });
const { DISCORD_TOKEN, DISCORD_SERVER } = process.env;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  partials: [Partials.Message, Partials.GuildScheduledEvent, Partials.Channel, Partials.Reaction],
});

client.login(DISCORD_TOKEN);

async function get_contests() {
  const response = await fetch('https://codeforces.com/api/contest.list');
  if (!response.ok) throw new Error("CF contest fetch request failed: " + response.status + ", " + response.statusText);

  const data = await response.json();
  if (data.status !== 'OK') throw new Error('CF contest fetch response not OK' + comment);

  return data.result
    .filter(contest => contest.phase === 'BEFORE')
    .map(contest2event);
}

async function update_discord_events() {
  let contests = await get_contests();

  const guild = await client.guilds.fetch(DISCORD_SERVER);
  const events = await guild.scheduledEvents.fetch();

  for (const [id, event] of events) {
    const url = event.entityMetadata.location;

    const contest = contests.filter(c => c.url === url)[0];
    if (contest) guild.scheduledEvents.edit(event, event2discord(contest));

    contests = contests.filter(c => c.url !== url);
  }

  for (const contest of contests) {
    guild.scheduledEvents.create(event2discord(contest));
  }
}

client.once("ready", async () => {
  console.log("Bot is ready!");
  await update_discord_events();
  console.log("Done.");
});

// export { get_contests }
