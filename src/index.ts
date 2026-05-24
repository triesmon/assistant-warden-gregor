import { Client, Events, GatewayIntentBits, MessageFlags } from "discord.js";
import { loadConfig } from "./config";
import { openDatabase } from "./db";
import { handleInteraction } from "./interactions";
import { AlertRepository } from "./repository";
import { runAlertPoll } from "./scheduler";

// Wire Discord, storage, and the polling loop into the runtime process.
async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDatabase(config.databasePath);
  const repository = new AlertRepository(db);
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildScheduledEvents]
  });
  let pollRunning = false;

  // Keep scheduler polls single-flight so slow Discord calls cannot overlap.
  async function pollOnce(): Promise<void> {
    if (pollRunning) {
      console.warn("Skipping alert poll because the previous poll is still running.");
      return;
    }

    pollRunning = true;
    try {
      await runAlertPoll(client, repository);
    } finally {
      pollRunning = false;
    }
  }

  client.once(Events.ClientReady, () => {
    console.log(`Logged in as ${client.user?.tag ?? "unknown bot"}.`);

    void pollOnce().catch((error) => console.error("Initial alert poll failed:", error));
    setInterval(() => {
      void pollOnce().catch((error) => console.error("Alert poll failed:", error));
    }, config.pollIntervalMs);
  });

  client.on("interactionCreate", (interaction) => {
    void handleInteraction(interaction, repository).catch(async (error) => {
      console.error("Interaction failed:", error);
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "Something went wrong while handling that interaction.",
          flags: MessageFlags.Ephemeral
        });
      }
    });
  });

  process.once("SIGINT", () => {
    db.close();
    client.destroy();
    process.exit(0);
  });

  await client.login(config.discordToken);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
