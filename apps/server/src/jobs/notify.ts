import { env } from "../env.js";
import { button, esc, layout, sendEmail } from "../mail/send.js";
import { getDocument, getUserById, getUserSettings, listProcessedByRun } from "../repo.js";
import type { DocType, ExtractedDocument, ScanRun } from "../types.js";
import type { ScanResult, SingleMailOutcome } from "./dailyScan.js";

/**
 * Notifiche email all'utente. Regole:
 * - modalità inoltro: una mail per ogni documento creato / errore (l'utente non è davanti all'app);
 * - scan giornaliero (cron): un riepilogo per run, solo se è successo qualcosa;
 * - scan manuale, per periodo e "Riprova": niente, l'utente sta guardando la dashboard.
 * Tutto best-effort: un errore di invio finisce nei log e non tocca l'elaborazione.
 */

const DOC_LABEL: Record<DocType, string> = { fattura: "Fattura", preventivo: "Preventivo", ordine: "Ordine" };

function fmtMoney(n: number | null, currency: string): string {
  if (n === null) return "—";
  try {
    return new Intl.NumberFormat("it-IT", { style: "currency", currency: currency || "EUR" }).format(n);
  } catch {
    return `${n} ${currency}`;
  }
}

/** Destinatario delle notifiche, o null se disattivate / utente inesistente. */
function recipient(userId: number, kind: "document" | "error"): string | null {
  const s = getUserSettings(userId);
  if (!s.notify_enabled) return null;
  if (kind === "error" && !s.notify_errors) return null;
  const user = getUserById(userId);
  return s.notify_email || user?.email || null;
}

function safeSend(userId: number, p: Parameters<typeof sendEmail>[0]): void {
  sendEmail(p).catch((err) => {
    console.error(`[notify] invio a user ${userId} fallito:`, err instanceof Error ? err.message : err);
  });
}

/** Esito di UNA mail inoltrata: documento pronto oppure errore. */
export function notifyInboundOutcome(args: {
  userId: number;
  outcome: SingleMailOutcome;
  subject: string;
  from: string;
  docType: DocType;
}): void {
  const { userId, outcome, subject, from, docType } = args;
  try {
    if (outcome.ok) {
      const to = recipient(userId, "document");
      if (!to) return;
      const doc = getDocument(userId, outcome.documentId);
      if (!doc) return;
      const data = JSON.parse(doc.extracted_json) as ExtractedDocument;
      const missing = data.line_items.filter((li) => li.unit_price === null).length;
      const label = DOC_LABEL[docType] ?? docType;
      const who = data.customer_name || "cliente non rilevato";

      safeSend(userId, {
        to,
        subject: `${label} pronto · ${who}`,
        html: layout(
          `${label} generato da una mail`,
          `<p style="color:#6b6357;line-height:1.6">Da <strong>${esc(from)}</strong><br/>Oggetto: “${esc(subject)}”</p>
           <table style="border-collapse:collapse;margin:16px 0;font-size:14px">
             <tr><td style="padding:4px 16px 4px 0;color:#6b6357">Cliente</td><td><strong>${esc(who)}</strong></td></tr>
             <tr><td style="padding:4px 16px 4px 0;color:#6b6357">Righe</td><td>${data.line_items.length}</td></tr>
             <tr><td style="padding:4px 16px 4px 0;color:#6b6357">Totale</td><td>${esc(fmtMoney(data.total, data.currency))}</td></tr>
           </table>
           ${
             missing > 0
               ? `<p style="background:#fde8ee;border-radius:12px;padding:12px 16px;font-size:14px;line-height:1.5"><strong>${missing === 1 ? "1 riga è senza prezzo" : `${missing} righe sono senza prezzo`}</strong>: articoli non trovati nel listino, da completare prima di inviare.</p>`
               : ""
           }
           ${button(`${env.webOrigin}/documents/${doc.id}/edit`, "Controlla e modifica")}
           <p style="color:#6b6357;font-size:13px;line-height:1.6">Dalla dashboard puoi anche generare la risposta al cliente e scaricare il PDF.</p>`,
        ),
      });
    } else {
      const to = recipient(userId, "error");
      if (!to) return;
      safeSend(userId, {
        to,
        subject: `Mail non elaborata · ${subject || "(senza oggetto)"}`,
        html: layout(
          "Una mail non è stata elaborata",
          `<p style="color:#6b6357;line-height:1.6">Da <strong>${esc(from)}</strong><br/>Oggetto: “${esc(subject)}”</p>
           <p style="background:#fde8ee;border-radius:12px;padding:12px 16px;font-size:14px;line-height:1.5">${esc(outcome.error)}</p>
           ${button(`${env.webOrigin}/dashboard`, "Apri la dashboard")}
           <p style="color:#6b6357;font-size:13px;line-height:1.6">Nel log “Mail processate” trovi la riga con il bottone <strong>Riprova</strong>. Se il problema persiste, il documento si può creare a mano dai dati della mail.</p>`,
        ),
      });
    }
  } catch (err) {
    console.error(`[notify] errore preparazione notifica (user ${userId}):`, err);
  }
}

/** Riepilogo dello scan giornaliero: inviato solo se ci sono documenti nuovi o errori. */
export function notifyDailyDigest(userId: number, run: Pick<ScanRun, "id">, result: ScanResult): void {
  try {
    const hasDocs = result.created > 0;
    const hasErrors = result.errors > 0;
    if (!hasDocs && !hasErrors) return;

    // gli errori da soli passano solo se l'utente li vuole
    const to = hasDocs ? recipient(userId, "document") : recipient(userId, "error");
    if (!to) return;
    const showErrors = hasErrors && Boolean(getUserSettings(userId).notify_errors);

    const rows = listProcessedByRun(userId, run.id);
    const done = rows.filter((r) => r.status === "done" && r.document_id !== null);
    const failed = rows.filter((r) => r.status === "error");

    const docLines = done
      .map((r) => {
        const doc = getDocument(userId, r.document_id!);
        if (!doc) return "";
        const data = JSON.parse(doc.extracted_json) as ExtractedDocument;
        const label = DOC_LABEL[doc.type] ?? doc.type;
        return `<li style="margin:6px 0"><a href="${esc(`${env.webOrigin}/documents/${doc.id}/edit`)}" style="color:#1a1613"><strong>${esc(label)}</strong> · ${esc(data.customer_name || "cliente non rilevato")}</a> — ${esc(fmtMoney(data.total, data.currency))}</li>`;
      })
      .filter(Boolean)
      .join("");

    const errLines = showErrors
      ? failed
          .map((r) => `<li style="margin:6px 0">“${esc(r.subject ?? "(senza oggetto)")}” — <span style="color:#6b6357">${esc(r.error ?? "errore")}</span></li>`)
          .join("")
      : "";
    // errori di ricerca Gmail (non legati a una mail) non compaiono nel log: solo il conteggio
    const otherErrors = showErrors ? result.errors - failed.length : 0;

    const parts: string[] = [];
    if (hasDocs) parts.push(`${result.created} ${result.created === 1 ? "documento nuovo" : "documenti nuovi"}`);
    if (showErrors) parts.push(`${result.errors} ${result.errors === 1 ? "errore" : "errori"}`);
    if (!parts.length) return;

    safeSend(userId, {
      to,
      subject: `Scansione di oggi: ${parts.join(", ")}`,
      html: layout(
        "Riepilogo della scansione automatica",
        `<p style="color:#6b6357;line-height:1.6">Stanotte ho controllato la tua casella: ${esc(parts.join(" e "))}.</p>
         ${hasDocs ? `<h3 style="font-size:14px;margin:20px 0 6px">Documenti generati</h3><ul style="padding-left:18px;margin:0;font-size:14px">${docLines}</ul>` : ""}
         ${showErrors && (errLines || otherErrors > 0) ? `<h3 style="font-size:14px;margin:20px 0 6px">Da controllare</h3><ul style="padding-left:18px;margin:0;font-size:14px">${errLines}${otherErrors > 0 ? `<li style="margin:6px 0;color:#6b6357">${otherErrors} ${otherErrors === 1 ? "errore" : "errori"} di lettura della casella (ritento alla prossima scansione)</li>` : ""}</ul>` : ""}
         ${result.draftsCreated > 0 ? `<p style="color:#6b6357;font-size:14px;line-height:1.6">${result.draftsCreated} ${result.draftsCreated === 1 ? "bozza di risposta è già pronta" : "bozze di risposta sono già pronte"} in Gmail.</p>` : ""}
         ${button(`${env.webOrigin}/dashboard`, "Apri la dashboard")}`,
      ),
    });
  } catch (err) {
    console.error(`[notify] errore riepilogo giornaliero (user ${userId}):`, err);
  }
}
