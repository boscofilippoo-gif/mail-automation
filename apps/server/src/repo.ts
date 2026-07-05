import { db } from "./db.js";
import { encrypt, decrypt } from "./crypto.js";
import {
  DEFAULT_SETTINGS,
  type ApiConnectorConfig,
  type DocType,
  type DocumentRecord,
  type Keyword,
  type PriceListItem,
  type PriceListMeta,
  type PriceListSource,
  type Processed,
  type ProcessedStatus,
  type ScanRun,
  type ScanRunKind,
  type SentStatus,
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
  category?: string | null;
  detail?: string | null;
  scanRunId?: number | null;
}): void {
  db.prepare(
    `INSERT INTO processed
       (user_id, gmail_message_id, subject, matched_keyword, status, document_id, error, category, detail, scan_run_id)
     VALUES (@userId, @gmailMessageId, @subject, @matchedKeyword, @status, @documentId, @error, @category, @detail, @scanRunId)
     ON CONFLICT(user_id, gmail_message_id) DO UPDATE SET
       status = @status, document_id = @documentId, error = @error,
       category = @category, detail = @detail, matched_keyword = @matchedKeyword,
       scan_run_id = COALESCE(@scanRunId, scan_run_id),  -- il Riprova conserva il run originale
       processed_at = datetime('now')`,
  ).run({ category: null, detail: null, scanRunId: null, ...p });
}

/** Riga processed singola (per il Riprova). */
export function getProcessed(userId: number, id: number): Processed | undefined {
  return db
    .prepare(`SELECT * FROM processed WHERE id = ? AND user_id = ?`)
    .get(id, userId) as Processed | undefined;
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

/** Aggiorna lo stato di invio di un documento (e opzionalmente l'id della bozza Gmail). */
export function updateDocumentStatus(
  userId: number,
  id: number,
  status: SentStatus,
  draftId?: string,
): void {
  if (draftId !== undefined) {
    db.prepare(`UPDATE documents SET sent_status = ?, draft_id = ? WHERE id = ? AND user_id = ?`).run(
      status,
      draftId,
      id,
      userId,
    );
  } else {
    db.prepare(`UPDATE documents SET sent_status = ? WHERE id = ? AND user_id = ?`).run(status, id, userId);
  }
}

/** Aggiorna un documento dopo una modifica manuale (nuovo JSON + nuovo PDF). */
export function updateDocument(
  userId: number,
  id: number,
  extractedJson: string,
  pdfPath: string,
): void {
  db.prepare(`UPDATE documents SET extracted_json = ?, pdf_path = ? WHERE id = ? AND user_id = ?`).run(
    extractedJson,
    pdfPath,
    id,
    userId,
  );
}

/* ───────────────────────── Listino prezzi ───────────────────────── */

export function getPriceList(
  userId: number,
): { meta: PriceListMeta; items: PriceListItem[] } | null {
  const row = db.prepare(`SELECT * FROM price_lists WHERE user_id = ?`).get(userId) as
    | { source_type: PriceListSource; source_ref: string; items_json: string; item_count: number; synced_at: string }
    | undefined;
  if (!row) return null;
  return {
    meta: {
      source_type: row.source_type,
      source_ref: row.source_ref,
      item_count: row.item_count,
      synced_at: row.synced_at,
    },
    items: JSON.parse(row.items_json) as PriceListItem[],
  };
}

export function upsertPriceList(
  userId: number,
  sourceType: PriceListSource,
  sourceRef: string,
  items: PriceListItem[],
  apiConfig?: ApiConnectorConfig,
): PriceListMeta {
  db.prepare(
    `INSERT INTO price_lists (user_id, source_type, source_ref, items_json, item_count, api_config_enc, synced_at)
     VALUES (@user_id, @source_type, @source_ref, @items_json, @item_count, @api_config_enc, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       source_type = @source_type, source_ref = @source_ref, items_json = @items_json,
       item_count = @item_count, api_config_enc = @api_config_enc, synced_at = datetime('now')`,
  ).run({
    user_id: userId,
    source_type: sourceType,
    source_ref: sourceRef,
    items_json: JSON.stringify(items),
    item_count: items.length,
    // cifrata a riposo con lo stesso AES-GCM dei token OAuth; null per le altre fonti
    api_config_enc: apiConfig ? encrypt(JSON.stringify(apiConfig)) : null,
  });
  return getPriceList(userId)!.meta;
}

/** Config del connettore API (decifrata), null se la fonte non è 'api'. */
export function getPriceListApiConfig(userId: number): ApiConnectorConfig | null {
  const row = db
    .prepare(`SELECT api_config_enc FROM price_lists WHERE user_id = ?`)
    .get(userId) as { api_config_enc: string | null } | undefined;
  if (!row?.api_config_enc) return null;
  return JSON.parse(decrypt(row.api_config_enc)) as ApiConnectorConfig;
}

export function deletePriceList(userId: number): void {
  db.prepare(`DELETE FROM price_lists WHERE user_id = ?`).run(userId);
}

/** true se i token OAuth salvati includono lo scope richiesto. */
export function hasScope(userId: number, scope: string): boolean {
  const t = getTokens(userId);
  return Boolean(t?.scope?.includes(scope));
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
    email_signature: row.email_signature,
    auto_draft: row.auto_draft,
  };
}

export function upsertUserSettings(userId: number, patch: Partial<UserSettings>): UserSettings {
  const merged: UserSettings = { ...getUserSettings(userId), ...patch };
  db.prepare(
    `INSERT INTO user_settings
       (user_id, template_id, accent_color, company_name, company_address, company_vat,
        company_email, company_phone, footer_note, logo_data_url, smart_scan,
        email_signature, auto_draft, updated_at)
     VALUES
       (@user_id, @template_id, @accent_color, @company_name, @company_address, @company_vat,
        @company_email, @company_phone, @footer_note, @logo_data_url, @smart_scan,
        @email_signature, @auto_draft, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       template_id = @template_id, accent_color = @accent_color, company_name = @company_name,
       company_address = @company_address, company_vat = @company_vat, company_email = @company_email,
       company_phone = @company_phone, footer_note = @footer_note, logo_data_url = @logo_data_url,
       smart_scan = @smart_scan, email_signature = @email_signature, auto_draft = @auto_draft,
       updated_at = datetime('now')`,
  ).run({ user_id: userId, ...merged });
  return merged;
}

/* ───────────────────────── Storico scansioni ───────────────────────── */

interface ScanCounters {
  created: number;
  errors: number;
  skipped: number;
  classified: number;
  skippedIrrelevant: number;
  draftsCreated: number;
}

const SCAN_RUNS_KEEP = 50;

function pruneScanRuns(userId: number): void {
  db.prepare(
    `DELETE FROM scan_runs WHERE user_id = ? AND id NOT IN
       (SELECT id FROM scan_runs WHERE user_id = ? ORDER BY id DESC LIMIT ?)`,
  ).run(userId, userId, SCAN_RUNS_KEEP);
}

/**
 * Crea la riga di run PRIMA dello scan (contatori a zero): così le mail
 * processate possono riferirla via processed.scan_run_id. Ritorna l'id.
 */
export function createScanRun(userId: number, kind: ScanRunKind, label: string | null): number {
  const info = db
    .prepare(
      `INSERT INTO scan_runs
         (user_id, kind, label, created, errors, skipped, classified, skipped_irrelevant, drafts_created)
       VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0)`,
    )
    .run(userId, kind, label);
  pruneScanRuns(userId);
  return Number(info.lastInsertRowid);
}

/** Somma i contatori di un lotto alla riga di run (additivo: usato anche dai lotti range). */
export function updateScanRunCounters(runId: number, r: ScanCounters): void {
  db.prepare(
    `UPDATE scan_runs SET
       created = created + ?, errors = errors + ?, skipped = skipped + ?,
       classified = classified + ?, skipped_irrelevant = skipped_irrelevant + ?,
       drafts_created = drafts_created + ?, run_at = datetime('now')
     WHERE id = ?`,
  ).run(r.created, r.errors, r.skipped, r.classified, r.skippedIrrelevant, r.draftsCreated, runId);
}

/**
 * Storico per lo scan a periodo: i lotti del loop client condividono UNA riga —
 * se l'ultima riga dell'utente è 'periodo' con la stessa label ed è più recente
 * di 15 minuti, la riusa; altrimenti ne crea una nuova. Ritorna l'id.
 */
export function getOrCreateRangeRun(userId: number, label: string): number {
  const last = db
    .prepare(`SELECT * FROM scan_runs WHERE user_id = ? ORDER BY id DESC LIMIT 1`)
    .get(userId) as ScanRun | undefined;

  const isRecentSameRange =
    last &&
    last.kind === "periodo" &&
    last.label === label &&
    Date.now() - new Date(last.run_at + "Z").getTime() < 15 * 60 * 1000;

  return isRecentSameRange ? last.id : createScanRun(userId, "periodo", label);
}

/** Mail elaborate in un run specifico (per il dettaglio apribile dello storico). */
export function listProcessedByRun(userId: number, runId: number): Processed[] {
  return db
    .prepare(`SELECT * FROM processed WHERE user_id = ? AND scan_run_id = ? ORDER BY processed_at DESC`)
    .all(userId, runId) as Processed[];
}

/** Riga di run singola (guardia di appartenenza per il dettaglio). */
export function getScanRun(userId: number, runId: number): ScanRun | undefined {
  return db
    .prepare(`SELECT * FROM scan_runs WHERE id = ? AND user_id = ?`)
    .get(runId, userId) as ScanRun | undefined;
}

export function listScanRuns(userId: number, limit = 20): ScanRun[] {
  return db
    .prepare(`SELECT * FROM scan_runs WHERE user_id = ? ORDER BY id DESC LIMIT ?`)
    .all(userId, limit) as ScanRun[];
}

/* ───────────────────────── Sync state ───────────────────────── */

export function touchSync(userId: number): void {
  db.prepare(
    `INSERT INTO sync_state (user_id, last_run_at) VALUES (?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET last_run_at = datetime('now')`,
  ).run(userId);
}
