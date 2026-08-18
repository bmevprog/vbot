import fetch from "node-fetch";
import schedule from "node-schedule";
import {
  Client,
  GatewayIntentBits,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  Partials,
} from "discord.js";

const {
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

if (!DISCORD_TOKEN || !DISCORD_SERVER) {
  throw new Error("Missing required environment variables (DISCORD_TOKEN, DISCORD_SERVER)");
}

const TOKEN = DISCORD_TOKEN;
const SERVER_ID = DISCORD_SERVER;

const config = {
  UPCOMING_FREQ: eval(UPCOMING_FREQ ?? "") as number,
  UPCOMING_DELTA: eval(UPCOMING_DELTA ?? "") as number,
  DAILY_NOTIF_HOUR: eval(DAILY_NOTIF_HOUR ?? "") as number,
  DAILY_NOTIF_MIN: eval(DAILY_NOTIF_MIN ?? "") as number,
  DAILY_NOTIF_DELTA: eval(DAILY_NOTIF_DELTA ?? "") as number,
};

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  partials: [Partials.Message, Partials.GuildScheduledEvent, Partials.Channel, Partials.Reaction],
});

client.login(TOKEN);

interface CodeforcesContest {
  id: number;
  name: string;
  startTimeSeconds: number;
  durationSeconds: number;
  phase: string;
}

interface CodeforcesContestListResponse {
  status: string;
  result: CodeforcesContest[];
}

function contest2event(codeforces_contest: CodeforcesContest) {
  return {
    name: codeforces_contest.name,
    start: new Date(codeforces_contest.startTimeSeconds * 1000),
    end: new Date((codeforces_contest.startTimeSeconds + codeforces_contest.durationSeconds) * 1000),
    url: `https://codeforces.com/contests/${codeforces_contest.id}`,
  };
}

function event2discord(event: ReturnType<typeof contest2event>) {
  return {
    name: event.name,
    scheduledStartTime: event.start,
    scheduledEndTime: event.end,
    description: "",
    entityMetadata: { location: event.url },
    image: null,
    reason: "Codeforces contest",
    entityType: GuildScheduledEventEntityType.External,
    privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
  };
}

async function get_contests() {
  const response = await fetch("https://codeforces.com/api/contest.list");
  if (!response.ok) throw new Error("CF contest fetch request failed: " + response.status + ", " + response.statusText);

  const data = (await response.json()) as CodeforcesContestListResponse;
  if (data.status !== "OK") throw new Error("CF contest fetch response not OK");

  return data.result
    .filter((contest) => contest.phase === "BEFORE")
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

    const guild = await client.guilds.fetch(SERVER_ID);
    const events = await guild.scheduledEvents.fetch();

    for (const [, event] of events) {
      const url = event.entityMetadata?.location;
      const contest = contests.find((c) => c.url === url);
      if (contest) {
        guild.scheduledEvents.edit(event, event2discord(contest));
        console.log(event.name + " updated");
        console.log(event.scheduledStartAt?.toString());
      }
      contests = contests.filter((c) => c.url !== url);
    }

    for (const contest of contests) {
      guild.scheduledEvents.create(event2discord(contest));
      console.log(contest.name + " created");
      console.log(contest.start.toString());
    }
  } catch (error) {
    const guild = await client.guilds.fetch(SERVER_ID);
    const channel = await guild.channels.fetch(BOT_CHANNEL!);
    if (channel?.isTextBased()) channel.send("Contest reminders: Codeforces update error:\n" + (error as Error).stack);
  }
}

async function ping_upcoming() {
  const guild = await client.guilds.fetch(SERVER_ID);
  try {
    const events = await guild.scheduledEvents.fetch();
    const role = "<@&" + CODEFORCES_ROLE + "> ";
    const channel = await guild.channels.fetch(CODEFORCES_CHANNEL!);
    if (!channel?.isTextBased()) throw new Error("CODEFORCES_CHANNEL not found");

    const notifs = await channel.messages.fetch().then((messages) => {
      return messages
        .filter((msg) => msg.content.includes("codeforces.com"))
        .filter((msg) => msg.content.includes("starting"))
        .map((msg) => msg.content.split(" ").find((word) => word.includes("codeforces.com")))
        .filter((n): n is string => Boolean(n));
    });

    console.log();
    console.log("Contest reminders: Starting");
    const now = new Date();
    console.log(now.toString());
    console.log();

    for (const [, event] of events) {
      console.log(event.name);
      console.log(event.scheduledStartAt?.toString());

      const url = event.entityMetadata?.location;
      if (!url || !url.includes("codeforces.com")) continue;
      const startAt = event.scheduledStartAt;
      if (!startAt) continue;
      if (notifs.find((n) => n.includes(url))) continue;

      const delta = startAt.getTime() - now.getTime();
      if (delta < 0 || config.UPCOMING_DELTA < delta) continue;

      const timestamp = "<t:" + event.scheduledStartTimestamp! / 1000 + ":R>";
      channel.send(role + url + " starting " + timestamp + ", **register**!");
    }
  } catch (error) {
    const channel = await guild.channels.fetch(BOT_CHANNEL!);
    if (channel?.isTextBased()) channel.send("Contest reminders: Starting error:\n" + (error as Error).stack);
  }
}

async function ping_tomorrow() {
  const guild = await client.guilds.fetch(SERVER_ID);
  try {
    await update_discord_events();

    const events = await guild.scheduledEvents.fetch();
    const role = "<@&" + CODEFORCES_ROLE + "> ";
    const channel = await guild.channels.fetch(CODEFORCES_CHANNEL!);
    if (!channel?.isTextBased()) throw new Error("CODEFORCES_CHANNEL not found");

    console.log();
    console.log("Contest reminders: Tomorrow");
    const now = new Date();
    console.log(now.toString());
    console.log();

    for (const [, event] of events) {
      console.log(event.name);
      console.log(event.scheduledStartAt?.toString());

      const url = event.entityMetadata?.location;
      if (!url || !url.includes("codeforces.com")) continue;
      const startAt = event.scheduledStartAt;
      if (!startAt) continue;

      const delta = startAt.getTime() - now.getTime();
      if (delta < 0 || config.DAILY_NOTIF_DELTA < delta) continue;

      const timestamp = "<t:" + event.scheduledStartTimestamp! / 1000 + ":t>";
      channel.send(role + url + " at " + timestamp + " tomorrow.");
    }
  } catch (error) {
    const channel = await guild.channels.fetch(BOT_CHANNEL!);
    if (channel?.isTextBased()) channel.send("Contest reminders: Tomorrow error:\n" + (error as Error).stack);
  }
}

client.once("ready", async () => {
  console.log("Client ready!");
  setInterval(ping_upcoming, config.UPCOMING_FREQ);
  schedule.scheduleJob(config.DAILY_NOTIF_MIN + " " + config.DAILY_NOTIF_HOUR + " * * *", ping_tomorrow);
});
