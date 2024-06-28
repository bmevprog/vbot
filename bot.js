import { Client, EmbedBuilder, GatewayIntentBits, Partials } from "discord.js";

import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config({ path: ".env" });
const { DISCORD_TOKEN } = process.env;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  partials: [Partials.Message, Partials.GuildScheduledEvent, Partials.Channel, Partials.Reaction],
});

client.once("ready", () => { console.log("Bot is ready!"); });

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    console.log("Interaction is not a chat input command.");
    return;
  }

  console.log(`Received command: ${interaction.commandName}`);

  if (interaction.commandName === "cf") {
    const contestId = interaction.options.getInteger("contestid");
    const forumChannelName = interaction.options.getString("forumchannel");

    console.log(`contestId: ${contestId}, forumChannelName: ${forumChannelName}`);

    try {
      console.log("Fetching contest data...");
      const response = await fetch(
        `https://codeforces.com/api/contest.standings?contestId=${contestId}&from=1&count=1`
      );
      const data = await response.json();
      console.log("Received response from Codeforces API:", data);

      if (data.status !== "OK") {
        console.error("Failed to retrieve contest data:", data);
        await interaction.reply("Failed to retrieve contest data.");
        return;
      }

      const { contest, problems } = data.result;
      const problemMap = new Map();

      problems.forEach((problem) => {
        const baseIndex = problem.index.replace(/[0-9]/g, "").trim();
        const problemName = problem.name.replace(/ *\([^)]*\) */g, "");

        if (!problemMap.has(baseIndex)) {
          problemMap.set(baseIndex, {
            name: problemName,
            indices: [problem.index],
          });
        } else {
          problemMap.get(baseIndex).indices.push(problem.index);
        }
      });

      console.log("Constructed problem map:", problemMap);

      const forumChannel = client.channels.cache.get("1256217959580438661");
     
      if (!forumChannel) {
        console.error(`Forum channel "${forumChannelName}" not found.`);
        await interaction.reply(`Forum channel "${forumChannelName}" not found.`);
        return;
      }

      console.log(`Found forum channel: ${forumChannel.name}`);

      for (const [key, value] of problemMap.entries()) {
        const links = value.indices
          .map((index) => `https://codeforces.com/contest/${contestId}/problem/${index}`)
          .join(" / ");

        const infoEmbed = new EmbedBuilder()
          .setColor(0xe2c6df)
          .setTitle(`Codeforces Contest: ${contest.name}`)
          .setDescription(`Problems for the contest ${contest.name}:`)
          .addFields({ name: `${key}: ${value.name}`, value: links })
          .setTimestamp()
          .setFooter({
            text: "Codeforces",
            iconURL: "https://codeforces.org/s/56699/images/codeforces-logo-with-telegram.png",
          });

        console.log(`Creating thread for problem: ${value.name}`);

        const thread = await forumChannel.threads.create({
          name: `${value.name}`,
          message: { content: `Discussion thread for ${value.name}`, embeds: [infoEmbed] },
          appliedTags: [], // Add tag IDs if needed
          autoArchiveDuration: 60,
          reason: `Discussion thread for ${value.name}`,
        });

        console.log(`Thread created: ${thread.name}`);
      }

      await interaction.reply(`Contest information posted in ${forumChannelName}.`);
      console.log(`Posted contest information in ${forumChannelName}.`);
    } catch (error) {
      console.error("Error fetching contest data:", error);
      await interaction.reply("An error occurred while fetching the contest data.");
    }
  }
});

client.login(DISCORD_TOKEN);
