import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// data/ vive nella root del monorepo (due livelli sopra apps/server/src)
const DATA_DIR = path.resolve(__dirname, "../../../data");
const PDF_DIR = path.join(DATA_DIR, "pdfs");
const XLSX_DIR = path.join(DATA_DIR, "xlsx");
const DB_PATH = path.join(DATA_DIR, "app.db");

fs.mkdirSync(PDF_DIR, { recursive: true });
fs.mkdirSync(XLSX_DIR, { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

/**
 * Aggiunge una colonna a una tabella esistente se manca (ALTER guardato).
 * SQLite applica i DEFAULT costanti anche alle righe esistenti.
 */
function ensureColumn(table: string, column: string, ddl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

/**
 * Rende google_sub nullable su DB esistenti (SQLite non ha ALTER di nullability):
 * rebuild guardato della tabella. NON rinominare prima la vecchia — SQLite ≥3.25
 * ripunterebbe le FK dei figli sulla tabella rinominata.
 */
function rebuildUsersIfNeeded(): void {
  const cols = db.prepare(`PRAGMA table_info(users)`).all() as { name: string; notnull: number }[];
  const googleSub = cols.find((c) => c.name === "google_sub");
  if (!googleSub || googleSub.notnull === 0) return; // già nullable o tabella nuova

  db.pragma("foreign_keys = OFF");
  const rebuild = db.transaction(() => {
    db.exec(`
      CREATE TABLE users_new (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        google_sub    TEXT UNIQUE,
        email         TEXT NOT NULL,
        display_name  TEXT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO users_new (id, google_sub, email, display_name, created_at)
        SELECT id, google_sub, email, display_name, created_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
    `);
  });
  rebuild();
  db.pragma("foreign_keys = ON");
}

/** Crea lo schema se non esiste. Idempotente: si può chiamare a ogni avvio. */
export function migrate(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      google_sub    TEXT UNIQUE,
      email         TEXT NOT NULL,
      display_name  TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS magic_links (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      email       TEXT NOT NULL,
      token_hash  TEXT NOT NULL UNIQUE,
      expires_at  TEXT NOT NULL,
      used_at     TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS inbound_addresses (
      user_id              INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      alias                TEXT NOT NULL UNIQUE,
      pending_confirmation TEXT,
      created_at           TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS inbound_mails (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      mail_id    TEXT NOT NULL,
      subject    TEXT,
      sender     TEXT,
      date       TEXT,
      body_text  TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (user_id, mail_id)
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

    CREATE TABLE IF NOT EXISTS price_lists (
      user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL,          -- 'sheet' | 'pdf' | 'csv'
      source_ref  TEXT NOT NULL,          -- spreadsheetId oppure nome file
      items_json  TEXT NOT NULL,          -- array di PriceListItem, max 2000
      item_count  INTEGER NOT NULL,
      synced_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS scan_runs (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind               TEXT NOT NULL,   -- 'manuale' | 'giornaliero' | 'periodo'
      label              TEXT,            -- per periodo: '2026-06-01 → 2026-06-30'
      created            INTEGER NOT NULL,
      errors             INTEGER NOT NULL,
      skipped            INTEGER NOT NULL,
      classified         INTEGER NOT NULL,
      skipped_irrelevant INTEGER NOT NULL,
      drafts_created     INTEGER NOT NULL,
      run_at             TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      user_id         INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      template_id     TEXT NOT NULL DEFAULT 'classic',
      accent_color    TEXT,
      company_name    TEXT,
      company_address TEXT,
      company_vat     TEXT,
      company_email   TEXT,
      company_phone   TEXT,
      footer_note     TEXT,
      logo_data_url   TEXT,           -- data URL base64, max ~700k caratteri (validato lato route)
      smart_scan      INTEGER NOT NULL DEFAULT 0,
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // ── colonne aggiunte dopo il primo deploy: ALTER guardati, idempotenti ──
  ensureColumn("user_settings", "email_signature", "email_signature TEXT");
  ensureColumn("user_settings", "auto_draft", "auto_draft INTEGER NOT NULL DEFAULT 0");
  ensureColumn("documents", "sent_status", "sent_status TEXT NOT NULL DEFAULT 'da_inviare'");
  ensureColumn("documents", "draft_id", "draft_id TEXT");
  ensureColumn("processed", "scan_run_id", "scan_run_id INTEGER"); // null per righe pre-feature
  ensureColumn("price_lists", "api_config_enc", "api_config_enc TEXT"); // config connettore API, cifrata
  ensureColumn("processed", "category", "category TEXT");
  ensureColumn("processed", "detail", "detail TEXT");
  // template su misura generato dall'AI (HTML con placeholder, ~150KB max)
  ensureColumn("user_settings", "custom_template_html", "custom_template_html TEXT");

  // ── moduli Excel dei birrifici (feature Cappelletti) ──
  // Il file .xlsx-modello della mandante + la mappa prodotti→righe: alla mail
  // riempiamo solo la colonna quantità e lasciamo intatte le formule del modulo.
  db.exec(`
    CREATE TABLE IF NOT EXISTS brewery_templates (
      user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      brewery_key    TEXT NOT NULL,          -- slug del birrificio (es. 'eschenbacher')
      name           TEXT NOT NULL,          -- nome leggibile mostrato all'utente
      xlsx_base64    TEXT NOT NULL,          -- il file modello, base64 (<1MB tipico)
      mapping_json   TEXT NOT NULL,          -- [{row, label, aliases[]}] righe-prodotto
      qty_column     TEXT NOT NULL,          -- colonna quantità da riempire (es. 'E')
      sheet_name     TEXT,                   -- foglio target (null = primo)
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, brewery_key)
    );
  `);
  // path del file .xlsx generato per un documento (null se l'utente non usa moduli)
  ensureColumn("documents", "xlsx_path", "xlsx_path TEXT");
  // smistamento multi-fornitore: mappa {itemIndex → brewery_key} confermata dall'utente
  ensureColumn("documents", "sort_assignments_json", "sort_assignments_json TEXT");

  // ── login universale / doppia modalità casella ──
  rebuildUsersIfNeeded(); // google_sub nullable su DB pre-esistenti
  ensureColumn("users", "mail_mode", "mail_mode TEXT"); // 'gmail' | 'inoltro' | NULL
  try {
    // email = chiave identitaria per magic link e per il link account Google
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email COLLATE NOCASE)`);
  } catch (err) {
    // DB legacy con email duplicate: logga e prosegui
    console.error("[db] indice unique su users.email non creato:", err);
  }
}

export { DATA_DIR, PDF_DIR, XLSX_DIR, DB_PATH };
