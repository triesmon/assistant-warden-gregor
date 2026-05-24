import crypto from "node:crypto";
import type Database from "better-sqlite3";
import type { Alert, AlertOffsetUnit, FailedRecipient, SentAlert } from "./types";

interface AlertRow {
  id: string;
  guild_id: string;
  amount: number;
  unit: AlertOffsetUnit;
  enabled: 0 | 1;
  created_at: string;
  updated_at: string;
}

interface SentAlertRow {
  id: string;
  guild_id: string;
  event_id: string;
  alert_id: string;
  event_name: string;
  scheduled_start_at: string;
  offset_amount: number;
  offset_unit: AlertOffsetUnit;
  attempted_recipient_ids: string;
  successful_recipient_ids: string;
  failed_recipients: string;
  sent_at: string;
  error_summary: string | null;
}

export class AlertRepository {
  constructor(private readonly db: Database.Database) {}

  ensureGuild(guildId: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO guild_settings (guild_id, created_at, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(guild_id) DO UPDATE SET updated_at = excluded.updated_at`
      )
      .run(guildId, now, now);
  }

  listConfiguredGuildIds(): string[] {
    const rows = this.db.prepare("SELECT guild_id FROM guild_settings ORDER BY guild_id").all() as Array<{
      guild_id: string;
    }>;
    return rows.map((row) => row.guild_id);
  }

  listAlerts(guildId: string): Alert[] {
    const rows = this.db
      .prepare("SELECT * FROM alerts WHERE guild_id = ? ORDER BY amount, unit, created_at")
      .all(guildId) as AlertRow[];
    return rows.map((row) => this.mapAlertRow(row));
  }

  getAlert(alertId: string): Alert | null {
    const row = this.db.prepare("SELECT * FROM alerts WHERE id = ?").get(alertId) as AlertRow | undefined;
    return row ? this.mapAlertRow(row) : null;
  }

  addAlert(guildId: string, amount: number, unit: AlertOffsetUnit): Alert {
    this.ensureGuild(guildId);
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `INSERT INTO alerts (id, guild_id, amount, unit, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`
      )
      .run(id, guildId, amount, unit, now, now);

    const alert = this.getAlert(id);
    if (!alert) {
      throw new Error("Failed to load inserted alert.");
    }
    return alert;
  }

  updateAlert(alertId: string, amount: number, unit: AlertOffsetUnit): Alert | null {
    const now = new Date().toISOString();
    this.db.prepare("UPDATE alerts SET amount = ?, unit = ?, updated_at = ? WHERE id = ?").run(amount, unit, now, alertId);
    return this.getAlert(alertId);
  }

  deleteAlert(alertId: string): void {
    this.db.prepare("DELETE FROM alerts WHERE id = ?").run(alertId);
  }

  getAlertRecipients(alertId: string): string[] {
    const rows = this.db
      .prepare("SELECT user_id FROM alert_recipients WHERE alert_id = ? ORDER BY created_at, user_id")
      .all(alertId) as Array<{ user_id: string }>;
    return rows.map((row) => row.user_id);
  }

  setAlertRecipients(alertId: string, userIds: string[]): Alert | null {
    const uniqueUserIds = Array.from(new Set(userIds));
    const now = new Date().toISOString();

    // Replace one alert's recipient set atomically so the Discord picker is authoritative.
    const updateRecipients = this.db.transaction(() => {
      this.db.prepare("DELETE FROM alert_recipients WHERE alert_id = ?").run(alertId);
      const insert = this.db.prepare(
        "INSERT INTO alert_recipients (alert_id, user_id, created_at) VALUES (?, ?, ?)"
      );
      for (const userId of uniqueUserIds) {
        insert.run(alertId, userId, now);
      }
    });

    updateRecipients();
    return this.getAlert(alertId);
  }

  hasSentAlert(guildId: string, eventId: string, alertId: string): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM sent_alerts WHERE guild_id = ? AND event_id = ? AND alert_id = ?")
      .get(guildId, eventId, alertId);
    return Boolean(row);
  }

  recordSentAlert(input: Omit<SentAlert, "id" | "sentAt"> & { sentAt?: string }): void {
    this.ensureGuild(input.guildId);
    this.db
      .prepare(
        `INSERT OR IGNORE INTO sent_alerts (
          id,
          guild_id,
          event_id,
          alert_id,
          event_name,
          scheduled_start_at,
          offset_amount,
          offset_unit,
          attempted_recipient_ids,
          successful_recipient_ids,
          failed_recipients,
          sent_at,
          error_summary
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        crypto.randomUUID(),
        input.guildId,
        input.eventId,
        input.alertId,
        input.eventName,
        input.scheduledStartAt,
        input.offsetAmount,
        input.offsetUnit,
        JSON.stringify(input.attemptedRecipientIds),
        JSON.stringify(input.successfulRecipientIds),
        JSON.stringify(input.failedRecipients),
        input.sentAt ?? new Date().toISOString(),
        input.errorSummary
      );
  }

  listSentHistory(guildId: string, page: number, pageSize: number): SentAlert[] {
    const offset = Math.max(0, page) * pageSize;
    const rows = this.db
      .prepare("SELECT * FROM sent_alerts WHERE guild_id = ? ORDER BY sent_at DESC LIMIT ? OFFSET ?")
      .all(guildId, pageSize, offset) as SentAlertRow[];
    return rows.map(mapSentAlertRow);
  }

  clearSentHistory(guildId: string): void {
    this.db.prepare("DELETE FROM sent_alerts WHERE guild_id = ?").run(guildId);
  }

  private mapAlertRow(row: AlertRow): Alert {
    return {
      id: row.id,
      guildId: row.guild_id,
      amount: row.amount,
      unit: row.unit,
      recipientIds: this.getAlertRecipients(row.id),
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}

function mapSentAlertRow(row: SentAlertRow): SentAlert {
  return {
    id: row.id,
    guildId: row.guild_id,
    eventId: row.event_id,
    alertId: row.alert_id,
    eventName: row.event_name,
    scheduledStartAt: row.scheduled_start_at,
    offsetAmount: row.offset_amount,
    offsetUnit: row.offset_unit,
    attemptedRecipientIds: JSON.parse(row.attempted_recipient_ids) as string[],
    successfulRecipientIds: JSON.parse(row.successful_recipient_ids) as string[],
    failedRecipients: JSON.parse(row.failed_recipients) as FailedRecipient[],
    sentAt: row.sent_at,
    errorSummary: row.error_summary
  };
}
