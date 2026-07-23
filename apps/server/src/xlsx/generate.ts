import path from "node:path";
import crypto from "node:crypto";

import ExcelJS from "exceljs";

import { XLSX_DIR } from "../db.js";
import type { BreweryTemplate, ExtractedDocument, SortAssignment } from "../types.js";

/** Esito della generazione: path del file + righe dell'ordine non mappate. */
export interface XlsxResult {
  filePath: string;
  unmatched: string[]; // descrizioni dell'ordine senza riga corrispondente nel modulo
}

/**
 * Genera l'Excel del birrificio dall'ordine estratto.
 *
 * Carica il modulo (con tutte le sue formule/formattazione), azzera la colonna
 * quantità, e vi scrive le quantità delle righe d'ordine mappate su una riga del
 * modulo. `assignments` è la mappa {indice line_item → riga del modulo} decisa
 * dall'AI (mapBrewery); qui è solo scrittura di celle, nessuna logica di match.
 * Le formule del modulo (pesi, pallet, totali) ricalcolano all'apertura.
 */
export async function generateBreweryXlsx(
  doc: ExtractedDocument,
  template: BreweryTemplate,
  assignments: Map<number, number>, // line_item index → riga Excel del modulo
): Promise<XlsxResult> {
  const buf = Buffer.from(template.xlsx_base64.replace(/^data:[^;]+;base64,/, ""), "base64");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const ws = template.sheet_name ? (wb.getWorksheet(template.sheet_name) ?? wb.worksheets[0]) : wb.worksheets[0];
  if (!ws) throw new Error("Modulo Excel senza fogli.");

  const col = template.qty_column;

  // 1) azzera la colonna quantità su tutte le righe-prodotto del modulo
  for (const r of template.mapping) {
    ws.getCell(`${col}${r.row}`).value = null;
  }

  // 2) scrivi le quantità mappate (somma se più righe d'ordine cadono sulla stessa riga)
  const unmatched: string[] = [];
  const written = new Map<number, number>();
  doc.line_items.forEach((li, i) => {
    const targetRow = assignments.get(i);
    if (targetRow == null) {
      unmatched.push(li.description);
      return;
    }
    const qty = Number.isFinite(li.quantity) ? li.quantity : 0;
    written.set(targetRow, (written.get(targetRow) ?? 0) + qty);
  });
  for (const [row, qty] of written) {
    ws.getCell(`${col}${row}`).value = qty;
  }

  // 3) salva su disco (rigenerabile: il disco Render è effimero)
  const fileName = `ordine-${template.brewery_key}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.xlsx`;
  const filePath = path.join(XLSX_DIR, fileName);
  await wb.xlsx.writeFile(filePath);

  return { filePath, unmatched };
}

/**
 * Genera il file di UN fornitore a partire dalle assegnazioni di smistamento
 * cross-modulo. Filtra le assegnazioni di questo brewery_key e riusa
 * generateBreweryXlsx. Ritorna null se nessuna riga è assegnata a questo
 * fornitore (non si crea un Excel vuoto).
 */
export async function generateForBrewery(
  doc: ExtractedDocument,
  template: BreweryTemplate,
  assignments: SortAssignment[],
): Promise<XlsxResult | null> {
  const mine = new Map<number, number>();
  for (const a of assignments) {
    if (a.breweryKey === template.brewery_key) mine.set(a.itemIndex, a.row);
  }
  if (mine.size === 0) return null; // nessuna riga per questo fornitore → niente file
  return generateBreweryXlsx(doc, template, mine);
}
