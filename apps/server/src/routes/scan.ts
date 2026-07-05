import { Router } from "express";

import { requireAuth } from "../auth/session.js";
import {
  countUnprocessed,
  MANUAL_SCAN_OPTS,
  processSingleMail,
  RANGE_BATCH_BUDGET,
  scanUser,
} from "../jobs/dailyScan.js";
import { classifyEmail, CONFIDENCE_THRESHOLD } from "../ai/classify.js";
import { getAuthedClientForUser } from "../auth/google.js";
import { hydrateMessage } from "../gmail/scan.js";
import {
  accumulateRangeRun,
  getPriceList,
  getProcessed,
  getUserSettings,
  insertScanRun,
  listKeywords,
  listScanRuns,
  recordProcessed,
} from "../repo.js";

export const scanRouter = Router();

scanRouter.use(requireAuth);

/** Storico delle scansioni (manuali, giornaliere, per periodo). */
scanRouter.get("/history", (req, res) => {
  res.json(listScanRuns(req.userId!));
});

/** Trigger manuale ("Scansiona ora"): ultimi 15 giorni, budget 50 classificazioni. */
scanRouter.post("/", async (req, res) => {
  try {
    const result = await scanUser(req.userId!, MANUAL_SCAN_OPTS);
    insertScanRun(req.userId!, "manuale", null, result);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[scan] trigger manuale fallito:", message);
    res.status(500).json({ error: message });
  }
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Scan per periodo scelto dall'utente. `dryRun:true` → solo conteggio delle mail
 * nuove (zero AI, zero costo). Altrimenti esegue UN lotto (max 50 classificazioni)
 * e ritorna anche `remaining`: il frontend concatena i lotti finché > 0.
 */
scanRouter.post("/range", async (req, res) => {
  const { from, to, dryRun } = req.body as { from?: string; to?: string; dryRun?: boolean };
  if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
    res.status(400).json({ error: "Date non valide: usa il formato YYYY-MM-DD." });
    return;
  }
  const dFrom = new Date(`${from}T00:00:00Z`);
  const dTo = new Date(`${to}T00:00:00Z`);
  if (dFrom > dTo) {
    res.status(400).json({ error: "La data di inizio è successiva a quella di fine." });
    return;
  }
  if (dTo.getTime() - dFrom.getTime() > 365 * 24 * 3600 * 1000) {
    res.status(400).json({ error: "Periodo troppo ampio: massimo 1 anno." });
    return;
  }

  const window = { after: from, before: to };
  try {
    if (dryRun) {
      res.json({ toAnalyze: await countUnprocessed(req.userId!, window) });
      return;
    }
    const result = await scanUser(req.userId!, { window, classifyBudget: RANGE_BATCH_BUDGET });
    // i lotti dello stesso periodo si accumulano in un'unica riga di storico
    accumulateRangeRun(req.userId!, `${from} → ${to}`, result);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[scan] range fallito:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * "Riprova" su una riga del log (ignorata o in errore): rianalizza QUELLA mail.
 * - riga da keyword (e la keyword esiste ancora) → estrazione diretta col suo tipo
 * - altrimenti → riclassificazione fresca → se rilevante genera il documento,
 *   se no aggiorna la riga con categoria/motivo aggiornati.
 */
scanRouter.post("/processed/:id/retry", async (req, res) => {
  const row = getProcessed(req.userId!, Number(req.params.id));
  if (!row) {
    res.status(404).json({ error: "Riga non trovata" });
    return;
  }

  try {
    const client = getAuthedClientForUser(req.userId!);
    let mail;
    try {
      mail = await hydrateMessage(client, row.gmail_message_id);
    } catch {
      res.status(400).json({ error: "Mail non più presente in Gmail: impossibile rianalizzarla." });
      return;
    }

    const settings = getUserSettings(req.userId!);
    const listino = getPriceList(req.userId!);

    // riga nata da keyword ancora esistente → tipo noto, niente riclassificazione
    const kw =
      row.matched_keyword && row.matched_keyword !== "auto"
        ? listKeywords(req.userId!).find((k) => k.term === row.matched_keyword)
        : undefined;

    if (kw) {
      const outcome = await processSingleMail({
        userId: req.userId!,
        client,
        mail,
        docType: kw.doc_type,
        matchedKeyword: kw.term,
        settings,
        listino: listino?.items,
      });
      res.json(outcome.ok ? { outcome: "done", documentId: outcome.documentId } : { outcome: "error", error: outcome.error });
      return;
    }

    const cls = await classifyEmail(mail);
    if (cls.relevant && cls.doc_type && cls.confidence >= CONFIDENCE_THRESHOLD) {
      const outcome = await processSingleMail({
        userId: req.userId!,
        client,
        mail,
        docType: cls.doc_type,
        matchedKeyword: "auto",
        settings,
        listino: listino?.items,
        category: cls.category,
        detail: cls.reason,
      });
      res.json(outcome.ok ? { outcome: "done", documentId: outcome.documentId } : { outcome: "error", error: outcome.error });
    } else {
      recordProcessed({
        userId: req.userId!,
        gmailMessageId: mail.id,
        subject: mail.subject,
        matchedKeyword: "auto",
        status: "skipped",
        documentId: null,
        error: null,
        category: cls.category,
        detail: cls.reason,
      });
      res.json({ outcome: "skipped", category: cls.category, reason: cls.reason });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[scan] retry ${req.params.id} fallito:`, message);
    res.status(500).json({ error: message });
  }
});
