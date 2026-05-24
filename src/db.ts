import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

// Open the SQLite database and create parent directories for local deployments.
export function openDatabase(databasePath: string): Database.Database {
  const directory = path.dirname(databasePath);
  if (directory && directory !== ".") {
    fs.mkdirSync(directory, { recursive: true });
  }

  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  initializeSchema(db);
  return db;
}

const SCHEMA_VERSION = 4;

// Keep one current local schema; mismatched versions reset local bot data.
export function initializeSchema(db: Database.Database): void {
  const currentVersion = db.pragma("user_version", { simple: true }) as number;

  if (currentVersion !== 0 && currentVersion !== SCHEMA_VERSION) {
    db.exec(`
      DROP TABLE IF EXISTS alert_recipients;
      DROP TABLE IF EXISTS alert_rules;
      DROP TABLE IF EXISTS alerts;
      DROP TABLE IF EXISTS sent_alerts;
    `);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      unit TEXT NOT NULL CHECK (unit IN ('minutes', 'hours', 'days')),
      event_target TEXT NOT NULL DEFAULT 'interested' CHECK (event_target IN ('all', 'interested')),
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (guild_id) REFERENCES guild_settings(guild_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS alert_recipients (
      alert_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (alert_id, user_id),
      FOREIGN KEY (alert_id) REFERENCES alerts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sent_alerts (
      id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      alert_id TEXT NOT NULL,
      event_name TEXT NOT NULL,
      scheduled_start_at TEXT NOT NULL,
      offset_amount INTEGER NOT NULL,
      offset_unit TEXT NOT NULL,
      attempted_recipient_ids TEXT NOT NULL,
      successful_recipient_ids TEXT NOT NULL,
      failed_recipients TEXT NOT NULL,
      sent_at TEXT NOT NULL,
      error_summary TEXT,
      UNIQUE (guild_id, event_id, alert_id),
      FOREIGN KEY (guild_id) REFERENCES guild_settings(guild_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_alerts_guild ON alerts(guild_id);
    CREATE INDEX IF NOT EXISTS idx_alert_recipients_alert ON alert_recipients(alert_id);
    CREATE INDEX IF NOT EXISTS idx_sent_alerts_guild ON sent_alerts(guild_id, sent_at DESC);
  `);

  db.pragma(`user_version = ${SCHEMA_VERSION}`);
}
