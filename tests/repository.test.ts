import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { initializeSchema } from "../src/db";
import { AlertRepository } from "../src/repository";

function createRepository(): AlertRepository {
  const db = new Database(":memory:");
  initializeSchema(db);
  return new AlertRepository(db);
}

describe("AlertRepository", () => {
  it("persists alerts with per-alert recipients", () => {
    const repository = createRepository();
    const alert = repository.addAlert("guild-1", 2, "hours");
    repository.setAlertRecipients(alert.id, ["user-1", "user-2", "user-1"]);

    expect(repository.getAlertRecipients(alert.id)).toEqual(["user-1", "user-2"]);
    expect(repository.listAlerts("guild-1")).toMatchObject([
      { id: alert.id, amount: 2, unit: "hours", recipientIds: ["user-1", "user-2"] }
    ]);
  });

  it("deletes alert recipients with the alert", () => {
    const repository = createRepository();
    const alert = repository.addAlert("guild-1", 1, "days");
    repository.setAlertRecipients(alert.id, ["user-1"]);

    repository.deleteAlert(alert.id);

    expect(repository.getAlert(alert.id)).toBeNull();
    expect(repository.getAlertRecipients(alert.id)).toEqual([]);
  });

  it("keeps sent alert history unique per guild event and alert", () => {
    const repository = createRepository();
    const alert = repository.addAlert("guild-1", 30, "minutes");

    const sentAlert = {
      guildId: "guild-1",
      eventId: "event-1",
      alertId: alert.id,
      eventName: "Session",
      scheduledStartAt: "2026-01-01T12:00:00.000Z",
      offsetAmount: alert.amount,
      offsetUnit: alert.unit,
      attemptedRecipientIds: ["user-1"],
      successfulRecipientIds: ["user-1"],
      failedRecipients: [],
      errorSummary: null,
      sentAt: "2026-01-01T11:30:00.000Z"
    };

    repository.recordSentAlert(sentAlert);
    repository.recordSentAlert(sentAlert);

    expect(repository.hasSentAlert("guild-1", "event-1", alert.id)).toBe(true);
    expect(repository.listSentHistory("guild-1", 0, 10)).toHaveLength(1);
  });

  it("lists sent history by send time descending", () => {
    const repository = createRepository();
    const alert = repository.addAlert("guild-1", 30, "minutes");

    for (const [eventId, eventName, scheduledStartAt, sentAt] of [
      ["event-early", "Early", "2026-01-03T12:00:00.000Z", "2026-01-01T10:00:00.000Z"],
      ["event-late", "Late", "2026-01-01T12:00:00.000Z", "2026-01-03T10:00:00.000Z"],
      ["event-middle", "Middle", "2026-01-02T12:00:00.000Z", "2026-01-02T10:00:00.000Z"]
    ]) {
      repository.recordSentAlert({
        guildId: "guild-1",
        eventId,
        alertId: alert.id,
        eventName,
        scheduledStartAt,
        offsetAmount: alert.amount,
        offsetUnit: alert.unit,
        attemptedRecipientIds: ["user-1"],
        successfulRecipientIds: ["user-1"],
        failedRecipients: [],
        errorSummary: null,
        sentAt
      });
    }

    expect(repository.listSentHistory("guild-1", 0, 10).map((entry) => entry.eventName)).toEqual([
      "Late",
      "Middle",
      "Early"
    ]);
  });

  it("clears sent history for one guild", () => {
    const repository = createRepository();
    const guildOneAlert = repository.addAlert("guild-1", 30, "minutes");
    const guildTwoAlert = repository.addAlert("guild-2", 30, "minutes");

    for (const [guildId, alertId] of [
      ["guild-1", guildOneAlert.id],
      ["guild-2", guildTwoAlert.id]
    ]) {
      repository.recordSentAlert({
        guildId,
        eventId: `event-${guildId}`,
        alertId,
        eventName: `Event ${guildId}`,
        scheduledStartAt: "2026-01-01T12:00:00.000Z",
        offsetAmount: 30,
        offsetUnit: "minutes",
        attemptedRecipientIds: ["user-1"],
        successfulRecipientIds: ["user-1"],
        failedRecipients: [],
        errorSummary: null,
        sentAt: "2026-01-01T11:30:00.000Z"
      });
    }

    repository.clearSentHistory("guild-1");

    expect(repository.listSentHistory("guild-1", 0, 10)).toEqual([]);
    expect(repository.listSentHistory("guild-2", 0, 10)).toHaveLength(1);
  });
});
