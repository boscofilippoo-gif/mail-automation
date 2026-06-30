import path from "node:path";
import crypto from "node:crypto";

import puppeteer from "puppeteer";
import type { Browser } from "puppeteer";

import { PDF_DIR } from "../db.js";
import type { ExtractedDocument } from "../types.js";
import { renderDocumentHtml } from "./template.js";

// Riusiamo una sola istanza del browser tra una generazione e l'altra (lazy).
let browserPromise: Promise<Browser> | null = null;

function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }
  return browserPromise;
}

/** Chiude il browser condiviso (chiamato allo shutdown del server). */
export async function closePdfBrowser(): Promise<void> {
  if (browserPromise) {
    const b = await browserPromise;
    await b.close();
    browserPromise = null;
  }
}

/**
 * Genera il PDF dal documento estratto e lo salva in data/pdfs/.
 * Ritorna il path assoluto del file creato.
 */
export async function generatePdf(doc: ExtractedDocument): Promise<string> {
  const html = renderDocumentHtml(doc);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "load" });
    const fileName = `${doc.doc_type}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.pdf`;
    const filePath = path.join(PDF_DIR, fileName);
    await page.pdf({
      path: filePath,
      format: "A4",
      printBackground: true,
      margin: { top: "0", bottom: "0", left: "0", right: "0" },
    });
    return filePath;
  } finally {
    await page.close();
  }
}
