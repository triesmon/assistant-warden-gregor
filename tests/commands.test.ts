import { describe, expect, it } from "vitest";
import { EVENT_ALERTS_COMMAND, SUBSCRIBE_COMMAND, buildApplicationCommands } from "../src/commands";

describe("application commands", () => {
  it("registers admin and self-service alert commands", () => {
    const commands = buildApplicationCommands() as Array<{ name: string }>;

    expect(commands.map((command) => command.name)).toEqual([EVENT_ALERTS_COMMAND, SUBSCRIBE_COMMAND]);
  });
});
