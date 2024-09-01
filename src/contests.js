import dotenv from "dotenv";
import fetch from 'node-fetch';

import { Client, GatewayIntentBits, Partials, GuildScheduledEventPrivacyLevel, GuildScheduledEventEntityType } from "discord.js";

dotenv.config({ path: ".env" });
const { DISCORD_TOKEN } = process.env;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  partials: [Partials.Message, Partials.GuildScheduledEvent, Partials.Channel, Partials.Reaction],
});

client.login(DISCORD_TOKEN);

function contest2event(codeforces_contest)
{
  return {
    name: codeforces_contest.name,
    start: new Date(codeforces_contest.startTimeSeconds * 1000),
    end: new Date((codeforces_contest.startTimeSeconds + codeforces_contest.durationSeconds) * 1000),
    url: `https://codeforces.com/contests/${codeforces_contest.id}`
  };
}

function event2discord(event)
{
  return {
    name: event.name,
    scheduledStartTime: event.start,
    scheduledEndTime: event.end,
    description: '',
    entityMetadata: { location: event.url },
    image: null,
    reason: 'Codeforces contest',
    entityType: GuildScheduledEventEntityType.External,
    privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
  };
}

async function get_contests() {
  const response = await fetch('https://codeforces.com/api/contest.list');
  const data = await response.json();
  if (data.status !== 'OK') throw new Error('Failed to fetch contests from Codeforces\n' + comment);
  return data.result
    .filter(contest => contest.phase === 'BEFORE')
    .map(contest2event);
}

async function add_contests_to_discord() {
  const guild = await client.guilds.fetch("1029784287152705596");
  const contests = await get_contests();
  for (const contest of contests) {
    guild.scheduledEvents.create(event2discord(contest));
  }
}

client.once("ready", async () => {
  console.log("Bot is ready!");
  let contests = await get_contests();

  const guild = await client.guilds.fetch("1029784287152705596");
  const events = await guild.scheduledEvents.fetch();

  for (const [id, event] of events)
  {
    const url = event.entityMetadata.location;
    const matching = contests.filter(contest => contest.url === url).map(event2discord);
    if(matching[0]) guild.scheduledEvents.edit(event, matching[0]);
    contests = contests.filter(contest => contest.url !== url);
  }

  for (const contest of contests)
  {
    guild.scheduledEvents.create(event2discord(contest));
  }

  console.log("Done.");
});

// export { get_contests }
