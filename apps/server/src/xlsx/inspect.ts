import ExcelJS from "exceljs";

import type { BreweryRow } from "../types.js";

/**
 * Analisi di un modulo Excel di birrificio.
 *
 * I moduli reali (es. "ORDERS EXPORT ITALY" di Eschenbacher) sono fogli
 * pre-costruiti: righe-prodotto con contenuto, pesi e formule già dentro.
 * Cambia solo la colonna "Ordered Quantity" a ogni ordine. Qui rileviamo:
 * quale colonna riempire e quali righe sono prodotti (con la loro etichetta),
 * così l'utente conferma la mappa e a runtime scriviamo solo le quantità.
 */
export interface BreweryInspection {
  sheetName: string;
  qtyColumn: string; // lettera colonna quantità (es. "E")
  rows: BreweryRow[]; // righe-prodotto con label; aliases inizialmente vuoti
}

// intestazioni di blocco da NON trattare come prodotti (categorie del modulo)
const BLOCK_HEADERS = /^(key\s*keg|fusti|keg|bottiglie|bottles|cans|lattine|imballi?)/i;
// note/righe di servizio da scartare (asterischi, "solo su prenotazione", ecc.)
const NOTE_LINE = /^[*\s.]|solo su prenotazione|minimo|nota|note|attenzione|^\s*$/i;

/** Estrae testo pulito da una cella exceljs (stringa, numero, o rich text {richText}/{text}). */
function cellText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  const o = v as { text?: unknown; richText?: Array<{ text?: unknown }>; result?: unknown };
  if (typeof o.text === "string") return o.text.trim();
  if (Array.isArray(o.richText)) return o.richText.map((p) => (typeof p.text === "string" ? p.text : "")).join("").trim();
  if (typeof o.result === "string") return o.result.trim();
  return ""; // oggetti non testuali (formule senza risultato stringa, hyperlink…) → ignorati
}

/** Riconosce l'header dei prezzi/quantità in una riga del foglio. */
function looksLikeQtyHeader(v: string): boolean {
  const s = v.trim().toLowerCase();
  return s.startsWith("ordered quantity") || s === "quantità" || s === "quantity" || s === "qta" || s === "q.tà";
}
function looksLikeDescHeader(v: string): boolean {
  const s = v.trim().toLowerCase();
  return s === "description" || s === "descrizione" || s === "articolo" || s === "prodotto";
}

/**
 * Legge un .xlsx (base64) e ne ricava colonna quantità + righe-prodotto.
 * Lancia con messaggio chiaro se il modulo non è riconoscibile.
 */
export async function inspectBreweryXlsx(base64: string): Promise<BreweryInspection> {
  const buf = Buffer.from(base64.replace(/^data:[^;]+;base64,/, ""), "base64");
  const wb = new ExcelJS.Workbook();
  try {
    // exceljs tipizza load() con un Buffer meno specifico del Buffer<ArrayBuffer> di Node
    await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
  } catch {
    throw new Error("File Excel non valido o corrotto.");
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("Il file Excel non contiene fogli.");

  // 1) trova la riga header e le colonne descrizione/quantità
  let headerRow = 0;
  let qtyCol = 0;
  let descCol = 0;
  ws.eachRow((row, rn) => {
    if (headerRow) return;
    let foundQty = 0;
    let foundDesc = 0;
    row.eachCell((cell, cn) => {
      const v = cell.value == null ? "" : String(cell.value);
      if (looksLikeQtyHeader(v)) foundQty = cn;
      if (looksLikeDescHeader(v)) foundDesc = cn;
    });
    if (foundQty) {
      headerRow = rn;
      qtyCol = foundQty;
      descCol = foundDesc;
    }
  });
  if (!headerRow || !qtyCol) {
    throw new Error(
      'Non ho trovato la colonna "Ordered Quantity" nel modulo. Assicurati che sia il file standard del birrificio.',
    );
  }

  // 2) righe-prodotto: scorro sotto l'header e prendo l'etichetta dalla cella
  // più informativa tra le prime colonne (nei moduli reali il nome sta in B,
  // non nella colonna "Description" che contiene solo "Key keg").
  const rows: BreweryRow[] = [];
  const maxScanCol = Math.max(descCol, 3);
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    // etichetta candidata: la stringa più lunga tra le colonne A..maxScanCol
    let label = "";
    for (let c = 1; c <= maxScanCol; c++) {
      const s = cellText(row.getCell(c).value);
      if (s.length > label.length) label = s;
    }
    label = label.replace(/\s+/g, " ").trim();
    if (!label || label.length < 3) continue; // vuota o troppo corta
    if (BLOCK_HEADERS.test(label)) continue; // intestazione di categoria, non un prodotto
    if (NOTE_LINE.test(label)) continue; // note/righe di servizio
    // un prodotto vero ha una quantità O una cella di configurazione (kegs/layer): se la
    // riga non ha NULLA nelle colonne numeriche del blocco articoli, è probabilmente una nota
    const hasNumericData = [qtyCol, qtyCol + 1, qtyCol + 2, qtyCol + 3].some((c) => {
      const v = row.getCell(c).value;
      return typeof v === "number" || (v != null && typeof (v as { formula?: unknown }).formula === "string");
    });
    if (!hasNumericData) continue;
    rows.push({ row: r, label, aliases: [] });
  }

  if (rows.length === 0) {
    throw new Error("Nessuna riga-prodotto trovata nel modulo.");
  }

  return {
    sheetName: ws.name,
    qtyColumn: ws.getColumn(qtyCol).letter,
    rows,
  };
}
