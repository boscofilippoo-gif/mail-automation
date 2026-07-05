import { getAuthedClientForUser } from "../auth/google.js";
import { extractDocument } from "../ai/extract.js";
import { classifyEmail, CONFIDENCE_THRESHOLD } from "../ai/classify.js";
import { generateReplyBody } from "../ai/reply.js";
import { createReplyDraft, fetchReplyMeta } from "../gmail/draft.js";
import { generatePdf } from "../pdf/generate.js";
import { DRAFTS_SCOPE } from "../env.js";
import {
  hydrateMessage,
  listMessageIds,
  searchMessages,
  smartScanQuery,
  type CandidateMail,
  type ScanWindow,
} from "../gmail/scan.js";
import {
  getPriceList,
  getUserSettings,
  hasScope,
  insertDocument,
  insertScanRun,
  isProcessed,
  listActiveKeywords,
  listActiveUserIds,
  recordProcessed,
  touchSync,
  updateDocumentStatus,
} from "../repo.js";
import type { DocType, PriceListItem, UserSettings } from "../types.js";

export interface ScanResult {
  scanned: number; // mail elaborate (estrazione tentata) in questo run
  created: number; // documenti/PDF generati
  errors: number;
  skipped: number; // già processate in precedenza (nessun costo)
  classified: number; // mail passate dal classificatore AI in questo run
  skippedIrrelevant: number; // classificate come non pertinenti (registrate, mai più riviste)
  draftsCreated: number; // bozze di risposta create automaticamente (se auto_draft attivo)
  remaining: number; // mail nuove ancora da analizzare nella finestra dopo questo lotto
}

/**
 * Finestre e budget differenziati (controllo costi):
 * - scan MANUALE: ultimi 15 giorni, max 50 classificazioni per click.
 * - scan GIORNALIERO: "il giorno prima" + margine anti-outage (2gg, gratis col dedup).
 * - scan PER PERIODO: intervallo scelto dall'utente, a lotti da 50 per richiesta
 *   (il frontend concatena i lotti finché remaining > 0).
 * Garanzia: ogni mail è classificata AL MASSIMO UNA VOLTA nella vita.
 */
export interface ScanOptions {
  window: ScanWindow;
  classifyBudget: number;
}
export const MANUAL_SCAN_OPTS: ScanOptions = { window: { days: 15 }, classifyBudget: 50 };
export const DAILY_SCAN_OPTS: ScanOptions = { window: { days: 2 }, classifyBudget: 40 };
export const RANGE_BATCH_BUDGET = 50;

/** Quanti ID al massimo listare da Gmail per lo smart scan (solo ID, economico). */
const SMART_LIST_MAX = 2000;

export type SingleMailOutcome =
  | { ok: true; documentId: number; draftCreated: boolean }
  | { ok: false; error: string };

/**
 * Elabora UNA mail rilevante: estrazione → PDF → persistenza (+ bozza automatica
 * se attiva). Registra da sola l'esito in `processed`, con errori di FASE espliciti.
 * Riusata dallo scan e dal "Riprova".
 */
export async function processSingleMail(args: {
  userId: number;
  client: ReturnType<typeof getAuthedClientForUser>;
  mail: CandidateMail;
  docType: DocType;
  matchedKeyword: string;
  settings: UserSettings;
  listino: PriceListItem[] | undefined;
  category?: string | null;
  detail?: string | null;
}): Promise<SingleMailOutcome> {
  const { userId, client, mail, docType, matchedKeyword, settings, listino } = args;
  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

  try {
    let extracted;
    try {
      extracted = await extractDocument(mail.bodyText || mail.subject, docType, listino);
    } catch (e) {
      throw new Error(`Estrazione dati fallita: ${msg(e)}`);
    }

    let pdfPath: string;
    try {
      pdfPath = await generatePdf(extracted, settings);
    } catch (e) {
      throw new Error(`Generazione PDF fallita: ${msg(e)}`);
    }

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
      category: args.category ?? null,
      detail: args.detail ?? null,
    });

    // ── bozza automatica (opzionale): fallimento tollerato, il documento esiste ──
    let draftCreated = false;
    if (settings.auto_draft && hasScope(userId, DRAFTS_SCOPE)) {
      try {
        const meta = await fetchReplyMeta(client, mail.id);
        let body = await generateReplyBody({
          customerName: extracted.customer_name,
          docType,
          docNumber: extracted.document_number,
          total: extracted.total,
          currency: extracted.currency,
          itemCount: extracted.line_items.length,
          missingPriceCount: extracted.line_items.filter((li) => li.unit_price === null).length,
          originalSnippet: mail.bodyText || mail.subject,
        });
        const signature = settings.email_signature ?? settings.company_name;
        if (signature) body += `\n\n${signature}`;
        const draftId = await createReplyDraft(client, {
          meta,
          bodyText: body,
          pdfPath,
          filename: `${docType}-${docRecord.id}.pdf`,
        });
        updateDocumentStatus(userId, docRecord.id, "bozza", draftId);
        draftCreated = true;
      } catch (err) {
        console.error(`[scan] bozza automatica fallita per doc ${docRecord.id}:`, err);
      }
    }

    return { ok: true, documentId: docRecord.id, draftCreated };
  } catch (err) {
    const message = msg(err);
    console.error(`[scan] errore elaborazione mail ${mail.id} (user ${userId}):`, message);
    recordProcessed({
      userId,
      gmailMessageId: mail.id,
      subject: mail.subject,
      matchedKeyword,
      status: "error",
      documentId: null,
      error: message,
      category: args.category ?? null,
      detail: args.detail ?? null,
    });
    return { ok: false, error: message };
  }
}

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
    draftsCreated: 0,
    remaining: 0,
  };
  const settings = getUserSettings(userId);
  const keywords = listActiveKeywords(userId);
  // listino caricato una volta per run: guida i prezzi in estrazione
  const listino = getPriceList(userId);

  if (keywords.length === 0 && !settings.smart_scan) {
    touchSync(userId);
    return result;
  }

  const client = getAuthedClientForUser(userId);

  const applyOutcome = (o: SingleMailOutcome) => {
    result.scanned++;
    if (o.ok) {
      result.created++;
      if (o.draftCreated) result.draftsCreated++;
    } else {
      result.errors++;
    }
  };

  // ── Fase 1: keyword attive ──
  for (const kw of keywords) {
    let candidates: CandidateMail[];
    try {
      candidates = await searchMessages(client, kw.term, opts.window);
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
      applyOutcome(
        await processSingleMail({
          userId,
          client,
          mail,
          docType: kw.doc_type,
          matchedKeyword: kw.term,
          settings,
          listino: listino?.items,
        }),
      );
    }
  }

  // ── Fase 2: smart scan AI ──
  if (settings.smart_scan) {
    let ids: string[] = [];
    try {
      ids = await listMessageIds(client, smartScanQuery(opts.window), SMART_LIST_MAX);
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

    let consumed = 0;
    for (const id of newIds) {
      if (consumed >= opts.classifyBudget) break;
      consumed++;

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
        applyOutcome(
          await processSingleMail({
            userId,
            client,
            mail,
            docType: cls.doc_type,
            matchedKeyword: "auto",
            settings,
            listino: listino?.items,
            category: cls.category,
            detail: cls.reason,
          }),
        );
      } else {
        // registrata come non pertinente CON motivo: mai più riclassificata
        recordProcessed({
          userId,
          gmailMessageId: mail.id,
          subject: mail.subject,
          matchedKeyword: "auto",
          status: "skipped",
          documentId: null,
          error: null,
          category: cls.category,
          detail: cls.reason,
        });
        result.skippedIrrelevant++;
      }
    }
    result.remaining = Math.max(0, newIds.length - consumed);
  }

  touchSync(userId);
  return result;
}

/** Conteggio a secco: quante mail NUOVE ci sono in una finestra (zero AI, zero costo). */
export async function countUnprocessed(userId: number, window: ScanWindow): Promise<number> {
  const client = getAuthedClientForUser(userId);
  const ids = await listMessageIds(client, smartScanQuery(window), SMART_LIST_MAX);
  return ids.filter((id) => !isProcessed(userId, id)).length;
}

/** Scan di tutti gli utenti (usato dal cron giornaliero). */
export async function scanAllUsers(): Promise<void> {
  const ids = listActiveUserIds();
  console.log(`[scan] avvio scan giornaliero per ${ids.length} utenti`);
  for (const id of ids) {
    try {
      const r = await scanUser(id, DAILY_SCAN_OPTS);
      // storico: anche i run "vuoti" mostrano all'utente che il sistema ha girato
      insertScanRun(id, "giornaliero", null, r);
      console.log(`[scan] user ${id}:`, r);
    } catch (err) {
      console.error(`[scan] scan fallito per user ${id}:`, err);
    }
  }
}
