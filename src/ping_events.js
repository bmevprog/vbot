import dotenv from "dotenv";
import fetch from 'node-fetch';
import { Client, GatewayIntentBits, Partials } from "discord.js";
import { event2discord } from "./event_transforms.js";

dotenv.config({ path: ".env" });
const { DISCORD_TOKEN, DISCORD_SERVER, CODEFORCES_CHANNEL } = process.env;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  partials: [Partials.Message, Partials.GuildScheduledEvent, Partials.Channel, Partials.Reaction],
});

client.login(DISCORD_TOKEN);

async function ping_events() {
  const guild = await client.guilds.fetch(DISCORD_SERVER);
  const events = await guild.scheduledEvents.fetch();

  const channel = await guild.channels.fetch(CODEFORCES_CHANNEL);

  const notifs = await channel.messages.fetch().then(messages => {
    return messages
      .filter(msg => msg.content.includes("codeforces.com"))
      .filter(msg => msg.content.includes("in 30 minutes"))
      .map(msg => msg.content.split(' ').find(word => word.includes("codeforces.com")));
  });

  console.log(notifs);
  
  for (const [id, event] of events) {
    const url = event.entityMetadata.location;
    if(!url.includes("codeforces.com")) continue;

    console.log(notifs.find(n => n.includes(url)));
    console.log("checked");

    channel.send(url + " in 30 minutes");
  }

}

client.once("ready", async () => {
  console.log("Bot is ready!");
  await ping_events();
  console.log("Done.");
});
