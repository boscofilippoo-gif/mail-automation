import fs from "node:fs";

import { Router } from "express";

import { requireAuth } from "../auth/session.js";
import {
  getDocument,
  getUserSettings,
  hasScope,
  listDocuments,
  listProcessed,
  updateDocument,
  updateDocumentStatus,
} from "../repo.js";
import { getTemplate } from "../pdf/templates/index.js";
import { generatePdf } from "../pdf/generate.js";
import { getAuthedClientForUser } from "../auth/google.js";
import { hydrateMessage } from "../gmail/scan.js";
import { getMailForUser } from "../jobs/dailyScan.js";
import { createReplyDraft, fetchReplyMeta } from "../gmail/draft.js";
import { NeedsReauthError } from "../listino/sheet.js";
import { generateReplyBody } from "../ai/reply.js";
import { DRAFTS_SCOPE } from "../env.js";
import {
  DOC_TYPES,
  SENT_STATUSES,
  type DocType,
  type ExtractedDocument,
  type LineItem,
  type SentStatus,
} from "../types.js";

export const documentsRouter = Router();

documentsRouter.use(requireAuth);

/* ───────────────── Validazione documento modificato ───────────────── */

function cleanStr(v: unknown, cap: number): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().slice(0, cap);
  return s || null;
}

function cleanNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Valida e normalizza un documento modificato dall'editor.
 * Ricomputo difensivo: total riga = qty × prezzo (null se prezzo null);
 * subtotal = somma dei non-null (null se nessuna riga ha prezzo);
 * total = subtotal + (tax ?? 0). L'imposta è libera, mai ricalcolata.
 */
function validateDocument(body: unknown): ExtractedDocument {
  const b = (body ?? {}) as Record<string, unknown>;
  const rawItems = Array.isArray(b.line_items) ? b.line_items : [];
  if (rawItems.length > 100) throw new Error("Troppe righe (max 100).");

  const line_items: LineItem[] = rawItems.map((r) => {
    const li = (r ?? {}) as Record<string, unknown>;
    const description = cleanStr(li.description, 300) ?? "";
    if (!description) throw new Error("Ogni riga deve avere una descrizione.");
    const quantity = cleanNum(li.quantity);
    if (quantity === null || quantity < 0) throw new Error(`Quantità non valida per "${description}".`);
    const unit_price = cleanNum(li.unit_price);
    if (unit_price !== null && unit_price < 0) throw new Error(`Prezzo non valido per "${description}".`);
    const total = unit_price === null ? null : Math.round(quantity * unit_price * 100) / 100;
    return { description, quantity, unit_price, total };
  });

  const totals = line_items.map((li) => li.total).filter((t): t is number => t !== null);
  const subtotal = totals.length ? Math.round(totals.reduce((a, b) => a + b, 0) * 100) / 100 : null;
  const tax = cleanNum(b.tax);
  const total = subtotal === null ? null : Math.round((subtotal + (tax ?? 0)) * 100) / 100;

  const docType = DOC_TYPES.includes(b.doc_type as DocType) ? (b.doc_type as DocType) : "preventivo";
  const rawDate = cleanStr(b.document_date, 10);

  return {
    doc_type: docType,
    customer_name: cleanStr(b.customer_name, 200) ?? "",
    customer_email: cleanStr(b.customer_email, 200),
    customer_vat: cleanStr(b.customer_vat, 40),
    customer_address: cleanStr(b.customer_address, 300),
    document_number: cleanStr(b.document_number, 60),
    document_date: rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null,
    currency: (cleanStr(b.currency, 8) ?? "EUR").toUpperCase(),
    line_items,
    subtotal,
    tax,
    total,
    notes: cleanStr(b.notes, 1000),
  };
}

/** Lista documenti generati, con i dati estratti già parsati. */
documentsRouter.get("/", (req, res) => {
  const docs = listDocuments(req.userId!).map((d) => ({
    id: d.id,
    type: d.type,
    createdAt: d.created_at,
    sourceMessageId: d.source_message_id,
    sentStatus: d.sent_status,
    draftId: d.draft_id,
    data: JSON.parse(d.extracted_json),
  }));
  res.json(docs);
});

/** Log delle mail processate (per la dashboard: stato done/error). */
documentsRouter.get("/processed", (req, res) => {
  res.json(listProcessed(req.userId!));
});

/**
 * Anteprima live per l'editor: rende il documento passato nel body con il
 * template/impostazioni correnti dell'utente. Solo string templating, MAI Puppeteer.
 * (Definita prima delle route /:id per chiarezza; il metodo POST evita conflitti.)
 */
documentsRouter.post("/preview", (req, res) => {
  try {
    const data = (req.body as { data?: unknown }).data ?? req.body;
    const doc = validateDocument(data);
    const settings = getUserSettings(req.userId!);
    res.type("html").send(getTemplate(settings.template_id).render(doc, settings));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Anteprima non disponibile" });
  }
});

/** Documento singolo con i dati estratti, per l'editor. */
documentsRouter.get("/:id", (req, res) => {
  const doc = getDocument(req.userId!, Number(req.params.id));
  if (!doc) {
    res.status(404).json({ error: "Documento non trovato" });
    return;
  }
  res.json({
    id: doc.id,
    type: doc.type,
    createdAt: doc.created_at,
    sentStatus: doc.sent_status,
    draftId: doc.draft_id,
    sourceMessageId: doc.source_message_id,
    data: JSON.parse(doc.extracted_json),
  });
});

/**
 * Crea la bozza di risposta in Gmail: nel thread originale, col PDF allegato
 * e un testo scritto dall'AI + firma. SOLO bozza: l'invio resta all'utente.
 */
documentsRouter.post("/:id/draft", async (req, res) => {
  const doc = getDocument(req.userId!, Number(req.params.id));
  if (!doc) {
    res.status(404).json({ error: "Documento non trovato" });
    return;
  }
  // check deterministico sullo scope salvato prima di chiamare Gmail
  if (!hasScope(req.userId!, DRAFTS_SCOPE)) {
    res.json({ error: "Servono nuovi permessi Google per creare bozze.", needsReauth: true });
    return;
  }

  try {
    const settings = getUserSettings(req.userId!);
    const data = JSON.parse(doc.extracted_json) as ExtractedDocument;

    // il PDF può essere sparito (disco effimero su Render): rigeneralo e persisti
    let pdfPath = doc.pdf_path;
    if (!fs.existsSync(pdfPath)) {
      pdfPath = await generatePdf(data, settings);
      updateDocument(req.userId!, doc.id, doc.extracted_json, pdfPath);
    }

    const client = getAuthedClientForUser(req.userId!);

    let meta;
    let originalBody = "";
    try {
      meta = await fetchReplyMeta(client, doc.source_message_id);
      originalBody = (await hydrateMessage(client, doc.source_message_id)).bodyText;
    } catch {
      res.status(400).json({ error: "Impossibile rispondere: la mail originale non è più presente in Gmail." });
      return;
    }

    let body = await generateReplyBody({
      customerName: data.customer_name,
      docType: doc.type,
      docNumber: data.document_number,
      total: data.total,
      currency: data.currency,
      itemCount: data.line_items.length,
      missingPriceCount: data.line_items.filter((li) => li.unit_price === null).length,
      originalSnippet: originalBody || meta.subject,
    });
    // firma appesa in codice: il modello non può storpiarla
    const signature = settings.email_signature ?? settings.company_name;
    if (signature) body += `\n\n${signature}`;

    const draftId = await createReplyDraft(client, {
      meta,
      bodyText: body,
      pdfPath,
      filename: `${doc.type}-${doc.id}.pdf`,
    });
    updateDocumentStatus(req.userId!, doc.id, "bozza", draftId);
    res.json({ sentStatus: "bozza", draftId });
  } catch (err) {
    if (err instanceof NeedsReauthError) {
      res.json({ error: err.message, needsReauth: true });
      return;
    }
    const message = err instanceof Error ? err.message : "Errore nella creazione della bozza";
    console.error(`[documents] draft ${req.params.id} fallito:`, message);
    res.status(400).json({ error: message });
  }
});

/** Mail originale del documento: storage inbound (inoltro) o Gmail on-demand. */
documentsRouter.get("/:id/source", async (req, res) => {
  const doc = getDocument(req.userId!, Number(req.params.id));
  if (!doc) {
    res.status(404).json({ error: "Documento non trovato" });
    return;
  }
  try {
    const { mail } = await getMailForUser(req.userId!, doc.source_message_id);
    res.json({ subject: mail.subject, from: mail.from, date: mail.date, bodyText: mail.bodyText });
  } catch {
    res.status(404).json({ error: "Mail originale non più disponibile." });
  }
});

/**
 * Testo di risposta per la modalità inoltro (niente bozze Gmail):
 * l'AI scrive la risposta, l'utente la copia o apre il suo client via mailto.
 */
documentsRouter.post("/:id/reply-text", async (req, res) => {
  const doc = getDocument(req.userId!, Number(req.params.id));
  if (!doc) {
    res.status(404).json({ error: "Documento non trovato" });
    return;
  }
  try {
    const data = JSON.parse(doc.extracted_json) as ExtractedDocument;
    let originalSnippet = "";
    let sender = data.customer_email ?? "";
    let subject = "";
    try {
      const { mail } = await getMailForUser(req.userId!, doc.source_message_id);
      originalSnippet = mail.bodyText;
      subject = mail.subject;
      // estrai l'indirizzo puro da "Nome <mail>"
      sender = mail.from.match(/<([^>]+)>/)?.[1] ?? mail.from ?? sender;
    } catch {
      /* mail sparita: si risponde comunque coi soli dati del documento */
    }

    const settings = getUserSettings(req.userId!);
    let body = await generateReplyBody({
      customerName: data.customer_name,
      docType: doc.type,
      docNumber: data.document_number,
      total: data.total,
      currency: data.currency,
      itemCount: data.line_items.length,
      missingPriceCount: data.line_items.filter((li) => li.unit_price === null).length,
      originalSnippet: originalSnippet || subject,
    });
    const signature = settings.email_signature ?? settings.company_name;
    if (signature) body += `\n\n${signature}`;

    res.json({
      to: sender,
      subject: `Re: ${subject.replace(/^\s*(re|r)\s*:\s*/i, "") || data.customer_name}`,
      body,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Errore nella generazione della risposta";
    res.status(400).json({ error: message });
  }
});

/** Aggiorna lo stato di invio (es. "Segna come inviato"). */
documentsRouter.patch("/:id/status", (req, res) => {
  const doc = getDocument(req.userId!, Number(req.params.id));
  if (!doc) {
    res.status(404).json({ error: "Documento non trovato" });
    return;
  }
  const { sentStatus } = req.body as { sentStatus?: string };
  if (!SENT_STATUSES.includes(sentStatus as SentStatus)) {
    res.status(400).json({ error: "Stato non valido." });
    return;
  }
  updateDocumentStatus(req.userId!, doc.id, sentStatus as SentStatus);
  res.json({ ok: true, sentStatus });
});

/** Salva un documento modificato: valida, rigenera il PDF, sostituisce il vecchio. */
documentsRouter.put("/:id", async (req, res) => {
  const stored = getDocument(req.userId!, Number(req.params.id));
  if (!stored) {
    res.status(404).json({ error: "Documento non trovato" });
    return;
  }
  try {
    const data = (req.body as { data?: unknown }).data ?? req.body;
    const doc = validateDocument(data);
    // il tipo non si cambia dall'editor: vince sempre quello registrato
    doc.doc_type = stored.type;

    const settings = getUserSettings(req.userId!);
    const newPdfPath = await generatePdf(doc, settings);

    // il vecchio PDF può non esistere (disco effimero su Render free): ignora ENOENT
    fs.unlink(stored.pdf_path, () => {});

    updateDocument(req.userId!, stored.id, JSON.stringify(doc), newPdfPath);
    res.json({ id: stored.id, type: stored.type, createdAt: stored.created_at, data: doc });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Errore nel salvataggio";
    console.error(`[documents] PUT ${req.params.id} fallito:`, message);
    res.status(400).json({ error: message });
  }
});

/** Anteprima/download del PDF. ?download=1 forza il download. */
documentsRouter.get("/:id/pdf", (req, res) => {
  const doc = getDocument(req.userId!, Number(req.params.id));
  if (!doc || !fs.existsSync(doc.pdf_path)) {
    res.status(404).json({ error: "PDF non trovato" });
    return;
  }
  const disposition = req.query.download ? "attachment" : "inline";
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${disposition}; filename="${doc.type}-${doc.id}.pdf"`);
  fs.createReadStream(doc.pdf_path).pipe(res);
});
