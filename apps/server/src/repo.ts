import { db } from "./db.js";
import { encrypt, decrypt } from "./crypto.js";
import {
  DEFAULT_SETTINGS,
  type DocType,
  type DocumentRecord,
  type Keyword,
  type Processed,
  type ProcessedStatus,
  type User,
  type UserSettings,
} from "./types.js";

/* ───────────────────────── Utenti ───────────────────────── */

export function upsertUser(googleSub: string, email: string, displayName: string | null): User {
  db.prepare(
    `INSERT INTO users (google_sub, email, display_name)
     VALUES (@sub, @email, @name)
     ON CONFLICT(google_sub) DO UPDATE SET email = @email, display_name = @name`,
  ).run({ sub: googleSub, email, name: displayName });
  return db.prepare(`SELECT * FROM users WHERE google_sub = ?`).get(googleSub) as User;
}

export function getUserById(id: number): User | undefined {
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as User | undefined;
}

export function listActiveUserIds(): number[] {
  const rows = db.prepare(`SELECT id FROM users`).all() as { id: number }[];
  return rows.map((r) => r.id);
}

/* ───────────────────────── Token OAuth (cifrati) ───────────────────────── */

export interface StoredTokens {
  access_token: string | null;
  refresh_token: string | null;
  expiry: number | null;
  scope: string | null;
}

export function saveTokens(
  userId: number,
  t: { access_token?: string | null; refresh_token?: string | null; expiry_date?: number | null; scope?: string | null },
): void {
  // Il refresh_token arriva solo al primo consenso: se assente, conserviamo quello esistente.
  const existing = getTokens(userId);
  const refresh = t.refresh_token ?? existing?.refresh_token ?? null;

  db.prepare(
    `INSERT INTO oauth_tokens (user_id, access_token, refresh_token, expiry, scope)
     VALUES (@user_id, @access, @refresh, @expiry, @scope)
     ON CONFLICT(user_id) DO UPDATE SET
       access_token = @access, refresh_token = @refresh, expiry = @expiry, scope = @scope`,
  ).run({
    user_id: userId,
    access: t.access_token ? encrypt(t.access_token) : null,
    refresh: refresh ? encrypt(refresh) : null,
    expiry: t.expiry_date ?? null,
    scope: t.scope ?? existing?.scope ?? null,
  });
}

export function getTokens(userId: number): StoredTokens | undefined {
  const row = db.prepare(`SELECT * FROM oauth_tokens WHERE user_id = ?`).get(userId) as
    | { access_token: string | null; refresh_token: string | null; expiry: number | null; scope: string | null }
    | undefined;
  if (!row) return undefined;
  return {
    access_token: row.access_token ? decrypt(row.access_token) : null,
    refresh_token: row.refresh_token ? decrypt(row.refresh_token) : null,
    expiry: row.expiry,
    scope: row.scope,
  };
}

/* ───────────────────────── Keyword ───────────────────────── */

export function listKeywords(userId: number): Keyword[] {
  return db
    .prepare(`SELECT * FROM keywords WHERE user_id = ? ORDER BY id DESC`)
    .all(userId) as Keyword[];
}

export function listActiveKeywords(userId: number): Keyword[] {
  return db
    .prepare(`SELECT * FROM keywords WHERE user_id = ? AND active = 1 ORDER BY id DESC`)
    .all(userId) as Keyword[];
}

export function addKeyword(userId: number, term: string, docType: DocType): Keyword {
  const info = db
    .prepare(`INSERT INTO keywords (user_id, term, doc_type) VALUES (?, ?, ?)`)
    .run(userId, term, docType);
  return db.prepare(`SELECT * FROM keywords WHERE id = ?`).get(info.lastInsertRowid) as Keyword;
}

export function deleteKeyword(userId: number, id: number): void {
  db.prepare(`DELETE FROM keywords WHERE id = ? AND user_id = ?`).run(id, userId);
}

export function setKeywordActive(userId: number, id: number, active: boolean): void {
  db.prepare(`UPDATE keywords SET active = ? WHERE id = ? AND user_id = ?`).run(
    active ? 1 : 0,
    id,
    userId,
  );
}

/* ───────────────────────── Mail processate (dedup) ───────────────────────── */

export function isProcessed(userId: number, gmailMessageId: string): boolean {
  const row = db
    .prepare(`SELECT 1 FROM processed WHERE user_id = ? AND gmail_message_id = ?`)
    .get(userId, gmailMessageId);
  return Boolean(row);
}

export function recordProcessed(p: {
  userId: number;
  gmailMessageId: string;
  subject: string | null;
  matchedKeyword: string | null;
  status: ProcessedStatus;
  documentId: number | null;
  error: string | null;
}): void {
  db.prepare(
    `INSERT INTO processed
       (user_id, gmail_message_id, subject, matched_keyword, status, document_id, error)
     VALUES (@userId, @gmailMessageId, @subject, @matchedKeyword, @status, @documentId, @error)
     ON CONFLICT(user_id, gmail_message_id) DO UPDATE SET
       status = @status, document_id = @documentId, error = @error,
       processed_at = datetime('now')`,
  ).run(p);
}

export function listProcessed(userId: number, limit = 50): Processed[] {
  return db
    .prepare(`SELECT * FROM processed WHERE user_id = ? ORDER BY processed_at DESC LIMIT ?`)
    .all(userId, limit) as Processed[];
}

/* ───────────────────────── Documenti ───────────────────────── */

export function insertDocument(d: {
  userId: number;
  type: DocType;
  extractedJson: string;
  pdfPath: string;
  sourceMessageId: string;
}): DocumentRecord {
  const info = db
    .prepare(
      `INSERT INTO documents (user_id, type, extracted_json, pdf_path, source_message_id)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(d.userId, d.type, d.extractedJson, d.pdfPath, d.sourceMessageId);
  return db
    .prepare(`SELECT * FROM documents WHERE id = ?`)
    .get(info.lastInsertRowid) as DocumentRecord;
}

export function listDocuments(userId: number, limit = 100): DocumentRecord[] {
  return db
    .prepare(`SELECT * FROM documents WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`)
    .all(userId, limit) as DocumentRecord[];
}

export function getDocument(userId: number, id: number): DocumentRecord | undefined {
  return db
    .prepare(`SELECT * FROM documents WHERE id = ? AND user_id = ?`)
    .get(id, userId) as DocumentRecord | undefined;
}

/* ───────────────────────── Impostazioni utente ───────────────────────── */

export function getUserSettings(userId: number): UserSettings {
  const row = db.prepare(`SELECT * FROM user_settings WHERE user_id = ?`).get(userId) as
    | (UserSettings & { user_id: number })
    | undefined;
  if (!row) return { ...DEFAULT_SETTINGS };
  return {
    template_id: row.template_id,
    accent_color: row.accent_color,
    company_name: row.company_name,
    company_address: row.company_address,
    company_vat: row.company_vat,
    company_email: row.company_email,
    company_phone: row.company_phone,
    footer_note: row.footer_note,
    logo_data_url: row.logo_data_url,
    smart_scan: row.smart_scan,
  };
}

export function upsertUserSettings(userId: number, patch: Partial<UserSettings>): UserSettings {
  const merged: UserSettings = { ...getUserSettings(userId), ...patch };
  db.prepare(
    `INSERT INTO user_settings
       (user_id, template_id, accent_color, company_name, company_address, company_vat,
        company_email, company_phone, footer_note, logo_data_url, smart_scan, updated_at)
     VALUES
       (@user_id, @template_id, @accent_color, @company_name, @company_address, @company_vat,
        @company_email, @company_phone, @footer_note, @logo_data_url, @smart_scan, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       template_id = @template_id, accent_color = @accent_color, company_name = @company_name,
       company_address = @company_address, company_vat = @company_vat, company_email = @company_email,
       company_phone = @company_phone, footer_note = @footer_note, logo_data_url = @logo_data_url,
       smart_scan = @smart_scan, updated_at = datetime('now')`,
  ).run({ user_id: userId, ...merged });
  return merged;
}

/* ───────────────────────── Sync state ───────────────────────── */

export function touchSync(userId: number): void {
  db.prepare(
    `INSERT INTO sync_state (user_id, last_run_at) VALUES (?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET last_run_at = datetime('now')`,
  ).run(userId);
}
