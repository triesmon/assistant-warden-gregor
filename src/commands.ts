import { SlashCommandBuilder } from "discord.js";

export const EVENT_ALERTS_COMMAND = "gregor-admin";
export const SUBSCRIBE_COMMAND = "subscribe";

// Define slash commands in one place for both registration and interaction handling.
export function buildApplicationCommands(): object[] {
  return [
    new SlashCommandBuilder()
      .setName(EVENT_ALERTS_COMMAND)
      .setDescription("Configure scheduled event alert DMs.")
      .toJSON(),
    new SlashCommandBuilder()
      .setName(SUBSCRIBE_COMMAND)
      .setDescription("Manage your own scheduled event alert subscriptions.")
      .toJSON()
  ];
}
