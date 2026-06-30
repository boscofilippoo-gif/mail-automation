import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// data/ vive nella root del monorepo (due livelli sopra apps/server/src)
const DATA_DIR = path.resolve(__dirname, "../../../data");
const PDF_DIR = path.join(DATA_DIR, "pdfs");
const DB_PATH = path.join(DATA_DIR, "app.db");

fs.mkdirSync(PDF_DIR, { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

/** Crea lo schema se non esiste. Idempotente: si può chiamare a ogni avvio. */
export function migrate(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      google_sub    TEXT NOT NULL UNIQUE,
      email         TEXT NOT NULL,
      display_name  TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS oauth_tokens (
      user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      access_token   TEXT,           -- cifrato (AES-GCM)
      refresh_token  TEXT,           -- cifrato (AES-GCM)
      expiry         INTEGER,        -- epoch ms di scadenza dell'access token
      scope          TEXT
    );

    CREATE TABLE IF NOT EXISTS keywords (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      term      TEXT NOT NULL,
      doc_type  TEXT NOT NULL DEFAULT 'preventivo',
      active    INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS documents (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type              TEXT NOT NULL,
      extracted_json    TEXT NOT NULL,
      pdf_path          TEXT NOT NULL,
      source_message_id TEXT NOT NULL,
      created_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS processed (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      gmail_message_id  TEXT NOT NULL,
      subject           TEXT,
      matched_keyword   TEXT,
      status            TEXT NOT NULL,
      document_id       INTEGER REFERENCES documents(id) ON DELETE SET NULL,
      error             TEXT,
      processed_at      TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (user_id, gmail_message_id)
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      last_run_at  TEXT
    );
  `);
}

export { DATA_DIR, PDF_DIR, DB_PATH };
