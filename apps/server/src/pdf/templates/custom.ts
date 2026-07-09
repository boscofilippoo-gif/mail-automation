import type { ExtractedDocument, TemplateSettings } from "../../types.js";
import { DOC_LABEL, defaultAccent, esc, money, safeColor } from "../helpers.js";

/**
 * Mini-engine per i template su misura generati dall'AI.
 *
 * L'AI produce un documento HTML completo che usa SOLO i token qui sotto;
 * il render è pura sostituzione testuale con valori escapati — niente
 * espressioni, niente logica, niente codice eseguibile.
 */

const ROW_START = "<!--ROW_START-->";
const ROW_END = "<!--ROW_END-->";

/** Token scalari ammessi fuori dal blocco righe (tutti escapati). */
const SCALAR_TOKENS = new Set([
  "customer_name",
  "customer_address",
  "customer_vat",
  "customer_email",
  "document_number",
  "document_date",
  "doc_type_label",
  "subtotal",
  "tax",
  "total",
  "notes",
  "company_name",
  "company_address",
  "company_vat",
  "company_email",
  "company_phone",
  "footer_note",
  // raw-html ma validati a monte (LOGO_RE / safeColor)
  "logo",
  "accent_color",
]);

/** Token ammessi dentro il blocco righe. */
const ROW_TOKENS = new Set(["description", "quantity", "unit_price", "line_total"]);

const MAX_TEMPLATE_CHARS = 150_000;

// Stesso formato accettato dalla route settings per il logo.
const LOGO_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

/**
 * Come esc(), ma copre anche l'apostrofo: l'AI può emettere attributi
 * single-quoted, e un dato di terzi con `'` uscirebbe dall'attributo.
 */
function escAll(v: unknown): string {
  return esc(v).replace(/'/g, "&#39;");
}

/** Sostituisce ogni {{token}} presente nella mappa; i valori sono già pronti. */
function substitute(html: string, values: Record<string, string>): string {
  // funzione di rimpiazzo: un `$&` dentro i dati non deve mai essere interpretato
  return html.replace(/\{\{(\w+)\}\}/g, (whole, name: string) =>
    Object.hasOwn(values, name) ? values[name]! : whole,
  );
}

/**
 * Valida il template generato. Ritorna [] se valido, altrimenti la lista
 * degli errori (in italiano: finiscono nella UI e nel retry dell'AI).
 */
export function validateCustomTemplate(html: string): string[] {
  const errors: string[] = [];

  if (!html.trim()) return ["Il template è vuoto."];
  if (html.length > MAX_TEMPLATE_CHARS) {
    errors.push(`Il template supera ${Math.round(MAX_TEMPLATE_CHARS / 1000)}KB.`);
  }

  // ── blocco righe: esattamente uno, bilanciato ──
  const starts = html.split(ROW_START).length - 1;
  const ends = html.split(ROW_END).length - 1;
  if (starts !== 1 || ends !== 1) {
    errors.push("Serve esattamente un blocco righe <!--ROW_START--> … <!--ROW_END-->.");
  } else if (html.indexOf(ROW_START) > html.indexOf(ROW_END)) {
    errors.push("Il blocco righe è invertito: <!--ROW_END--> viene prima di <!--ROW_START-->.");
  }

  // ── token: whitelist rigida, mai sostituzioni silenziose ──
  const rowBlock = starts === 1 && ends === 1 ? extractRowBlock(html).row : "";
  const outside = starts === 1 && ends === 1 ? extractRowBlock(html).before + extractRowBlock(html).after : html;
  for (const m of outside.matchAll(/\{\{(\w+)\}\}/g)) {
    if (!SCALAR_TOKENS.has(m[1]!)) errors.push(`Token sconosciuto fuori dal blocco righe: {{${m[1]}}}.`);
  }
  for (const m of rowBlock.matchAll(/\{\{(\w+)\}\}/g)) {
    if (!ROW_TOKENS.has(m[1]!) && !SCALAR_TOKENS.has(m[1]!)) {
      errors.push(`Token sconosciuto nel blocco righe: {{${m[1]}}}.`);
    }
  }
  for (const required of ["total", "customer_name"]) {
    if (!html.includes(`{{${required}}}`)) errors.push(`Manca il token obbligatorio {{${required}}}.`);
  }
  if (rowBlock && !rowBlock.includes("{{description}}")) {
    errors.push("Il blocco righe deve contenere {{description}}.");
  }

  // ── contenuti vietati (JS è comunque spento in Puppeteer: difesa in profondità) ──
  const forbidden: Array<[RegExp, string]> = [
    [/<script/i, "<script>"],
    [/\bon\w+\s*=/i, "attributi on*="],
    [/javascript:/i, "javascript:"],
    [/<iframe/i, "<iframe>"],
    [/<object/i, "<object>"],
    [/<embed/i, "<embed>"],
    [/<form/i, "<form>"],
    [/<link/i, "<link>"],
    [/@import/i, "@import"],
    [/srcdoc/i, "srcdoc"],
  ];
  for (const [re, label] of forbidden) {
    if (re.test(html)) errors.push(`Contenuto non ammesso: ${label}.`);
  }
  // URL esterni: ammesse solo immagini data: (il PDF deve essere autosufficiente)
  if (/(?:src|href)\s*=\s*["']?\s*https?:\/\//i.test(html) || /url\(\s*["']?\s*https?:\/\//i.test(html)) {
    errors.push("URL esterni non ammessi: usa solo immagini data: o il token {{logo}}.");
  }

  return errors;
}

function extractRowBlock(html: string): { before: string; row: string; after: string } {
  const s = html.indexOf(ROW_START);
  const e = html.indexOf(ROW_END);
  if (s === -1 || e === -1 || e < s) return { before: html, row: "", after: "" };
  return {
    before: html.slice(0, s),
    row: html.slice(s + ROW_START.length, e),
    after: html.slice(e + ROW_END.length),
  };
}

/** Renderizza il template custom con i dati del documento e le impostazioni. */
export function renderCustom(
  template: string,
  doc: ExtractedDocument,
  s: TemplateSettings,
): string {
  const logo =
    s.logo_data_url && LOGO_RE.test(s.logo_data_url)
      ? `<img src="${s.logo_data_url}" alt="logo" style="max-height:60px;max-width:220px;object-fit:contain" />`
      : "";

  const scalars: Record<string, string> = {
    customer_name: escAll(doc.customer_name),
    customer_address: escAll(doc.customer_address),
    customer_vat: escAll(doc.customer_vat),
    customer_email: escAll(doc.customer_email),
    document_number: escAll(doc.document_number),
    document_date: escAll(doc.document_date),
    doc_type_label: DOC_LABEL[doc.doc_type],
    subtotal: money(doc.subtotal, doc.currency),
    tax: money(doc.tax, doc.currency),
    total: money(doc.total, doc.currency),
    notes: escAll(doc.notes),
    company_name: escAll(s.company_name),
    company_address: escAll(s.company_address),
    company_vat: escAll(s.company_vat),
    company_email: escAll(s.company_email),
    company_phone: escAll(s.company_phone),
    footer_note: escAll(s.footer_note),
    logo,
    accent_color: safeColor(s.accent_color, defaultAccent(doc.doc_type)),
  };

  const { before, row, after } = extractRowBlock(template);
  const rows = doc.line_items
    .map((li) =>
      substitute(row, {
        ...scalars,
        description: escAll(li.description),
        quantity: escAll(li.quantity),
        unit_price: money(li.unit_price, doc.currency),
        line_total: money(li.total, doc.currency),
      }),
    )
    .join("");

  return substitute(before, scalars) + rows + substitute(after, scalars);
}
