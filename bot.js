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
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "cf") {
    const contestId = interaction.options.getInteger("contestid");
    const forumChannelName = interaction.options.getString("forumchannel");

    try {
      const response = await fetch(`https://codeforces.com/api/contest.standings?contestId=${contestId}&from=1&count=1`);
      const data = await response.json();

      if (data.status !== "OK") {
        await interaction.reply("Failed to retrieve contest data.");
        return;
      }

      const { contest, problems } = data.result;
      const problemMap = new Map();

      problems.forEach((problem) => {
        const baseIndex = problem.index.replace(/[0-9]/g, "").trim();
        const baseName = problem.name.replace(/ *\([^)]*\) */g, "");

        if (!problemMap.has(baseIndex)) {
          problemMap.set(baseIndex, { baseName: baseName, subproblems: [] });
        }
        problemMap.get(baseIndex).subproblems.push({name: problem.name, index: problem.index });
      });

      console.log("Problems in the round: ", problemMap);

      const forumChannel = client.channels.cache.get("1256217959580438661");
      if (!forumChannel) {
        await interaction.reply(`Forum channel "${forumChannelName}" not found.`);
        return;
      }

      for (const [baseIndex, problem] of problemMap.entries()) {
        
        const infoEmbed = new EmbedBuilder()
          .setColor(0x222222)
          .setTitle(problem.baseName)
          .setFooter({ text: contest.name });

        for (const subproblem of problem.subproblems) {
          infoEmbed.addFields({
            name: subproblem.name,
            value: `https://codeforces.com/contest/${contest.id}/problem/${subproblem.index}`,
          });
        }

        const thread = await forumChannel.threads.create({
          name: `CF ${contest.id}${baseIndex} - ${problem.baseName}`,
          message: { content: `Send your code and discuss in the comments!`, embeds: [infoEmbed] },
          appliedTags: [],
          autoArchiveDuration: 1440,
          reason: '',
        });
      }
      await interaction.reply(`Contest information posted in ${forumChannelName}.`);
      
    } catch (error) {
      
      console.error("Error fetching contest data:", error);
      await interaction.reply("An error occurred while fetching the contest data.");
    }
  }
});

client.login(DISCORD_TOKEN);
