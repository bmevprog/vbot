import { EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";
import fetch from "node-fetch";

interface StandingsProblem {
  index: string;
  name: string;
}

interface StandingsResponse {
  status: string;
  result: {
    contest: { id: number; name: string };
    problems: StandingsProblem[];
  };
}

interface Subproblem {
  name: string;
  index: string;
}

export async function handleCf(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const contestId = interaction.options.getInteger("contest");
  const forumChannelName = interaction.options.getString("forum");
  const guild = interaction.guild;

  if (!guild) {
    await interaction.editReply("This command must be used in a server.");
    return;
  }

  try {
    const response = await fetch(`https://codeforces.com/api/contest.standings?contestId=${contestId}&from=1&count=1`);
    const data = (await response.json()) as StandingsResponse;
    console.log(data);

    if (data.status !== "OK") {
      await interaction.editReply("Failed to retrieve contest data.");
      return;
    }

    const { contest, problems } = data.result;
    const problemMap = new Map<string, { baseName: string; subproblems: Subproblem[] }>();

    problems.forEach((problem) => {
      const baseIndex = problem.index.replace(/[0-9]/g, "").trim();
      const baseName = problem.name.match(/^[^(]+/g)?.[0]?.trim() ?? problem.name;
      const subName = (problem.name.match(/\(([^)]+)\)/) || [])[1] || baseName;

      if (!problemMap.has(baseIndex)) {
        problemMap.set(baseIndex, { baseName, subproblems: [] });
      }
      problemMap.get(baseIndex)!.subproblems.push({ name: subName, index: problem.index });
    });

    console.log("Problems in the round: ", problemMap);

    const forumChannel = guild.channels.cache.find(
      (channel) => channel.name === forumChannelName && channel.type === 15 // Forum channel type
    );

    if (!forumChannel || !forumChannel.isThreadOnly()) {
      await interaction.editReply(`Forum channel "${forumChannelName}" not found.`);
      return;
    }

    const todoId = forumChannel.availableTags.find((tag) => tag.name == "Todo")?.id;
    const tags = todoId ? [todoId] : [];

    const threads: string[] = [];
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
        infoEmbed.setDescription(`https://codeforces.com/contest/${contest.id}/problem/${problem.subproblems[0]!.index}`);
      }

      const thread = await forumChannel.threads.create({
        name: `CF ${contest.id}${baseIndex} - ${problem.baseName}`,
        message: { content: `Send your code and discuss in the comments! :)`, embeds: [infoEmbed] },
        appliedTags: tags,
        autoArchiveDuration: 1440,
        reason: "",
      });

      threads.push(`- ${thread}`);
    }

    await interaction.editReply(`Threads for ${contest.name}:` + "\n" + threads.join("\n"));
  } catch (error) {
    console.error("Error fetching contest data:", error);
    await interaction.editReply("An error occurred while fetching the contest data.");
  }
}
