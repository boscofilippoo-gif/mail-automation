/** Tipi di documento che il sistema sa generare. */
export type DocType = "fattura" | "preventivo" | "ordine";

export const DOC_TYPES: DocType[] = ["fattura", "preventivo", "ordine"];

export interface User {
  id: number;
  google_sub: string;
  email: string;
  display_name: string | null;
  created_at: string;
}

export interface Keyword {
  id: number;
  user_id: number;
  term: string;
  doc_type: DocType;
  active: number; // 0 | 1 (SQLite non ha boolean nativo)
}

export type ProcessedStatus = "done" | "error" | "skipped";

export interface Processed {
  id: number;
  user_id: number;
  gmail_message_id: string;
  subject: string | null;
  matched_keyword: string | null;
  status: ProcessedStatus;
  document_id: number | null;
  error: string | null;
  processed_at: string;
}

export interface DocumentRecord {
  id: number;
  user_id: number;
  type: DocType;
  extracted_json: string;
  pdf_path: string;
  source_message_id: string;
  created_at: string;
}

/** Personalizzazione del documento PDF (template, colori, dati azienda, logo). */
export interface TemplateSettings {
  template_id: string; // 'classic' | 'minimal' | 'bold'
  accent_color: string | null; // '#rrggbb' oppure null = default per tipo documento
  company_name: string | null;
  company_address: string | null;
  company_vat: string | null;
  company_email: string | null;
  company_phone: string | null;
  footer_note: string | null;
  logo_data_url: string | null; // 'data:image/png;base64,...' (max ~700k caratteri)
}

/** Impostazioni utente complete: personalizzazione PDF + preferenze di scansione. */
export interface UserSettings extends TemplateSettings {
  smart_scan: number; // 0 | 1 (come keywords.active)
}

/**
 * Default in codice, NON nel DB: un utente senza riga in user_settings riceve questi.
 * Vive qui (e non in pdf/) per evitare un import circolare repo ↔ templates.
 */
export const DEFAULT_SETTINGS: UserSettings = {
  template_id: "classic",
  accent_color: null,
  company_name: null,
  company_address: null,
  company_vat: null,
  company_email: null,
  company_phone: null,
  footer_note: null,
  logo_data_url: null,
  smart_scan: 0,
};

/**
 * Una riga di una fattura/preventivo/ordine.
 * unit_price/total possono essere null: articolo richiesto ma non trovato nel
 * listino (prezzo da completare a mano nell'editor — mai inventato dall'AI).
 */
export interface LineItem {
  description: string;
  quantity: number;
  unit_price: number | null;
  total: number | null;
}

/** Un articolo del listino prezzi dell'utente. */
export interface PriceListItem {
  code: string | null;
  description: string;
  unit: string | null;
  unit_price: number;
}

export type PriceListSource = "sheet" | "pdf" | "csv";

export interface PriceListMeta {
  source_type: PriceListSource;
  source_ref: string; // spreadsheetId oppure nome file
  item_count: number;
  synced_at: string;
}

/** Struttura dei dati estratti da Claude a partire dal testo della mail. */
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
