import { REST } from "@discordjs/rest";
import { Routes, type RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v9";
import dotenv from "dotenv";

dotenv.config({ path: ".env" });
const { DISCORD_CLIENT_ID, DISCORD_TOKEN } = process.env;

if (!DISCORD_CLIENT_ID || !DISCORD_TOKEN) {
  throw new Error("DISCORD_CLIENT_ID or DISCORD_TOKEN is missing from the environment");
}

const commands: RESTPostAPIApplicationCommandsJSONBody[] = [
  {
    name: "cf",
    description: "Post all threads for a Codeforces contest",
    options: [
      {
        name: "contest",
        type: 4, // integer
        description: "The ID of the Codeforces contest",
        required: true,
      },
      {
        name: "forum",
        type: 3, // string
        description: "The name of the forum channel to post in",
        required: true,
      },
    ],
  },
  {
    name: "link",
    description: "Link your Codeforces handle to your Discord account",
    options: [
      {
        name: "handle",
        type: 3, // string
        description: "Your Codeforces handle",
        required: true,
      },
    ],
  },
  {
    name: "done",
    description: "Mark today's daily problem as solved",
    options: [
      {
        name: "link",
        type: 3, // string
        description: "Link of today's Codeforces problem",
        required: true,
      },
    ],
  },
  {
    name: "new",
    description: "Reroll today's daily problem (mods only)",
  },
  {
    name: "streaks",
    description: "Show the streak leaderboard",
  },
];

const rest = new REST({ version: "9" }).setToken(DISCORD_TOKEN);

(async () => {
  try {
    console.log("Started refreshing application (/) commands.");
    await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID), { body: commands });
    console.log("Successfully reloaded application (/) commands.");
  } catch (error) {
    console.error(error);
  }
})();
