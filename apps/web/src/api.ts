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

export interface Me {
  id: number;
  email: string;
  displayName: string | null;
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
      source_type: "sheet" | "pdf" | "csv";
      source_ref: string;
      item_count: number;
      synced_at: string;
      preview: PriceListItem[];
    };

/** Risposta delle route listino che possono chiedere la riautorizzazione Google. */
export type ListinoResult = ListinoState | { error: string; needsReauth?: boolean };

export interface DocumentItem {
  id: number;
  type: DocType;
  createdAt: string;
  sourceMessageId: string;
  data: ExtractedDocument;
}

export interface ProcessedItem {
  id: number;
  gmail_message_id: string;
  subject: string | null;
  matched_keyword: string | null;
  status: "done" | "error" | "skipped";
  error: string | null;
  processed_at: string;
}

export interface ScanResult {
  scanned: number;
  created: number;
  errors: number;
  skipped: number;
  classified: number;
  skippedIrrelevant: number;
}

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

  getSettings: () => request<UserSettings>("/api/settings"),
  saveSettings: (s: Partial<UserSettings>) =>
    request<UserSettings>("/api/settings", { method: "PUT", body: JSON.stringify(s) }),
  previewSettings: (s: Partial<UserSettings>) =>
    requestText("/api/settings/preview", { method: "POST", body: JSON.stringify(s) }),

  getListino: () => request<ListinoState>("/api/listino"),
  connectSheet: (url: string) =>
    request<ListinoResult>("/api/listino/sheet", { method: "POST", body: JSON.stringify({ url }) }),
  syncListino: () => request<ListinoResult>("/api/listino/sync", { method: "POST" }),
  uploadListino: (filename: string, data: string, kind: "pdf" | "csv") =>
    request<ListinoResult>("/api/listino/upload", {
      method: "POST",
      body: JSON.stringify({ filename, data, kind }),
    }),
  deleteListino: () => request<{ ok: true }>("/api/listino", { method: "DELETE" }),

  getDocument: (id: number) =>
    request<{ id: number; type: DocType; createdAt: string; data: ExtractedDocument }>(
      `/api/documents/${id}`,
    ),
  updateDocument: (id: number, data: ExtractedDocument) =>
    request<{ id: number; type: DocType; createdAt: string; data: ExtractedDocument }>(
      `/api/documents/${id}`,
      { method: "PUT", body: JSON.stringify({ data }) },
    ),
  previewDocument: (data: ExtractedDocument) =>
    requestText("/api/documents/preview", { method: "POST", body: JSON.stringify({ data }) }),

  pdfUrl: (id: number, download = false) =>
    `/api/documents/${id}/pdf${download ? "?download=1" : ""}`,
};

/** Avvia il flusso OAuth: redirect del browser verso il backend. */
export function loginWithGoogle() {
  window.location.href = "/auth/google";
}
