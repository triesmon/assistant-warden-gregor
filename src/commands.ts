import { SlashCommandBuilder } from "discord.js";

export const EVENT_ALERTS_COMMAND = "event-alerts";

// Define slash commands in one place for both registration and interaction handling.
export function buildApplicationCommands(): object[] {
  return [
    new SlashCommandBuilder()
      .setName(EVENT_ALERTS_COMMAND)
      .setDescription("Configure scheduled event alert DMs.")
      .toJSON()
  ];
}
