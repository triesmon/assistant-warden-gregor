import { REST, Routes } from "discord.js";
import { buildApplicationCommands } from "./commands";
import { loadConfig } from "./config";

// Register global slash commands; Discord may take time to propagate changes.
async function main(): Promise<void> {
  const config = loadConfig();
  const rest = new REST({ version: "10" }).setToken(config.discordToken);
  await rest.put(Routes.applicationCommands(config.discordClientId), { body: buildApplicationCommands() });
  console.log("Registered global application commands.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
