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
  unit_price: number;
  total: number;
}

export interface ExtractedDocument {
  doc_type: DocType;
  customer_name: string;
  customer_email: string | null;
  customer_vat: string | null;
  document_number: string | null;
  document_date: string | null;
  currency: string;
  line_items: LineItem[];
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  notes: string | null;
}

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

  pdfUrl: (id: number, download = false) =>
    `/api/documents/${id}/pdf${download ? "?download=1" : ""}`,
};

/** Avvia il flusso OAuth: redirect del browser verso il backend. */
export function loginWithGoogle() {
  window.location.href = "/auth/google";
}
