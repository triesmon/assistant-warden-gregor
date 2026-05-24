import { Client, GatewayIntentBits, REST, Routes } from "discord.js";
import { EVENT_ALERTS_COMMAND } from "./commands";
import { loadConfig } from "./config";
import { openDatabase } from "./db";

// Verify the live Discord setup without printing tokens or other secrets.
async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDatabase(config.databasePath);
  db.close();

  const rest = new REST({ version: "10" }).setToken(config.discordToken);
  const commands = (await rest.get(Routes.applicationCommands(config.discordClientId))) as Array<{ name: string }>;
  const hasEventAlertsCommand = commands.some((command) => command.name === EVENT_ALERTS_COMMAND);

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildScheduledEvents]
  });

  const result = await new Promise<{
    readyAs: string;
    guilds: number;
    scheduledEventFetchOk: number;
    scheduledEventFetchFailed: number;
    visibleScheduledEvents: number;
  }>((resolve, reject) => {
    const timeout = setTimeout(() => {
      client.destroy();
      reject(new Error("Discord client did not become ready within 20 seconds."));
    }, 20_000);

    client.once("clientReady", async () => {
      clearTimeout(timeout);
      let scheduledEventFetchOk = 0;
      let scheduledEventFetchFailed = 0;
      let visibleScheduledEvents = 0;

      for (const [, guild] of client.guilds.cache) {
        try {
          const events = await guild.scheduledEvents.fetch();
          scheduledEventFetchOk += 1;
          visibleScheduledEvents += events.size;
        } catch {
          scheduledEventFetchFailed += 1;
        }
      }

      resolve({
        readyAs: client.user?.tag ?? "unknown",
        guilds: client.guilds.cache.size,
        scheduledEventFetchOk,
        scheduledEventFetchFailed,
        visibleScheduledEvents
      });
    });

    client.login(config.discordToken).catch(reject);
  });

  client.destroy();

  console.log(
    JSON.stringify(
      {
        databaseOpened: true,
        hasEventAlertsCommand,
        ...result
      },
      null,
      2
    )
  );

  if (!hasEventAlertsCommand) {
    throw new Error("Global /event-alerts command is not registered.");
  }

  if (result.guilds === 0) {
    throw new Error("Bot is not installed in any Discord servers yet.");
  }

  if (result.scheduledEventFetchFailed > 0) {
    throw new Error("Scheduled event fetch failed in at least one server.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
