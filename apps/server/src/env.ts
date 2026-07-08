import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

// Il .env vive nella root del monorepo (tre livelli sopra apps/server/src),
// non nella cwd del processo: lo carichiamo con un path esplicito.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

/** Legge una variabile d'ambiente obbligatoria; lancia un errore chiaro se manca. */
function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(
      `Variabile d'ambiente mancante: ${name}. Copia .env.example in .env e compilala.`,
    );
  }
  return v;
}

/** Legge una variabile opzionale con un valore di default. */
function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== "" ? v : fallback;
}

const isProd = process.env.NODE_ENV === "production";

// URL pubblico del servizio, usato come origine del sito e per il redirect OAuth.
// Priorità: PUBLIC_URL esplicito (dominio personalizzato, es. https://app.tuodominio.it)
// → RENDER_EXTERNAL_URL (auto su Render, es. https://xxx.onrender.com) → localhost.
const publicUrl = (process.env.PUBLIC_URL ?? process.env.RENDER_EXTERNAL_URL ?? "").replace(/\/$/, "");

export const env = {
  isProd,
  port: Number(optional("PORT", "4000")),
  webOrigin: publicUrl || optional("WEB_ORIGIN", "http://localhost:5273"),

  google: {
    clientId: required("GOOGLE_CLIENT_ID"),
    clientSecret: required("GOOGLE_CLIENT_SECRET"),
    redirectUri: publicUrl
      ? `${publicUrl}/auth/google/callback`
      : optional("GOOGLE_REDIRECT_URI", "http://localhost:4000/auth/google/callback"),
  },

  anthropic: {
    apiKey: required("ANTHROPIC_API_KEY"),
    model: optional("ANTHROPIC_MODEL", "claude-opus-4-8"),
    // modello economico per la classificazione delle mail (smart scan):
    // legge oggetto + inizio corpo e decide se è un documento commerciale
    classifyModel: optional("ANTHROPIC_CLASSIFY_MODEL", "claude-haiku-4-5"),
    // modello per il parsing del listino (mapping colonne, lettura PDF)
    listinoModel: optional("ANTHROPIC_LISTINO_MODEL", "claude-haiku-4-5"),
    // modello per il testo delle bozze di risposta
    replyModel: optional("ANTHROPIC_REPLY_MODEL", "claude-haiku-4-5"),
  },

  sessionSecret: required("SESSION_SECRET"),
  tokenEncKey: required("TOKEN_ENC_KEY"),

  // ── Brevo: invio magic link + ricezione inoltri (feature-gate: senza key, mock/console) ──
  brevo: {
    apiKey: optional("BREVO_API_KEY", ""),
    inboundWebhookKey: optional("INBOUND_WEBHOOK_KEY", ""),
    inboundDomain: optional("INBOUND_DOMAIN", "inbox.borustudio.it"),
    mailFrom: optional("MAIL_FROM", "accesso@borustudio.it"),
    mailFromName: optional("MAIL_FROM_NAME", "BORU Mail Automation"),
  },
} as const;

/** Scope minimi per il SOLO login (nessun avviso Google, nessuna scadenza). */
export const BASIC_SCOPES = ["openid", "email", "profile"];

/** Scope OAuth richiesti: identità + lettura Gmail + lettura Sheets + bozze Gmail. */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
];

/** Scope necessario per leggere il listino da Google Sheets. */
export const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

/**
 * Scope per creare le bozze di risposta. NOTA: gmail.compose autorizzerebbe
 * tecnicamente anche l'invio — la garanzia "solo bozze" è che questa app non
 * chiama MAI drafts.send/messages.send. È comunque lo scope minimo per drafts.create.
 */
export const DRAFTS_SCOPE = "https://www.googleapis.com/auth/gmail.compose";
