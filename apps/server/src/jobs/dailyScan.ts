import { getAuthedClientForUser } from "../auth/google.js";
import { extractDocument } from "../ai/extract.js";
import { generatePdf } from "../pdf/generate.js";
import { searchMessages } from "../gmail/scan.js";
import {
  insertDocument,
  isProcessed,
  listActiveKeywords,
  listActiveUserIds,
  recordProcessed,
  touchSync,
} from "../repo.js";

export interface ScanResult {
  scanned: number; // mail trovate (nuove) ed elaborate in questo run
  created: number; // documenti/PDF generati
  errors: number;
  skipped: number; // già processate in precedenza
}

/**
 * Esegue lo scan per un singolo utente: per ogni keyword attiva cerca le mail,
 * salta quelle già viste, estrae i dati con Claude, genera il PDF e persiste tutto.
 * Ogni messaggio è gestito in isolamento: un errore su una mail non blocca le altre.
 */
export async function scanUser(userId: number): Promise<ScanResult> {
  const result: ScanResult = { scanned: 0, created: 0, errors: 0, skipped: 0 };
  const keywords = listActiveKeywords(userId);
  if (keywords.length === 0) {
    touchSync(userId);
    return result;
  }

  const client = getAuthedClientForUser(userId);

  for (const kw of keywords) {
    let candidates;
    try {
      candidates = await searchMessages(client, kw.term);
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

      try {
        const extracted = await extractDocument(mail.bodyText || mail.subject, kw.doc_type);
        const pdfPath = await generatePdf(extracted);
        const docRecord = insertDocument({
          userId,
          type: kw.doc_type,
          extractedJson: JSON.stringify(extracted),
          pdfPath,
          sourceMessageId: mail.id,
        });
        recordProcessed({
          userId,
          gmailMessageId: mail.id,
          subject: mail.subject,
          matchedKeyword: kw.term,
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
          matchedKeyword: kw.term,
          status: "error",
          documentId: null,
          error: message,
        });
        result.scanned++;
        result.errors++;
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
      const r = await scanUser(id);
      console.log(`[scan] user ${id}:`, r);
    } catch (err) {
      console.error(`[scan] scan fallito per user ${id}:`, err);
    }
  }
}
