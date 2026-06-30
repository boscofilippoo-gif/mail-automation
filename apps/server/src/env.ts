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

export const env = {
  port: Number(optional("PORT", "4000")),
  webOrigin: optional("WEB_ORIGIN", "http://localhost:5273"),

  google: {
    clientId: required("GOOGLE_CLIENT_ID"),
    clientSecret: required("GOOGLE_CLIENT_SECRET"),
    redirectUri: optional("GOOGLE_REDIRECT_URI", "http://localhost:4000/auth/google/callback"),
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
