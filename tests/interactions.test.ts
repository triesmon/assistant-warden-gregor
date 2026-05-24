import Database from "better-sqlite3";
import { ComponentType, MessageFlags, PermissionsBitField } from "discord.js";
import { describe, expect, it } from "vitest";
import { initializeSchema } from "../src/db";
import { buildAlertPanel, buildClearHistoryConfirmationPanel, buildMainPanel, canConfigureAlerts } from "../src/interactions";
import { AlertRepository } from "../src/repository";

describe("interaction permissions", () => {
  it("allows members with Manage Events", () => {
    expect(canConfigureAlerts(new PermissionsBitField(PermissionsBitField.Flags.ManageEvents))).toBe(true);
  });

  it("denies members without Manage Events", () => {
    expect(canConfigureAlerts(new PermissionsBitField(PermissionsBitField.Flags.ViewChannel))).toBe(false);
    expect(canConfigureAlerts(null)).toBe(false);
  });
});

describe("main alert panel", () => {
  it("renders an empty Components v2 panel without a select menu", () => {
    const repository = createRepository();
    repository.ensureGuild("guild-1");

    const panel = buildMainPanel(repository, "guild-1");
    const components = JSON.parse(JSON.stringify(panel.components));

    expect(panel.flags).toBe(MessageFlags.IsComponentsV2);
    expect(JSON.stringify(components)).toContain("No alerts configured.");
    expect(JSON.stringify(components)).not.toContain('"type":3');
  });

  it("renders one edit button per alert row", () => {
    const repository = createRepository();
    const alert = repository.addAlert("guild-1", 30, "minutes");
    repository.setAlertRecipients(alert.id, ["user-1", "user-2"]);

    const panel = buildMainPanel(repository, "guild-1", "user-1");
    const components = JSON.parse(JSON.stringify(panel.components));
    const nestedComponents = collectNestedComponents(components);
    const sections = nestedComponents.filter((component: { type: number }) => component.type === ComponentType.Section);
    const subscriptionRow = nestedComponents.find(
      (component: { type: number; components?: Array<{ custom_id?: string }> }) =>
        component.type === ComponentType.ActionRow && component.components?.[0]?.custom_id === `eventAlerts:subscribe:${alert.id}`
    );

    expect(sections).toHaveLength(1);
    expect(sections[0].accessory.custom_id).toBe(`eventAlerts:openAlert:${alert.id}`);
    expect(sections[0].components[0].content).toContain("30 minutes before");
    expect(sections[0].components[0].content).toContain("<@user-1>");
    expect(subscriptionRow.components).toMatchObject([
      { custom_id: `eventAlerts:subscribe:${alert.id}`, label: "Subscribe", disabled: true },
      { custom_id: `eventAlerts:unsubscribe:${alert.id}`, label: "Unsubscribe", disabled: false }
    ]);
    expect(JSON.stringify(components)).not.toContain('"custom_id":"eventAlerts:alertSelect"');
  });

  it("prioritizes the current user in alert recipient summaries", () => {
    const repository = createRepository();
    const alert = repository.addAlert("guild-1", 1, "days");
    repository.setAlertRecipients(alert.id, ["other-user", "current-user", "third-user"]);

    const panel = buildMainPanel(repository, "guild-1", "current-user");
    const components = JSON.parse(JSON.stringify(panel.components));
    const sectionText = collectNestedComponents(components).find((component: { type: number }) => component.type === ComponentType.Section)
      .components[0].content;

    expect(sectionText).toContain("<@current-user>, <@other-user>, <@third-user>");
  });

  it("preselects saved recipients in the alert user select", () => {
    const repository = createRepository();
    const alert = repository.addAlert("guild-1", 1, "days");
    const updatedAlert = repository.setAlertRecipients(alert.id, ["user-1", "user-2"]);

    const panel = buildAlertPanel(updatedAlert!);
    const components = JSON.parse(JSON.stringify(panel.components));
    const userSelect = components[1].components[0];

    expect(userSelect.default_values).toEqual([
      { id: "user-1", type: "user" },
      { id: "user-2", type: "user" }
    ]);
  });

  it("renders a clear-history confirmation with a danger confirm button", () => {
    const repository = createRepository();
    const alert = repository.addAlert("guild-1", 30, "minutes");
    repository.recordSentAlert({
      guildId: "guild-1",
      eventId: "event-1",
      alertId: alert.id,
      eventName: "Session",
      scheduledStartAt: "2026-01-01T12:00:00.000Z",
      offsetAmount: 30,
      offsetUnit: "minutes",
      attemptedRecipientIds: ["user-1"],
      successfulRecipientIds: ["user-1"],
      failedRecipients: [],
      errorSummary: null,
      sentAt: "2026-01-01T11:30:00.000Z"
    });

    const panel = buildClearHistoryConfirmationPanel(repository, "guild-1");
    const components = JSON.parse(JSON.stringify(panel.components));

    expect(components[0].components[0].content).toContain("permanently deletes the sent-history records");
    expect(components[0].components[0].content).toContain("can cause notifications for already-sent event alerts to go out again");
    expect(components[1].components[0]).toMatchObject({
      custom_id: "eventAlerts:confirmClearHistory",
      label: "Clear sent history",
      style: 4
    });
  });
});

function createRepository(): AlertRepository {
  const db = new Database(":memory:");
  initializeSchema(db);
  return new AlertRepository(db);
}

function collectNestedComponents(components: Array<{ components?: unknown[] }>): unknown[] {
  return components.flatMap((component) => component.components ?? []);
}
