/** Tipi di documento che il sistema sa generare. */
export type DocType = "fattura" | "preventivo" | "ordine";

export const DOC_TYPES: DocType[] = ["fattura", "preventivo", "ordine"];

/** Come l'utente ha collegato la casella: Gmail diretto, inoltro, o non ancora scelto. */
export type MailMode = "gmail" | "inoltro";

export interface User {
  id: number;
  google_sub: string | null; // null per utenti magic-link non ancora collegati a Google
  email: string;
  display_name: string | null;
  created_at: string;
  mail_mode: MailMode | null;
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
  category: string | null; // categoria della classificazione AI (null per righe pre-feature)
  detail: string | null; // motivo in una frase, per l'utente
  scan_run_id: number | null; // run che ha elaborato la mail (null per righe pre-feature)
}

/** Origine di un'esecuzione di scan registrata nello storico. */
export type ScanRunKind = "manuale" | "giornaliero" | "periodo";

export interface ScanRun {
  id: number;
  user_id: number;
  kind: ScanRunKind;
  label: string | null;
  created: number;
  errors: number;
  skipped: number;
  classified: number;
  skipped_irrelevant: number;
  drafts_created: number;
  run_at: string;
}

/** Stato di invio di un documento generato. */
export type SentStatus = "da_inviare" | "bozza" | "inviato";

export const SENT_STATUSES: SentStatus[] = ["da_inviare", "bozza", "inviato"];

export interface DocumentRecord {
  id: number;
  user_id: number;
  type: DocType;
  extracted_json: string;
  pdf_path: string;
  source_message_id: string;
  created_at: string;
  sent_status: SentStatus;
  draft_id: string | null;
  xlsx_path: string | null; // Excel del birrificio, se l'utente usa un modulo
  sort_assignments_json: string | null; // smistamento {itemIndex→brewery_key} confermato
}

/** Assegnazione di una riga d'ordine a una riga di un modulo birrificio (smistamento). */
export interface SortAssignment {
  itemIndex: number;
  breweryKey: string;
  row: number;
}

/** Una riga-prodotto del modulo Excel di un birrificio, con sinonimi per il match. */
export interface BreweryRow {
  row: number; // indice riga 1-based nel foglio Excel
  label: string; // testo della colonna Description del modulo
  aliases: string[]; // sinonimi liberi ("hell", "bionda"…) per la mappatura AI
}

/** Modulo Excel di un birrificio salvato per l'utente. */
export interface BreweryTemplate {
  brewery_key: string;
  name: string;
  xlsx_base64: string;
  mapping: BreweryRow[];
  qty_column: string; // colonna quantità da riempire (es. "E")
  sheet_name: string | null;
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
  email_signature: string | null; // firma appesa alle bozze di risposta
  auto_draft: number; // 0 | 1: crea la bozza automaticamente dopo lo scan
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
  email_signature: null,
  auto_draft: 0,
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

export type PriceListSource = "sheet" | "pdf" | "csv" | "api";

/** Configurazione del connettore API listino (salvata CIFRATA, mai inviata al client). */
export interface ApiConnectorConfig {
  url: string;
  authType: "none" | "apikey" | "bearer" | "basic";
  headerName?: string; // per apikey: nome dell'header (es. X-Api-Key)
  secret?: string; // apikey/bearer: il token; basic: "utente:password"
}

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
