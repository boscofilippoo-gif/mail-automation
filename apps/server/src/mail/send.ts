import { env } from "../env.js";

export interface OutgoingMail {
  to: string;
  subject: string;
  html: string;
}

/**
 * Invio transazionale via Brevo. Senza BREVO_API_KEY (dev locale) stampa in
 * console e basta: nessuna mail parte, nessun errore.
 */
export async function sendEmail(mail: OutgoingMail): Promise<void> {
  if (!env.brevo.apiKey) {
    console.log(`[mail:mock] → ${mail.to} · "${mail.subject}"`);
    return;
  }

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": env.brevo.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender: { email: env.brevo.mailFrom, name: env.brevo.mailFromName },
      to: [{ email: mail.to }],
      subject: mail.subject,
      htmlContent: mail.html,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Invio email fallito (Brevo ${res.status}): ${body.slice(0, 200)}`);
  }
}

/** Escape HTML minimo per testo proveniente da mail/AI inserito nei template. */
export function esc(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Cornice HTML comune a tutte le mail dell'app (stile del magic link). */
export function layout(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="it"><body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#fcfaf6;color:#1a1613;padding:32px">
  <div style="max-width:520px;margin:0 auto">
    <h2 style="margin:0 0 8px">${esc(title)}</h2>
    ${bodyHtml}
    <p style="color:#9a9182;font-size:12px;line-height:1.6;margin-top:32px">BORU studio · borustudio.it<br/>Puoi disattivare queste notifiche dalle Impostazioni dell'app.</p>
  </div>
</body></html>`;
}

/** Bottone azzurro coerente con l'app. */
export function button(href: string, label: string): string {
  return `<p style="margin:28px 0"><a href="${esc(href)}" style="background:#b1ddf1;color:#1a1613;text-decoration:none;padding:12px 28px;border-radius:999px;font-weight:600;display:inline-block">${esc(label)}</a></p>`;
}

/** Invia il magic link di accesso. */
export async function sendMagicLink(email: string, url: string): Promise<void> {
  if (!env.brevo.apiKey) {
    console.log(`[mail:mock] magic link per ${email}: ${url}`);
    return;
  }
  await sendEmail({
    to: email,
    subject: "Il tuo link di accesso a BORU mail",
    html: `<!doctype html>
<html lang="it"><body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#fcfaf6;color:#1a1613;padding:32px">
  <div style="max-width:480px;margin:0 auto">
    <h2 style="margin:0 0 8px">Accedi a BORU mail</h2>
    <p style="color:#6b6357;line-height:1.6">Clicca il pulsante per entrare. Il link vale <strong>15 minuti</strong> e funziona una sola volta.</p>
    ${button(url, "Entra")}
    <p style="color:#9a9182;font-size:12px;line-height:1.6">Se non hai richiesto tu questo accesso, ignora questa email.<br/>BORU studio · borustudio.it</p>
  </div>
</body></html>`,
  });
}
