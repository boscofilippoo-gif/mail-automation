import nodeCrypto from "node:crypto";

import { db } from "./db.js";
import { encrypt, decrypt } from "./crypto.js";
import {
  DEFAULT_SETTINGS,
  type ApiConnectorConfig,
  type BreweryRow,
  type BreweryTemplate,
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

export function getUserByEmail(email: string): User | undefined {
  return db
    .prepare(`SELECT * FROM users WHERE email = ? COLLATE NOCASE`)
    .get(email.trim()) as User | undefined;
}

/** Crea (o ritorna) l'utente identificato dalla sola email — signup via magic link. */
export function upsertEmailUser(email: string): User {
  const existing = getUserByEmail(email);
  if (existing) return existing;
  db.prepare(`INSERT INTO users (google_sub, email) VALUES (NULL, ?)`).run(email.trim());
  return getUserByEmail(email)!;
}

/** Collega un account Google a un utente nato via magic link. */
export function linkGoogleSub(userId: number, googleSub: string): void {
  db.prepare(`UPDATE users SET google_sub = ? WHERE id = ?`).run(googleSub, userId);
}

export function setMailMode(userId: number, mode: "gmail" | "inoltro"): void {
  db.prepare(`UPDATE users SET mail_mode = ? WHERE id = ?`).run(mode, userId);
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

/** Registra (o aggiorna) il path del file Excel generato per un documento. */
export function setDocumentXlsxPath(userId: number, id: number, xlsxPath: string): void {
  db.prepare(`UPDATE documents SET xlsx_path = ? WHERE id = ? AND user_id = ?`).run(xlsxPath, id, userId);
}

/**
 * Salva lo smistamento confermato dall'utente: mappa {itemIndex → brewery_key}.
 * Funzione dedicata (NON updateDocument, che riscriverebbe anche il pdf_path).
 */
export function setSortAssignments(userId: number, id: number, map: Record<number, string>): void {
  db.prepare(`UPDATE documents SET sort_assignments_json = ? WHERE id = ? AND user_id = ?`).run(
    JSON.stringify(map),
    id,
    userId,
  );
}

/** Lo smistamento salvato per un documento, o null se mai confermato. */
export function getSortAssignments(userId: number, id: number): Record<number, string> | null {
  const row = db
    .prepare(`SELECT sort_assignments_json FROM documents WHERE id = ? AND user_id = ?`)
    .get(id, userId) as { sort_assignments_json: string | null } | undefined;
  if (!row?.sort_assignments_json) return null;
  try {
    return JSON.parse(row.sort_assignments_json) as Record<number, string>;
  } catch {
    return null;
  }
}

/* ───────────────────────── Moduli Excel birrifici ───────────────────────── */

interface BreweryRowRaw {
  brewery_key: string;
  name: string;
  xlsx_base64: string;
  mapping_json: string;
  qty_column: string;
  sheet_name: string | null;
}

function rowToTemplate(row: BreweryRowRaw): BreweryTemplate {
  let mapping: BreweryRow[] = [];
  try {
    mapping = JSON.parse(row.mapping_json) as BreweryRow[];
  } catch {
    mapping = [];
  }
  return {
    brewery_key: row.brewery_key,
    name: row.name,
    xlsx_base64: row.xlsx_base64,
    mapping,
    qty_column: row.qty_column,
    sheet_name: row.sheet_name,
  };
}

/** Il primo modulo birrificio dell'utente (per il path legacy mono-modulo), o null. */
export function getBreweryTemplate(userId: number): BreweryTemplate | null {
  const row = db
    .prepare(`SELECT * FROM brewery_templates WHERE user_id = ? ORDER BY created_at LIMIT 1`)
    .get(userId) as BreweryRowRaw | undefined;
  return row ? rowToTemplate(row) : null;
}

/** Tutti i moduli birrificio dell'utente, in ordine di caricamento. */
export function getAllBreweryTemplates(userId: number): BreweryTemplate[] {
  const rows = db
    .prepare(`SELECT * FROM brewery_templates WHERE user_id = ? ORDER BY created_at`)
    .all(userId) as BreweryRowRaw[];
  return rows.map(rowToTemplate);
}

/** Un modulo specifico per chiave, o null. */
export function getBreweryTemplateByKey(userId: number, breweryKey: string): BreweryTemplate | null {
  const row = db
    .prepare(`SELECT * FROM brewery_templates WHERE user_id = ? AND brewery_key = ?`)
    .get(userId, breweryKey) as BreweryRowRaw | undefined;
  return row ? rowToTemplate(row) : null;
}

/** Numero di moduli birrificio dell'utente. */
export function countBreweryTemplates(userId: number): number {
  const r = db
    .prepare(`SELECT COUNT(*) AS c FROM brewery_templates WHERE user_id = ?`)
    .get(userId) as { c: number };
  return r.c;
}

/** Crea o sostituisce il modulo birrificio dell'utente (upsert per brewery_key). */
export function setBreweryTemplate(userId: number, t: BreweryTemplate): void {
  db.prepare(
    `INSERT INTO brewery_templates (user_id, brewery_key, name, xlsx_base64, mapping_json, qty_column, sheet_name)
     VALUES (@user_id, @brewery_key, @name, @xlsx_base64, @mapping_json, @qty_column, @sheet_name)
     ON CONFLICT(user_id, brewery_key) DO UPDATE SET
       name = @name, xlsx_base64 = @xlsx_base64, mapping_json = @mapping_json,
       qty_column = @qty_column, sheet_name = @sheet_name`,
  ).run({
    user_id: userId,
    brewery_key: t.brewery_key,
    name: t.name,
    xlsx_base64: t.xlsx_base64,
    mapping_json: JSON.stringify(t.mapping),
    qty_column: t.qty_column,
    sheet_name: t.sheet_name,
  });
}

/** Aggiorna solo la mappa prodotti→righe di un modulo esistente. */
export function updateBreweryMapping(userId: number, breweryKey: string, mapping: BreweryRow[]): void {
  db.prepare(
    `UPDATE brewery_templates SET mapping_json = ? WHERE user_id = ? AND brewery_key = ?`,
  ).run(JSON.stringify(mapping), userId, breweryKey);
}

/** Rimuove il modulo birrificio dell'utente. */
export function deleteBreweryTemplate(userId: number, breweryKey: string): void {
  db.prepare(`DELETE FROM brewery_templates WHERE user_id = ? AND brewery_key = ?`).run(userId, breweryKey);
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

/* ───────────────────────── Magic link ───────────────────────── */

export function createMagicLink(email: string, tokenHash: string, ttlMinutes = 15): void {
  db.prepare(
    `INSERT INTO magic_links (email, token_hash, expires_at)
     VALUES (?, ?, datetime('now', '+' || ? || ' minutes'))`,
  ).run(email.trim(), tokenHash, ttlMinutes);
}

/**
 * Consumo ATOMICO e single-use del magic link: l'UPDATE riesce solo se il token
 * esiste, non è mai stato usato e non è scaduto. Ritorna l'email o null.
 */
export function consumeMagicLink(tokenHash: string): string | null {
  const info = db
    .prepare(
      `UPDATE magic_links SET used_at = datetime('now')
       WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')`,
    )
    .run(tokenHash);
  if (info.changes !== 1) return null;
  const row = db.prepare(`SELECT email FROM magic_links WHERE token_hash = ?`).get(tokenHash) as
    | { email: string }
    | undefined;
  return row?.email ?? null;
}

/* ───────────────────────── Indirizzi inbound (inoltro) ───────────────────────── */

function randomAlias(): string {
  // 8 char base36 non ambigui: unguessable, è la protezione primaria anti-spoofing
  let s = "";
  while (s.length < 8) {
    s += Math.floor(Math.random() * 36).toString(36);
  }
  return s;
}

/**
 * Alias DETERMINISTICO derivato dall'email (HMAC con la chiave segreta):
 * stesso utente → stesso alias per sempre, anche se il DB viene azzerato
 * (Render free è effimero). Così l'inoltro configurato dal cliente nella sua
 * casella non si rompe mai. Resta unguessable senza la chiave.
 */
function deterministicAlias(email: string): string {
  return nodeCrypto
    .createHmac("sha256", process.env.TOKEN_ENC_KEY ?? "alias-key")
    .update(email.trim().toLowerCase())
    .digest("hex")
    .slice(0, 12);
}

export function getOrCreateInboundAddress(userId: number): { alias: string; pending_confirmation: string | null } {
  const row = db
    .prepare(`SELECT alias, pending_confirmation FROM inbound_addresses WHERE user_id = ?`)
    .get(userId) as { alias: string; pending_confirmation: string | null } | undefined;
  if (row) return row;
  const user = getUserById(userId);
  const alias = user ? deterministicAlias(user.email) : randomAlias();
  db.prepare(`INSERT INTO inbound_addresses (user_id, alias) VALUES (?, ?)`).run(userId, alias);
  return { alias, pending_confirmation: null };
}

export function regenerateInboundAddress(userId: number): string {
  const alias = randomAlias();
  db.prepare(
    `INSERT INTO inbound_addresses (user_id, alias, pending_confirmation) VALUES (?, ?, NULL)
     ON CONFLICT(user_id) DO UPDATE SET alias = ?, pending_confirmation = NULL`,
  ).run(userId, alias, alias);
  return alias;
}

export function getUserByAlias(alias: string): number | null {
  const row = db
    .prepare(`SELECT user_id FROM inbound_addresses WHERE alias = ?`)
    .get(alias.toLowerCase()) as { user_id: number } | undefined;
  return row?.user_id ?? null;
}

export function setPendingConfirmation(userId: number, value: string | null): void {
  db.prepare(`UPDATE inbound_addresses SET pending_confirmation = ? WHERE user_id = ?`).run(
    value,
    userId,
  );
}

/* ───────────────────────── Mail inbound (corpo salvato: non ri-scaricabile) ───────────────────────── */

const INBOUND_BODY_CAP = 100_000;
const INBOUND_KEEP = 500;

export function insertInboundMail(m: {
  userId: number;
  mailId: string;
  subject: string | null;
  sender: string | null;
  date: string | null;
  bodyText: string;
}): void {
  db.prepare(
    `INSERT INTO inbound_mails (user_id, mail_id, subject, sender, date, body_text)
     VALUES (@userId, @mailId, @subject, @sender, @date, @bodyText)
     ON CONFLICT(user_id, mail_id) DO NOTHING`,
  ).run({ ...m, bodyText: m.bodyText.slice(0, INBOUND_BODY_CAP) });
  db.prepare(
    `DELETE FROM inbound_mails WHERE user_id = @userId AND id NOT IN
       (SELECT id FROM inbound_mails WHERE user_id = @userId ORDER BY id DESC LIMIT ${INBOUND_KEEP})`,
  ).run({ userId: m.userId });
}

export function getInboundMail(
  userId: number,
  mailId: string,
): { subject: string | null; sender: string | null; date: string | null; body_text: string | null } | undefined {
  return db
    .prepare(`SELECT subject, sender, date, body_text FROM inbound_mails WHERE user_id = ? AND mail_id = ?`)
    .get(userId, mailId) as ReturnType<typeof getInboundMail>;
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

/**
 * HTML del template su misura. Vive FUORI da UserSettings: è grande (~150KB)
 * e upsertUserSettings ha parametri nominali fissi — un campo extra farebbe throw.
 */
export function getCustomTemplateHtml(userId: number): string | null {
  const row = db
    .prepare(`SELECT custom_template_html FROM user_settings WHERE user_id = ?`)
    .get(userId) as { custom_template_html: string | null } | undefined;
  return row?.custom_template_html ?? null;
}

export function setCustomTemplateHtml(userId: number, html: string | null): void {
  if (html !== null) {
    // INSERT per utenti che non hanno ancora la riga (le altre colonne hanno default DDL)
    db.prepare(
      `INSERT INTO user_settings (user_id, custom_template_html, template_id)
       VALUES (?, ?, 'custom')
       ON CONFLICT(user_id) DO UPDATE SET
         custom_template_html = excluded.custom_template_html,
         template_id = 'custom',
         updated_at = datetime('now')`,
    ).run(userId, html);
  } else {
    db.prepare(
      `UPDATE user_settings SET
         custom_template_html = NULL,
         template_id = CASE WHEN template_id = 'custom' THEN 'classic' ELSE template_id END,
         updated_at = datetime('now')
       WHERE user_id = ?`,
    ).run(userId);
  }
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
