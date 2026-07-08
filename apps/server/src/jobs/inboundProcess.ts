import { classifyEmail, CONFIDENCE_THRESHOLD } from "../ai/classify.js";
import type { CandidateMail } from "../gmail/scan.js";
import {
  getPriceList,
  getUserByAlias,
  getUserSettings,
  insertInboundMail,
  isProcessed,
  listActiveKeywords,
  recordProcessed,
  setPendingConfirmation,
} from "../repo.js";
import { processSingleMail } from "./dailyScan.js";

/** Elemento del payload webhook inbound di Brevo (campi che usiamo). */
export interface BrevoInboundItem {
  Uuid?: string[];
  MessageId?: string;
  From?: { Address?: string; Name?: string };
  To?: { Address?: string }[];
  Cc?: { Address?: string }[];
  Recipients?: { Address?: string }[];
  Subject?: string;
  RawTextBody?: string;
  RawHtmlBody?: string;
  ExtractedMarkdownMessage?: string;
  SentAtDate?: string;
  SpamScore?: number;
}

const SPAM_CUTOFF = 5;
const DAILY_CLASSIFY_BUDGET = 50;

// budget classificazioni per utente/giorno (in-memory: ok su singola istanza)
const budgets = new Map<number, { day: string; count: number }>();

function consumeBudget(userId: number): boolean {
  const day = new Date().toISOString().slice(0, 10);
  const b = budgets.get(userId);
  if (!b || b.day !== day) {
    budgets.set(userId, { day, count: 1 });
    return true;
  }
  if (b.count >= DAILY_CLASSIFY_BUDGET) return false;
  b.count++;
  return true;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Estrae l'alias (local-part) dal destinatario dell'inoltro. */
function findAlias(item: BrevoInboundItem, inboundDomain: string): string | null {
  const candidates = [
    ...(item.Recipients ?? []), // envelope RCPT TO: il più affidabile con gli inoltri
    ...(item.To ?? []),
    ...(item.Cc ?? []),
  ];
  for (const c of candidates) {
    const addr = (c.Address ?? "").toLowerCase();
    if (addr.endsWith(`@${inboundDomain.toLowerCase()}`)) {
      return addr.split("@")[0] ?? null;
    }
  }
  return null;
}

function bodyOf(item: BrevoInboundItem): string {
  return (
    item.ExtractedMarkdownMessage?.trim() ||
    item.RawTextBody?.trim() ||
    (item.RawHtmlBody ? stripHtml(item.RawHtmlBody) : "")
  );
}

/**
 * Rileva la mail di conferma inoltro di Gmail e ne estrae codice/link,
 * così la dashboard può mostrarli all'utente. Non è una mail business.
 */
function detectGmailConfirmation(item: BrevoInboundItem): string | null {
  const from = (item.From?.Address ?? "").toLowerCase();
  if (!from.includes("forwarding-noreply@google.com")) return null;
  const text = `${item.Subject ?? ""}\n${bodyOf(item)}`;
  const code = text.match(/\b(\d{9})\b/)?.[1];
  const link = text.match(/https:\/\/mail-settings\.google\.com\/mail\/[^\s")]+/)?.[0];
  return code ?? link ?? "ricevuta (controlla la mail di Gmail)";
}

/**
 * Elabora gli item del webhook Brevo. Chiamata ASINCRONA rispetto alla risposta
 * HTTP (il webhook risponde 200 subito; l'idempotenza rende i retry innocui).
 */
export async function processInboundItems(items: BrevoInboundItem[], inboundDomain: string): Promise<void> {
  for (const item of items) {
    try {
      await processOne(item, inboundDomain);
    } catch (err) {
      console.error("[inbound] errore elaborazione item:", err);
    }
  }
}

async function processOne(item: BrevoInboundItem, inboundDomain: string): Promise<void> {
  const alias = findAlias(item, inboundDomain);
  if (!alias) return; // non per noi: silenzio (nessun segnale ai prober)
  const userId = getUserByAlias(alias);
  if (!userId) return;

  // conferma inoltro Gmail → salva per la UI, non processare oltre
  const confirmation = detectGmailConfirmation(item);
  if (confirmation) {
    setPendingConfirmation(userId, confirmation);
    console.log(`[inbound] codice conferma inoltro ricevuto per user ${userId}`);
    return;
  }

  const mailId = item.MessageId?.trim() || item.Uuid?.[0] || "";
  if (!mailId) return;
  const subject = item.Subject ?? "";
  const bodyText = bodyOf(item);
  const sender = item.From?.Name
    ? `${item.From.Name} <${item.From.Address ?? ""}>`
    : (item.From?.Address ?? "");

  // salva SEMPRE il contenuto (non ri-scaricabile a differenza di Gmail)
  insertInboundMail({ userId, mailId, subject, sender, date: item.SentAtDate ?? null, bodyText });

  if (isProcessed(userId, mailId)) return; // retry Brevo o duplicato: già gestita

  const mail: CandidateMail = { id: mailId, subject, from: sender, date: item.SentAtDate ?? "", bodyText };
  const settings = getUserSettings(userId);
  const listino = getPriceList(userId);

  // spam: registra e ferma
  if ((item.SpamScore ?? 0) > SPAM_CUTOFF) {
    recordProcessed({
      userId, gmailMessageId: mailId, subject, matchedKeyword: "inoltro",
      status: "skipped", documentId: null, error: null,
      category: "spam_marketing", detail: `Punteggio spam alto (${item.SpamScore}).`,
    });
    return;
  }

  // 1) keyword locale sull'oggetto (filtri espliciti dell'utente)
  const kw = listActiveKeywords(userId).find((k) =>
    subject.toLowerCase().includes(k.term.toLowerCase()),
  );
  if (kw) {
    await processSingleMail({
      userId, client: null, mail, docType: kw.doc_type, matchedKeyword: kw.term,
      settings, listino: listino?.items,
    });
    return;
  }

  // 2) classificazione AI (budget giornaliero per utente)
  if (!consumeBudget(userId)) {
    recordProcessed({
      userId, gmailMessageId: mailId, subject, matchedKeyword: "inoltro",
      status: "skipped", documentId: null, error: null,
      category: "altro", detail: "Budget giornaliero di analisi raggiunto — usa Riprova domani o configura una parola chiave.",
    });
    return;
  }

  const cls = await classifyEmail(mail);
  if (cls.relevant && cls.doc_type && cls.confidence >= CONFIDENCE_THRESHOLD) {
    await processSingleMail({
      userId, client: null, mail, docType: cls.doc_type, matchedKeyword: "auto",
      settings, listino: listino?.items, category: cls.category, detail: cls.reason,
    });
  } else {
    recordProcessed({
      userId, gmailMessageId: mailId, subject, matchedKeyword: "auto",
      status: "skipped", documentId: null, error: null,
      category: cls.category, detail: cls.reason,
    });
  }
}
