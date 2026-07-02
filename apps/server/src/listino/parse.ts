import type { PriceListItem } from "../types.js";

/** Numero massimo di articoli conservati per listino. */
export const MAX_ITEMS = 2000;

/**
 * Interpreta un prezzo in formato italiano o numerico.
 * Accetta: 12.5 (numero), "12,50", "1.234,56", "€ 12,50", "1234.56", "1.234"
 * Ritorna null se non interpretabile o negativo.
 */
export function parseItalianPrice(v: unknown): number | null {
  if (typeof v === "number") {
    return Number.isFinite(v) && v >= 0 ? v : null;
  }
  if (typeof v !== "string") return null;

  let s = v.replace(/[€\s]/g, "").trim();
  if (!s) return null;

  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    // formato italiano completo: punto = migliaia, virgola = decimali
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    s = s.replace(",", ".");
  } else if (hasDot) {
    // ambiguo: "1.234" è probabilmente migliaia italiane, "12.50" decimali.
    // euristica: esattamente 3 cifre dopo l'unico punto = separatore migliaia
    const m = s.match(/^\d{1,3}(\.\d{3})+$/);
    if (m) s = s.replace(/\./g, "");
  }

  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Mapping colonne individuato dall'AI su un campione di righe. */
export interface ColumnMapping {
  header_row_index: number;
  description_col: number;
  price_col: number;
  code_col: number | null;
  unit_col: number | null;
}

/**
 * Applica il mapping colonne a tutte le righe grezze (Sheet o CSV) e produce
 * gli articoli normalizzati. Salta header, righe senza descrizione o prezzo valido.
 */
export function applyMapping(rows: unknown[][], mapping: ColumnMapping): PriceListItem[] {
  const items: PriceListItem[] = [];
  for (let i = 0; i < rows.length && items.length < MAX_ITEMS; i++) {
    if (i <= mapping.header_row_index) continue;
    const row = rows[i];
    if (!row) continue;

    const rawDesc = row[mapping.description_col];
    const description = rawDesc === null || rawDesc === undefined ? "" : String(rawDesc).trim();
    if (!description) continue;

    const price = parseItalianPrice(row[mapping.price_col]);
    if (price === null) continue;

    const rawCode = mapping.code_col !== null ? row[mapping.code_col] : null;
    const rawUnit = mapping.unit_col !== null ? row[mapping.unit_col] : null;
    items.push({
      code: rawCode !== null && rawCode !== undefined && String(rawCode).trim() !== "" ? String(rawCode).trim() : null,
      description: description.slice(0, 300),
      unit: rawUnit !== null && rawUnit !== undefined && String(rawUnit).trim() !== "" ? String(rawUnit).trim().slice(0, 20) : null,
      unit_price: price,
    });
  }
  return items;
}

/**
 * Parser CSV minimale ma quote-aware (gestisce campi tra doppi apici con
 * delimitatori e newline interni, e l'escape "" dentro i campi).
 */
export function parseCsv(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}
