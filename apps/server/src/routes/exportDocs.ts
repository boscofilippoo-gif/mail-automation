import fs from "node:fs";

import { createRequire } from "node:module";
import type { Archiver, ArchiverOptions } from "archiver";

// @types/archiver (v8) non dichiara la funzione di default: la prendiamo via require tipizzato
const require = createRequire(import.meta.url);
const archiver = require("archiver") as (format: "zip", options?: ArchiverOptions) => Archiver;
import type { Response } from "express";

import { generatePdf } from "../pdf/generate.js";
import { getCustomCustomerName, getCustomTemplateHtml, getUserSettings, queryDocuments, setDocumentPdfPath, type DocumentListRow, type DocumentQuery } from "../repo.js";
import type { ExtractedDocument } from "../types.js";

/* ───────────────── Export dei documenti filtrati: CSV e ZIP dei PDF ─────────────────
   Stessi filtri della lista (q, type, status, from, to, review, customer): l'utente
   esporta esattamente quello che vede. Limiti: 5000 righe per il CSV, 500 PDF per lo ZIP. */

export const CSV_MAX = 5000;
export const ZIP_MAX = 500;

const STATUS_LABEL: Record<string, string> = { da_inviare: "Da inviare", bozza: "Bozza in Gmail", inviato: "Inviato" };

/** Nome file sicuro e leggibile: "2026-09-09_fattura_Bar-Centrale_F-2026-001.pdf". */
function safeName(s: string | null | undefined, cap = 40): string {
  return (s ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, cap) || "senza-nome";
}
const UNKNOWN_NAME = /^<?\s*(unknown|n\/?a|non\s+(rilevato|disponibile)|sconosciuto)\s*>?$/i;
function pdfFileName(d: DocumentListRow, data: ExtractedDocument, customerName: string | null): string {
  const date = d.created_at.slice(0, 10);
  const raw = customerName ?? data.customer_name;
  const who = !raw?.trim() || UNKNOWN_NAME.test(raw.trim()) ? "Cliente-non-rilevato" : safeName(raw);
  const num = data.document_number ? `_${safeName(data.document_number, 30)}` : "";
  return `${date}_${d.type}_${who}${num}_${d.id}.pdf`;
}

/** Cella CSV: virgolette raddoppiate; separatore ";" (Excel italiano); numeri con la virgola. */
function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return String(v).replace(".", ",");
  const s = String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvOf(rows: DocumentListRow[], customerNames: Map<number, string>): string {
  const head = ["Data", "Tipo", "Numero", "Cliente", "P.IVA", "Email cliente", "Imponibile", "Imposta", "Totale", "Valuta", "Stato", "Righe", "Oggetto mail", "ID"];
  const lines = [head.join(";")];
  for (const d of rows) {
    const data = JSON.parse(d.extracted_json) as ExtractedDocument;
    lines.push(
      [
        d.created_at.slice(0, 10),
        d.type,
        data.document_number,
        (d.customer_id && customerNames.get(d.customer_id)) || data.customer_name,
        data.customer_vat,
        data.customer_email,
        data.subtotal,
        data.tax,
        data.total,
        data.currency,
        STATUS_LABEL[d.sent_status] ?? d.sent_status,
        data.line_items.length,
        d.subject,
        d.id,
      ].map(cell).join(";"),
    );
  }
  return "﻿" + lines.join("\r\n") + "\r\n"; // BOM: Excel apre UTF-8 senza chiedere
}

/** Esegue la query completa (senza paginazione) coi filtri passati. */
export function collect(userId: number, filters: Omit<DocumentQuery, "limit" | "offset">, max: number) {
  const { items, total } = queryDocuments(userId, { ...filters, limit: max, offset: 0 });
  return { items, total, truncated: total > items.length };
}

export function sendCsv(res: Response, userId: number, filters: Omit<DocumentQuery, "limit" | "offset">) {
  const { items, truncated } = collect(userId, filters, CSV_MAX);
  const names = getCustomCustomerName(userId, items.map((d) => d.customer_id).filter((x): x is number => x !== null));
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="documenti_${stamp}.csv"`);
  if (truncated) res.setHeader("X-Export-Truncated", "1");
  res.send(csvOf(items, names));
}

export async function sendZip(res: Response, userId: number, filters: Omit<DocumentQuery, "limit" | "offset">) {
  const { items, truncated } = collect(userId, filters, ZIP_MAX);
  if (items.length === 0) {
    res.status(404).json({ error: "Nessun documento da esportare con questi filtri." });
    return;
  }
  const names = getCustomCustomerName(userId, items.map((d) => d.customer_id).filter((x): x is number => x !== null));
  const settings = getUserSettings(userId);
  const custom = getCustomTemplateHtml(userId);
  const stamp = new Date().toISOString().slice(0, 10);

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="documenti_${stamp}.zip"`);
  if (truncated) res.setHeader("X-Export-Truncated", "1");

  const zip = archiver("zip", { zlib: { level: 6 } });
  zip.on("warning", (e: Error) => console.warn("[export] zip warning:", e.message));
  zip.on("error", (e: Error) => {
    console.error("[export] zip error:", e.message);
    if (!res.headersSent) res.status(500).json({ error: "Errore nella creazione dello ZIP" });
    else res.end();
  });
  zip.pipe(res);

  const used = new Set<string>();
  for (const d of items) {
    const data = JSON.parse(d.extracted_json) as ExtractedDocument;
    // il PDF può mancare (disco effimero): rigeneralo e ricordalo
    let pdfPath = d.pdf_path;
    if (!fs.existsSync(pdfPath)) {
      try {
        pdfPath = await generatePdf(data, settings, custom);
        setDocumentPdfPath(userId, d.id, pdfPath);
      } catch (e) {
        console.error(`[export] PDF ${d.id} non rigenerabile:`, e instanceof Error ? e.message : e);
        continue;
      }
    }
    let name = pdfFileName(d, data, d.customer_id ? names.get(d.customer_id) ?? null : null);
    if (used.has(name)) name = name.replace(/\.pdf$/, `_${d.id}.pdf`);
    used.add(name);
    zip.file(pdfPath, { name });
  }
  zip.append(csvOf(items, names), { name: "indice.csv" });
  await zip.finalize();
}
