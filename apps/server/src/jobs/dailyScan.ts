import { getAuthedClientForUser } from "../auth/google.js";
import { extractDocument } from "../ai/extract.js";
import { classifyEmail, CONFIDENCE_THRESHOLD } from "../ai/classify.js";
import { generatePdf } from "../pdf/generate.js";
import {
  hydrateMessage,
  listMessageIds,
  searchMessages,
  smartScanQuery,
  type CandidateMail,
} from "../gmail/scan.js";
import {
  getUserSettings,
  insertDocument,
  isProcessed,
  listActiveKeywords,
  listActiveUserIds,
  recordProcessed,
  touchSync,
} from "../repo.js";
import type { DocType } from "../types.js";

export interface ScanResult {
  scanned: number; // mail elaborate (estrazione tentata) in questo run
  created: number; // documenti/PDF generati
  errors: number;
  skipped: number; // già processate in precedenza (nessun costo)
  classified: number; // mail passate dal classificatore AI in questo run
  skippedIrrelevant: number; // classificate come non pertinenti (registrate, mai più riviste)
}

/**
 * Finestre e budget differenziati (controllo costi, richiesta esplicita):
 * - scan MANUALE: guarda indietro 15 giorni, max 50 classificazioni per click.
 *   Un secondo click continua da dove il primo si è fermato (le già viste costano zero).
 * - scan GIORNALIERO: target "il giorno prima"; finestra 2gg come margine
 *   anti-outage (Render free può dormire) — gratis grazie al dedup.
 *
 * Garanzia di costo: ogni mail è classificata AL MASSIMO UNA VOLTA nella vita.
 * Ogni esito (done/skipped/error-estrazione) finisce in `processed`; ai run
 * successivi il filtro sugli ID la scarta prima di scaricare o classificare.
 */
export interface ScanOptions {
  windowDays: number;
  classifyBudget: number;
}
export const MANUAL_SCAN_OPTS: ScanOptions = { windowDays: 15, classifyBudget: 50 };
export const DAILY_SCAN_OPTS: ScanOptions = { windowDays: 2, classifyBudget: 40 };

/** Quante mail al massimo listare da Gmail per lo smart scan (solo ID, economico). */
const SMART_LIST_MAX = 100;

/**
 * Scan completo per un utente, in due fasi:
 *  1. keyword attive (comportamento storico)
 *  2. smart scan AI, se abilitato nelle impostazioni
 * Ogni messaggio è gestito in isolamento: un errore non blocca gli altri.
 */
export async function scanUser(userId: number, opts: ScanOptions = DAILY_SCAN_OPTS): Promise<ScanResult> {
  const result: ScanResult = {
    scanned: 0,
    created: 0,
    errors: 0,
    skipped: 0,
    classified: 0,
    skippedIrrelevant: 0,
  };
  const settings = getUserSettings(userId);
  const keywords = listActiveKeywords(userId);

  if (keywords.length === 0 && !settings.smart_scan) {
    touchSync(userId);
    return result;
  }

  const client = getAuthedClientForUser(userId);

  /** Estrae, genera il PDF e persiste una mail. matchedKeyword='auto' = rilevata dall'AI. */
  const processMail = async (mail: CandidateMail, docType: DocType, matchedKeyword: string) => {
    try {
      const extracted = await extractDocument(mail.bodyText || mail.subject, docType);
      const pdfPath = await generatePdf(extracted, settings);
      const docRecord = insertDocument({
        userId,
        type: docType,
        extractedJson: JSON.stringify(extracted),
        pdfPath,
        sourceMessageId: mail.id,
      });
      recordProcessed({
        userId,
        gmailMessageId: mail.id,
        subject: mail.subject,
        matchedKeyword,
        status: "done",
        documentId: docRecord.id,
        error: null,
      });
      result.scanned++;
      result.created++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[scan] errore elaborazione mail ${mail.id} (user ${userId}):`, message);
      recordProcessed({
        userId,
        gmailMessageId: mail.id,
        subject: mail.subject,
        matchedKeyword,
        status: "error",
        documentId: null,
        error: message,
      });
      result.scanned++;
      result.errors++;
    }
  };

  // ── Fase 1: keyword attive ──
  for (const kw of keywords) {
    let candidates: CandidateMail[];
    try {
      candidates = await searchMessages(client, kw.term, opts.windowDays);
    } catch (err) {
      console.error(`[scan] errore ricerca per keyword "${kw.term}" (user ${userId}):`, err);
      result.errors++;
      continue;
    }
    for (const mail of candidates) {
      if (isProcessed(userId, mail.id)) {
        result.skipped++;
        continue;
      }
      await processMail(mail, kw.doc_type, kw.term);
    }
  }

  // ── Fase 2: smart scan AI ──
  if (settings.smart_scan) {
    let ids: string[] = [];
    try {
      ids = await listMessageIds(client, smartScanQuery(opts.windowDays), SMART_LIST_MAX);
    } catch (err) {
      console.error(`[scan] errore lista inbox smart scan (user ${userId}):`, err);
      result.errors++;
    }

    // dedup PRIMA di scaricare il contenuto: le già viste non costano nulla
    const newIds = ids.filter((id) => {
      const seen = isProcessed(userId, id);
      if (seen) result.skipped++;
      return !seen;
    });

    let budget = opts.classifyBudget;
    for (const id of newIds) {
      if (budget-- <= 0) break;

      let mail: CandidateMail;
      try {
        mail = await hydrateMessage(client, id);
      } catch (err) {
        console.error(`[scan] errore lettura mail ${id} (user ${userId}):`, err);
        result.errors++;
        continue; // non registrata: ritenta al prossimo run
      }

      let cls;
      try {
        cls = await classifyEmail(mail);
        result.classified++;
      } catch (err) {
        // errore API (rate limit, timeout…): NON registrare, così la mail
        // viene ritentata al prossimo run invece di perdersi per sempre
        console.error(`[scan] errore classificazione mail ${id} (user ${userId}):`, err);
        result.errors++;
        continue;
      }

      if (cls.relevant && cls.doc_type && cls.confidence >= CONFIDENCE_THRESHOLD) {
        await processMail(mail, cls.doc_type, "auto");
      } else {
        // registrata come non pertinente: mai più riclassificata (controllo costi)
        recordProcessed({
          userId,
          gmailMessageId: mail.id,
          subject: mail.subject,
          matchedKeyword: "auto",
          status: "skipped",
          documentId: null,
          error: null,
        });
        result.skippedIrrelevant++;
      }
    }
  }

  touchSync(userId);
  return result;
}

/** Scan di tutti gli utenti (usato dal cron giornaliero). */
export async function scanAllUsers(): Promise<void> {
  const ids = listActiveUserIds();
  console.log(`[scan] avvio scan giornaliero per ${ids.length} utenti`);
  for (const id of ids) {
    try {
      const r = await scanUser(id, DAILY_SCAN_OPTS);
      console.log(`[scan] user ${id}:`, r);
    } catch (err) {
      console.error(`[scan] scan fallito per user ${id}:`, err);
    }
  }
}
