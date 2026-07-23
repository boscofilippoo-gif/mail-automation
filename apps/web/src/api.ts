/** Wrapper fetch verso il backend. `credentials: include` per il cookie di sessione. */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Errore ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** Come request, ma per endpoint che rispondono HTML/testo (es. anteprima). */
async function requestText(path: string, init?: RequestInit): Promise<string> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Errore ${res.status}`);
  }
  return res.text();
}

export type DocType = "fattura" | "preventivo" | "ordine";

export type MailMode = "gmail" | "inoltro";

export interface Me {
  id: number;
  email: string;
  displayName: string | null;
  mailMode: MailMode | null;
  hasGmail: boolean;
}

export interface Keyword {
  id: number;
  term: string;
  doc_type: DocType;
  active: number;
}

export interface LineItem {
  description: string;
  quantity: number;
  unit_price: number | null; // null = prezzo non trovato nel listino, da completare
  total: number | null;
}

export interface ExtractedDocument {
  doc_type: DocType;
  customer_name: string;
  customer_email: string | null;
  customer_vat: string | null;
  customer_address: string | null;
  document_number: string | null;
  document_date: string | null;
  currency: string;
  line_items: LineItem[];
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  notes: string | null;
}

export interface PriceListItem {
  code: string | null;
  description: string;
  unit: string | null;
  unit_price: number;
}

export type ListinoState =
  | { connected: false }
  | {
      connected: true;
      source_type: "sheet" | "pdf" | "csv" | "api";
      source_ref: string;
      item_count: number;
      synced_at: string;
      preview: PriceListItem[];
    };

/** Risposta delle route listino che possono chiedere la riautorizzazione Google. */
export type ListinoResult = ListinoState | { error: string; needsReauth?: boolean };

export type SentStatus = "da_inviare" | "bozza" | "inviato";

export interface DocumentItem {
  id: number;
  type: DocType;
  createdAt: string;
  sourceMessageId: string;
  sentStatus: SentStatus;
  draftId: string | null;
  hasXlsx?: boolean; // true se l'utente ha un modulo birrificio (xlsx scaricabile)
  data: ExtractedDocument;
}

export interface BreweryRow {
  row: number;
  label: string;
  aliases: string[];
}

export interface BreweryTemplateState {
  hasTemplate: boolean;
  name?: string;
  brewery_key?: string;
  qty_column?: string;
  mapping?: BreweryRow[];
}

export interface SourceMail {
  subject: string;
  from: string;
  date: string;
  bodyText: string;
}

export type DraftResult = { sentStatus: SentStatus; draftId: string } | { error: string; needsReauth?: boolean };

export interface ProcessedItem {
  id: number;
  gmail_message_id: string;
  subject: string | null;
  matched_keyword: string | null;
  status: "done" | "error" | "skipped";
  error: string | null;
  processed_at: string;
  category: string | null;
  detail: string | null;
}

export interface ScanResult {
  scanned: number;
  created: number;
  errors: number;
  skipped: number;
  classified: number;
  skippedIrrelevant: number;
  draftsCreated: number;
  remaining: number;
}

export interface ScanRun {
  id: number;
  kind: "manuale" | "giornaliero" | "periodo";
  label: string | null;
  created: number;
  errors: number;
  skipped: number;
  classified: number;
  skipped_irrelevant: number;
  drafts_created: number;
  run_at: string;
}

export type RetryResult =
  | { outcome: "done"; documentId: number }
  | { outcome: "skipped"; category: string; reason: string }
  | { outcome: "error"; error: string };

export interface UserSettings {
  template_id: string;
  accent_color: string | null;
  company_name: string | null;
  company_address: string | null;
  company_vat: string | null;
  company_email: string | null;
  company_phone: string | null;
  footer_note: string | null;
  logo_data_url: string | null;
  smart_scan: number;
  email_signature: string | null;
  auto_draft: number;
  has_custom_template?: boolean;
}

export interface StyleProposal {
  accent_color: string | null;
  company_name: string | null;
  company_address: string | null;
  company_vat: string | null;
  company_email: string | null;
  company_phone: string | null;
  footer_note: string | null;
  template_id: string;
}

export const api = {
  me: () => request<Me>("/api/me"),
  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),

  listKeywords: () => request<Keyword[]>("/api/keywords"),
  addKeyword: (term: string, docType: DocType) =>
    request<Keyword>("/api/keywords", { method: "POST", body: JSON.stringify({ term, docType }) }),
  toggleKeyword: (id: number, active: boolean) =>
    request<{ ok: true }>(`/api/keywords/${id}`, { method: "PATCH", body: JSON.stringify({ active }) }),
  deleteKeyword: (id: number) =>
    request<{ ok: true }>(`/api/keywords/${id}`, { method: "DELETE" }),

  listDocuments: () => request<DocumentItem[]>("/api/documents"),
  listProcessed: () => request<ProcessedItem[]>("/api/documents/processed"),
  scanNow: () => request<ScanResult>("/api/scan", { method: "POST" }),
  scanRangeCount: (from: string, to: string) =>
    request<{ toAnalyze: number }>("/api/scan/range", {
      method: "POST",
      body: JSON.stringify({ from, to, dryRun: true }),
    }),
  scanRangeBatch: (from: string, to: string) =>
    request<ScanResult>("/api/scan/range", { method: "POST", body: JSON.stringify({ from, to }) }),
  retryProcessed: (id: number) =>
    request<RetryResult>(`/api/scan/processed/${id}/retry`, { method: "POST" }),
  listScanHistory: () => request<ScanRun[]>("/api/scan/history"),

  requestMagicLink: (email: string) =>
    request<{ ok: true }>("/auth/magic", { method: "POST", body: JSON.stringify({ email }) }),
  setMailMode: (mode: "inoltro") =>
    request<{ ok: true }>("/api/me/mail-mode", { method: "POST", body: JSON.stringify({ mode }) }),
  getInboundAddress: () =>
    request<{ alias: string; address: string; pendingConfirmation: string | null }>(
      "/api/inbound/address",
    ),
  regenerateInboundAddress: () =>
    request<{ alias: string; address: string; pendingConfirmation: null }>(
      "/api/inbound/address/regenerate",
      { method: "POST" },
    ),
  confirmationDone: () =>
    request<{ ok: true }>("/api/inbound/address/confirmation-done", { method: "POST" }),
  getReplyText: (id: number) =>
    request<{ to: string; subject: string; body: string }>(`/api/documents/${id}/reply-text`, {
      method: "POST",
    }),
  listRunMails: (runId: number) => request<ProcessedItem[]>(`/api/scan/history/${runId}/mails`),

  getSettings: () => request<UserSettings>("/api/settings"),
  saveSettings: (s: Partial<UserSettings>) =>
    request<UserSettings>("/api/settings", { method: "PUT", body: JSON.stringify(s) }),
  previewSettings: (s: Partial<UserSettings>) =>
    requestText("/api/settings/preview", { method: "POST", body: JSON.stringify(s) }),
  analyzeStylePdf: (data: string) =>
    request<StyleProposal>("/api/settings/analyze-pdf", {
      method: "POST",
      body: JSON.stringify({ data }),
    }),
  generateTemplate: (data: string, instructions?: string, settings?: Partial<UserSettings>) =>
    request<{ html: string; preview: string }>("/api/settings/generate-template", {
      method: "POST",
      body: JSON.stringify({ data, instructions, settings }),
    }),
  saveCustomTemplate: (html: string) =>
    request<UserSettings>("/api/settings/custom-template", {
      method: "POST",
      body: JSON.stringify({ html }),
    }),
  deleteCustomTemplate: () =>
    request<UserSettings>("/api/settings/custom-template", { method: "DELETE" }),

  getListino: () => request<ListinoState>("/api/listino"),
  connectSheet: (url: string) =>
    request<ListinoResult>("/api/listino/sheet", { method: "POST", body: JSON.stringify({ url }) }),
  syncListino: () => request<ListinoResult>("/api/listino/sync", { method: "POST" }),
  connectApi: (config: { url: string; authType: string; headerName?: string; secret?: string }) =>
    request<ListinoResult>("/api/listino/api", { method: "POST", body: JSON.stringify(config) }),
  uploadListino: (filename: string, data: string, kind: "pdf" | "csv") =>
    request<ListinoResult>("/api/listino/upload", {
      method: "POST",
      body: JSON.stringify({ filename, data, kind }),
    }),
  deleteListino: () => request<{ ok: true }>("/api/listino", { method: "DELETE" }),

  getDocument: (id: number) =>
    request<{ id: number; type: DocType; createdAt: string; sourceMessageId: string; data: ExtractedDocument }>(
      `/api/documents/${id}`,
    ),
  updateDocument: (id: number, data: ExtractedDocument) =>
    request<{ id: number; type: DocType; createdAt: string; data: ExtractedDocument }>(
      `/api/documents/${id}`,
      { method: "PUT", body: JSON.stringify({ data }) },
    ),
  previewDocument: (data: ExtractedDocument) =>
    requestText("/api/documents/preview", { method: "POST", body: JSON.stringify({ data }) }),
  createDraft: (id: number) => request<DraftResult>(`/api/documents/${id}/draft`, { method: "POST" }),
  getSource: (id: number) => request<SourceMail>(`/api/documents/${id}/source`),
  setStatus: (id: number, sentStatus: SentStatus) =>
    request<{ ok: true }>(`/api/documents/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ sentStatus }),
    }),

  pdfUrl: (id: number, download = false) =>
    `/api/documents/${id}/pdf${download ? "?download=1" : ""}`,
  xlsxUrl: (id: number) => `/api/documents/${id}/xlsx`,

  // ── modulo Excel del birrificio ──
  getBreweryTemplate: () => request<BreweryTemplateState>("/api/settings/brewery-template"),
  uploadBreweryTemplate: (data: string, name: string) =>
    request<BreweryTemplateState>("/api/settings/brewery-template", {
      method: "POST",
      body: JSON.stringify({ data, name }),
    }),
  updateBreweryMapping: (mapping: BreweryRow[]) =>
    request<BreweryTemplateState>("/api/settings/brewery-template", {
      method: "PUT",
      body: JSON.stringify({ mapping }),
    }),
  deleteBreweryTemplate: () =>
    request<BreweryTemplateState>("/api/settings/brewery-template", { method: "DELETE" }),
};

/** Avvia il login Google (soli dati base: nessun avviso). */
export function loginWithGoogle() {
  window.location.href = "/auth/google";
}

/** Avvia il collegamento Gmail completo (modalità diretta, scope pieni). */
export function connectGmail() {
  window.location.href = "/auth/google/connect";
}

/**
 * Link diretto al messaggio su Gmail web. Nota: `u/0` = primo account del
 * browser; con più account Google può aprire quello sbagliato (limite Gmail).
 */
export function gmailUrl(messageId: string): string {
  return `https://mail.google.com/mail/u/0/#all/${messageId}`;
}
