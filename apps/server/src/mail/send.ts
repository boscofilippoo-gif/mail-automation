import { env } from "../env.js";

/**
 * Invia il magic link via Brevo (API transazionale).
 * Senza BREVO_API_KEY (dev locale): stampa l'URL in console e basta.
 */
export async function sendMagicLink(email: string, url: string): Promise<void> {
  if (!env.brevo.apiKey) {
    console.log(`[mail:mock] magic link per ${email}: ${url}`);
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
      to: [{ email }],
      subject: "Il tuo link di accesso a Mail Automation",
      htmlContent: `<!doctype html>
<html lang="it"><body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#fcfaf6;color:#1a1613;padding:32px">
  <div style="max-width:480px;margin:0 auto">
    <h2 style="margin:0 0 8px">Accedi a Mail Automation</h2>
    <p style="color:#6b6357;line-height:1.6">Clicca il pulsante per entrare. Il link vale <strong>15 minuti</strong> e funziona una sola volta.</p>
    <p style="margin:28px 0">
      <a href="${url}" style="background:#b1ddf1;color:#1a1613;text-decoration:none;padding:12px 28px;border-radius:999px;font-weight:600;display:inline-block">Entra</a>
    </p>
    <p style="color:#9a9182;font-size:12px;line-height:1.6">Se non hai richiesto tu questo accesso, ignora questa email.<br/>BORU studio · borustudio.it</p>
  </div>
</body></html>`,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Invio email fallito (Brevo ${res.status}): ${body.slice(0, 200)}`);
  }
}
