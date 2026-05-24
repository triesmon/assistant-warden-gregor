import "dotenv/config";
import path from "node:path";

export interface AppConfig {
  discordToken: string;
  discordClientId: string;
  databasePath: string;
  pollIntervalMs: number;
}

// Load runtime configuration once so missing secrets fail fast at startup.
export function loadConfig(): AppConfig {
  const discordToken = process.env.DISCORD_TOKEN;
  const discordClientId = process.env.DISCORD_CLIENT_ID;

  if (!discordToken) {
    throw new Error("DISCORD_TOKEN is required.");
  }

  if (!discordClientId) {
    throw new Error("DISCORD_CLIENT_ID is required.");
  }

  return {
    discordToken,
    discordClientId,
    databasePath: process.env.DATABASE_PATH ?? path.join(".", "data", "steeds-bot.sqlite"),
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 60_000)
  };
}
