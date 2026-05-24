import { GuildScheduledEventStatus } from "discord.js";
import { describe, expect, it } from "vitest";
import { buildAlertMessage, findDueAlerts, isAlertDue } from "../src/scheduler";
import type { Alert, ScheduledEventSnapshot } from "../src/types";

const baseAlert: Alert = {
  id: "alert-1",
  guildId: "guild-1",
  amount: 30,
  unit: "minutes",
  recipientIds: ["user-1"],
  enabled: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

const baseEvent: ScheduledEventSnapshot = {
  id: "event-1",
  guildId: "guild-1",
  name: "Session",
  scheduledStartAt: new Date("2026-01-01T12:00:00.000Z"),
  status: GuildScheduledEventStatus.Scheduled
};

describe("scheduler due alerts", () => {
  it("is due between alert time and event start", () => {
    expect(isAlertDue(baseEvent.scheduledStartAt!, baseAlert, new Date("2026-01-01T11:30:00.000Z"))).toBe(true);
    expect(isAlertDue(baseEvent.scheduledStartAt!, baseAlert, new Date("2026-01-01T11:45:00.000Z"))).toBe(true);
  });

  it("is not due before alert time or after event start", () => {
    expect(isAlertDue(baseEvent.scheduledStartAt!, baseAlert, new Date("2026-01-01T11:29:59.000Z"))).toBe(false);
    expect(isAlertDue(baseEvent.scheduledStartAt!, baseAlert, new Date("2026-01-01T12:00:00.000Z"))).toBe(false);
  });

  it("finds unsent due alerts with per-alert recipients", () => {
    const due = findDueAlerts({
      now: new Date("2026-01-01T11:45:00.000Z"),
      events: [baseEvent],
      alertsByGuild: new Map([["guild-1", [baseAlert]]]),
      wasSent: () => false
    });

    expect(due).toMatchObject([{ alert: baseAlert, recipientIds: ["user-1"] }]);
  });

  it("skips sent, completed, and recipientless alerts", () => {
    expect(
      findDueAlerts({
        now: new Date("2026-01-01T11:45:00.000Z"),
        events: [baseEvent],
        alertsByGuild: new Map([["guild-1", [baseAlert]]]),
        wasSent: () => true
      })
    ).toHaveLength(0);

    expect(
      findDueAlerts({
        now: new Date("2026-01-01T11:45:00.000Z"),
        events: [{ ...baseEvent, status: GuildScheduledEventStatus.Completed }],
        alertsByGuild: new Map([["guild-1", [baseAlert]]]),
        wasSent: () => false
      })
    ).toHaveLength(0);

    expect(
      findDueAlerts({
        now: new Date("2026-01-01T11:45:00.000Z"),
        events: [baseEvent],
        alertsByGuild: new Map([["guild-1", [{ ...baseAlert, recipientIds: [] }]]]),
        wasSent: () => false
      })
    ).toHaveLength(0);
  });

  it("builds a rich DM reminder", () => {
    const message = buildAlertMessage({
      guildId: "guild-1",
      event: baseEvent,
      alert: baseAlert,
      recipientIds: ["user-1"]
    });
    const embed = message.embeds?.[0].toJSON();

    expect(message.content).toBe("Event reminder");
    expect(embed?.title).toBe("Session");
    expect(embed?.description).toBe("Starts <t:1767268800:R>");
    expect(embed?.fields).toMatchObject([
      { name: "Start time", value: "<t:1767268800:F>" },
      { name: "Reminder", value: "30 minutes before start" }
    ]);
  });
});
