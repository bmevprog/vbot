import { REST } from "@discordjs/rest";
import { Routes } from "discord-api-types/v9";
import dotenv from "dotenv";

dotenv.config({ path: ".env" });
const { DISCORD_CLIENT_ID, DISCORD_TOKEN } = process.env;

const commands = [
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