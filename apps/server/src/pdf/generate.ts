import path from "node:path";
import crypto from "node:crypto";

import puppeteer from "puppeteer";
import type { Browser } from "puppeteer";

import { PDF_DIR } from "../db.js";
import { DEFAULT_SETTINGS, type ExtractedDocument, type TemplateSettings } from "../types.js";
import { getTemplate } from "./templates/index.js";

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
 * Genera il PDF dal documento estratto, col template/personalizzazioni utente,
 * e lo salva in data/pdfs/. Ritorna il path assoluto del file creato.
 */
export async function generatePdf(
  doc: ExtractedDocument,
  settings: TemplateSettings = DEFAULT_SETTINGS,
): Promise<string> {
  const html = getTemplate(settings.template_id).render(doc, settings);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // i template sono HTML/CSS puri: JS spento = difesa in profondità contro XSS nel PDF
    await page.setJavaScriptEnabled(false);
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
