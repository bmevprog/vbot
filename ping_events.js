import dotenv from "dotenv";
import schedule from 'node-schedule'
import { Client, GatewayIntentBits, Partials } from "discord.js";

//dotenv.config({ path: "public.env"});
//dotenv.config({ path: "private.env" });
let {
  DISCORD_TOKEN,
  DISCORD_SERVER,
  CODEFORCES_CHANNEL,
  CODEFORCES_ROLE,
  UPCOMING_FREQ,
  UPCOMING_DELTA,
  DAILY_NOTIF_HOUR,
  DAILY_NOTIF_DELTA,
} = process.env;

UPCOMING_FREQ = eval(UPCOMING_FREQ)
UPCOMING_DELTA = eval(UPCOMING_DELTA)
DAILY_NOTIF_HOUR = eval(DAILY_NOTIF_HOUR)
DAILY_NOTIF_DELTA = eval(DAILY_NOTIF_DELTA)

console.log(UPCOMING_FREQ);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  partials: [Partials.Message, Partials.GuildScheduledEvent, Partials.Channel, Partials.Reaction],
});

client.login(DISCORD_TOKEN);

async function ping_upcoming() {
  const guild = await client.guilds.fetch(DISCORD_SERVER);
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
  console.log("Pinging events starting:");
  const now = new Date();
  console.log(now.toString());
  console.log();

  for (const [id, event] of events) {
    console.log(event.name)
    console.log(event.scheduledStartAt.toString());

    const url = event.entityMetadata.location;
    if (!url.includes("codeforces.com")) continue;
    if (notifs.find(n => n.includes(url))) continue;

    const delta = event.scheduledStartAt.getTime() - now.getTime();
    if (delta < 0 || UPCOMING_DELTA < delta) continue;

    const timestamp = "<t:" + event.scheduledStartTimestamp / 1000 + ":R>";
    channel.send(role + url + " starting " + timestamp + ", **register**!");
  }
}

async function ping_tomorrow() {
  const guild = await client.guilds.fetch(DISCORD_SERVER);
  const events = await guild.scheduledEvents.fetch();
  const role = "<@&" + CODEFORCES_ROLE + "> ";
  const channel = await guild.channels.fetch(CODEFORCES_CHANNEL);

  console.log();
  console.log("Pinging events tomorrow:");
  const now = new Date();
  console.log(now.toString());
  console.log();

  for (const [id, event] of events) {
    console.log(event.name)
    console.log(event.scheduledStartAt.toString());

    const url = event.entityMetadata.location;
    if (!url.includes("codeforces.com")) continue;

    const delta = event.scheduledStartAt.getTime() - now.getTime();
    if (delta < 0 || DAILY_NOTIF_DELTA < delta) continue;

    const timestamp = "<t:" + event.scheduledStartTimestamp / 1000 + ":t>";
    channel.send(role + url + " at " + timestamp + " tomorrow.");
  }
}

client.once("ready", async () => {
  console.log("Client ready!")
  setInterval(ping_upcoming, UPCOMING_FREQ);
  schedule.scheduleJob('0 ' + DAILY_NOTIF_HOUR + ' * * *', ping_tomorrow);
});
