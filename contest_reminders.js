import dotenv from "dotenv";
import fetch from 'node-fetch';
import schedule from 'node-schedule'
import {
  Client, GatewayIntentBits, Partials,
  GuildScheduledEventPrivacyLevel,
  GuildScheduledEventEntityType
} from "discord.js";

//dotenv.config({ path: "public.env" });
//dotenv.config({ path: "private.env" });

let {
  DISCORD_TOKEN,
  DISCORD_SERVER,
  BOT_CHANNEL,
  CODEFORCES_CHANNEL,
  CODEFORCES_ROLE,
  UPCOMING_FREQ,
  UPCOMING_DELTA,
  DAILY_NOTIF_HOUR,
  DAILY_NOTIF_MIN,
  DAILY_NOTIF_DELTA,
} = process.env;

UPCOMING_FREQ = eval(UPCOMING_FREQ)
UPCOMING_DELTA = eval(UPCOMING_DELTA)
DAILY_NOTIF_HOUR = eval(DAILY_NOTIF_HOUR)
DAILY_NOTIF_MIN = eval(DAILY_NOTIF_MIN)
DAILY_NOTIF_DELTA = eval(DAILY_NOTIF_DELTA)

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  partials: [Partials.Message, Partials.GuildScheduledEvent, Partials.Channel, Partials.Reaction],
});

client.login(DISCORD_TOKEN);

function contest2event(codeforces_contest) {
  return {
    name: codeforces_contest.name,
    start: new Date(codeforces_contest.startTimeSeconds * 1000),
    end: new Date((codeforces_contest.startTimeSeconds + codeforces_contest.durationSeconds) * 1000),
    url: `https://codeforces.com/contests/${codeforces_contest.id}`
  };
}

function event2discord(event) {
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
  if (!response.ok) throw new Error("CF contest fetch request failed: " + response.status + ", " + response.statusText);

  const data = await response.json();
  if (data.status !== 'OK') throw new Error('CF contest fetch response not OK' + comment);

  return data.result
    .filter(contest => contest.phase === 'BEFORE')
    .map(contest2event);
}

async function update_discord_events() {
  try {
    console.log();
    console.log("Contest reminders: Codeforces update");
    const now = new Date();
    console.log(now.toString());
    console.log();
    let contests = await get_contests();

    const guild = await client.guilds.fetch(DISCORD_SERVER);
    const events = await guild.scheduledEvents.fetch();

    for (const [id, event] of events) {
      const url = event.entityMetadata.location;
      const contest = contests.find(c => c.url === url);
      if (contest) {
        guild.scheduledEvents.edit(event, event2discord(contest));
        console.log(event.name+" updated");
        console.log(event.scheduledStartAt.toString());
      }
      contests = contests.filter(c => c.url !== url);
    }

    for (const contest of contests) {
      guild.scheduledEvents.create(event2discord(contest));
      console.log(contest.name+" created");
      console.log(contest.start.toString());
    }
  } catch (error) {
    const guild = await client.guilds.fetch(DISCORD_SERVER);
    const channel = await guild.channels.fetch(BOT_CHANNEL);
    channel.send("Contest reminders: Codeforces update error:\n" + error.stack);
  }
}

async function ping_upcoming() {
  const guild = await client.guilds.fetch(DISCORD_SERVER);
  try {
    const events = await guild.scheduledEvents.fetch();
    const role = "<@&" + CODEFORCES_ROLE + "> ";
    const channel = await guild.channels.fetch(CODEFORCES_CHANNEL);
    const notifs = await channel.messages.fetch().then(messages => {
      return messages
        .filter(msg => msg.content.includes("codeforces.com"))
        .filter(msg => msg.content.includes("starting"))
        .map(msg => msg.content.split(' ').find(word => word.includes("codeforces.com")));
    });

    console.log();
    console.log("Contest reminders: Starting");
    const now = new Date();
    console.log(now.toString());
    console.log();

    for (const [id, event] of events) {
      console.log(event.name)
      console.log(event.scheduledStartAt.toString());

      const url = event.entityMetadata.location;
      if (!url || !url.includes("codeforces.com")) continue;

      const botChannel = await guild.channels.fetch(BOT_CHANNEL);
      botChannel.send(JSON.stringify(event));
      botChannel.send(JSON.stringify(event.entityMetadata));
      botChannel.send(JSON.stringify(url));

      if (notifs.find(n => n.includes(url))) continue;

      const delta = event.scheduledStartAt.getTime() - now.getTime();
      if (delta < 0 || UPCOMING_DELTA < delta) continue;

      const timestamp = "<t:" + event.scheduledStartTimestamp / 1000 + ":R>";
      channel.send(role + url + " starting " + timestamp + ", **register**!");
    }
  } catch (error) {
    const channel = await guild.channels.fetch(BOT_CHANNEL);
    channel.send("Contest reminders: Starting error:\n" + error.stack);
  }
}

async function ping_tomorrow() {
  const guild = await client.guilds.fetch(DISCORD_SERVER);
  try {
    await update_discord_events();

    const events = await guild.scheduledEvents.fetch();
    const role = "<@&" + CODEFORCES_ROLE + "> ";
    const channel = await guild.channels.fetch(CODEFORCES_CHANNEL);

    console.log();
    console.log("Contest reminders: Tomorrow");
    const now = new Date();
    console.log(now.toString());
    console.log();

    for (const [id, event] of events) {
      console.log(event.name)
      console.log(event.scheduledStartAt.toString());

      const url = event.entityMetadata.location;

      const botChannel = await guild.channels.fetch(BOT_CHANNEL);
      botChannel.send(JSON.stringify(event));
      botChannel.send(JSON.stringify(event.entityMetadata));
      botChannel.send(JSON.stringify(url));

      if (!url || !url.includes("codeforces.com")) continue;

      const delta = event.scheduledStartAt.getTime() - now.getTime();
      if (delta < 0 || DAILY_NOTIF_DELTA < delta) continue;

      const timestamp = "<t:" + event.scheduledStartTimestamp / 1000 + ":t>";
      channel.send(role + url + " at " + timestamp + " tomorrow.");
    }
  } catch (error) {
    const channel = await guild.channels.fetch(BOT_CHANNEL);
    channel.send("Contest reminders: Tomorrow error:\n" + error.stack);
  }
}

client.once("ready", async () => {
  console.log("Client ready!")
  setInterval(ping_upcoming, UPCOMING_FREQ);
  schedule.scheduleJob(DAILY_NOTIF_MIN + ' ' + DAILY_NOTIF_HOUR + ' * * *', ping_tomorrow);
});
