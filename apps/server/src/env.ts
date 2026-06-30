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

// Render espone automaticamente l'URL pubblico del servizio in RENDER_EXTERNAL_URL
// (es. https://mail-automation-xxxx.onrender.com). Quando c'è, lo usiamo come
// origine del sito e per costruire il redirect URI OAuth: così non serve
// inserirli a mano dopo aver scoperto il dominio.
const publicUrl = (process.env.RENDER_EXTERNAL_URL ?? "").replace(/\/$/, "");

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
  },

  sessionSecret: required("SESSION_SECRET"),
  tokenEncKey: required("TOKEN_ENC_KEY"),
} as const;

/** Scope OAuth richiesti: identità di base + lettura Gmail. */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
];
