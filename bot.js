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
    await interaction.deferReply();
    
    const contestId = interaction.options.getInteger("contest");
    const forumChannelName = interaction.options.getString("forum");

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
        const baseName = problem.name.match(/^[^(]+/g)[0].trim();
        const subName = (problem.name.match(/\(([^)]+)\)/) || [])[1] || baseName;

        if (!problemMap.has(baseIndex)) {
          problemMap.set(baseIndex, { baseName: baseName, subproblems: [] });
        }
        problemMap.get(baseIndex).subproblems.push({name: subName, index: problem.index });
      });

      console.log("Problems in the round: ", problemMap);

      //const forumChannel = client.channels.cache.get("1256217959580438661");
      const forumChannel = interaction.guild.channels.cache.find(
        (channel) => channel.name === forumChannelName && channel.type === 15 // Forum channel type
      );

      if (!forumChannel) {
        await interaction.reply(`Forum channel "${forumChannelName}" not found.`);
        return;
      }

      let threads = [];
      for (const [baseIndex, problem] of problemMap.entries()) {
        
        const infoEmbed = new EmbedBuilder()
          .setColor(0x222222)
          .setTitle(problem.baseName)
          .setFooter({ text: contest.name });

        if (problem.subproblems.length > 1) {
          for (const subproblem of problem.subproblems) {
            infoEmbed.addFields({
              name: subproblem.name,
              value: `https://codeforces.com/contest/${contest.id}/problem/${subproblem.index}`,
            });
          }
        } else {
          infoEmbed.setDescription(`https://codeforces.com/contest/${contest.id}/problem/${problem.subproblems[0].index}`);
        }

        const thread = await forumChannel.threads.create({
          name: `CF ${contest.id}${baseIndex} - ${problem.baseName}`,
          message: { content: `Send your code and discuss in the comments! :)`, embeds: [infoEmbed] },
          appliedTags: [],
          autoArchiveDuration: 1440,
          reason: '',
        });

        threads.push(`- ${thread}`);
      }
      
      await interaction.editReply(`Threads for ${contest.name}:` + "\n" + threads.join("\n"));
      
    } catch (error) {
      console.error("Error fetching contest data:", error);
      await interaction.reply("An error occurred while fetching the contest data.");
    }
  }
});

client.login(DISCORD_TOKEN);
