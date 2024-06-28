import { Client, EmbedBuilder, GatewayIntentBits } from "discord.js";

import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config({ path: ".env" });
const { DISCORD_TOKEN } = process.env;

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

client.once("ready", () => {
  console.log("Ready!");
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "cf") {
    const contestId = interaction.options.getInteger("contestid");
    const forumChannelName = interaction.options.getString("forumchannel");

    try {
      const response = await fetch(
        `https://codeforces.com/api/contest.standings?contestId=${contestId}&from=1&count=1`
      );
      const data = await response.json();

      if (data.status !== "OK") {
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

      const forumChannel = interaction.guild.channels.cache.find(
        (channel) => channel.name === forumChannelName && channel.type === "GUILD_FORUM"
      );

      if (!forumChannel) {
        await interaction.reply(`Forum channel "${forumChannelName}" not found.`);
        return;
      }

      const infoEmbed = new EmbedBuilder()
        .setColor(0xe2c6df)
        .setTitle(`Codeforces Contest: ${contest.name}`)
        .setDescription(`Problems for the contest ${contest.name}:`)
        .setTimestamp()
        .setFooter({
          text: "Codeforces",
          iconURL: "https://codeforces.org/s/56699/images/codeforces-logo-with-telegram.png",
        });

      problemMap.forEach(async (value, key) => {
        const links = value.indices
          .map((index) => `https://codeforces.com/contest/${contestId}/problem/${index}`)
          .join(" / ");
        infoEmbed.addFields({ name: `${key}: ${value.name}`, value: links });

        const thread = await forumChannel.threads.create({
          name: `${value.name}`,
          autoArchiveDuration: 60,
          reason: `Discussion thread for ${value.name}`,
        });

        await thread.send({ embeds: [infoEmbed] });
      });

      await interaction.reply(`Contest information posted in ${forumChannelName}.`);
    } catch (error) {
      console.error("Error fetching contest data:", error);
      await interaction.reply("An error occurred while fetching the contest data.");
    }
  }
});

client.login(DISCORD_TOKEN);
