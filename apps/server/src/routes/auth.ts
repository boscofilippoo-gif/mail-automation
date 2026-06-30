import crypto from "node:crypto";

import { Router } from "express";

import { env } from "../env.js";
import { exchangeCode, getAuthUrl } from "../auth/google.js";
import { clearSession, setSession } from "../auth/session.js";
import { saveTokens, upsertUser } from "../repo.js";

export const authRouter = Router();

// nonce anti-CSRF temporanee per il flusso OAuth (sufficiente per un MVP single-instance)
const pendingStates = new Set<string>();

/** Avvia il login: genera state, costruisce l'URL e reindirizza a Google. */
authRouter.get("/google", (_req, res) => {
  const state = crypto.randomBytes(16).toString("hex");
  pendingStates.add(state);
  // pulizia opportunistica: lo state vive al massimo 10 minuti
  setTimeout(() => pendingStates.delete(state), 10 * 60 * 1000);
  res.redirect(getAuthUrl(state));
});

/** Callback OAuth: valida lo state, scambia il code, crea sessione e torna alla web app. */
authRouter.get("/google/callback", async (req, res) => {
  const { code, state } = req.query as { code?: string; state?: string };

  if (!code || !state || !pendingStates.has(state)) {
    res.status(400).send("Stato OAuth non valido o scaduto. Riprova il login.");
    return;
  }
  pendingStates.delete(state);

  try {
    const { tokens, profile } = await exchangeCode(code);
    if (!profile.sub || !profile.email) {
      res.status(400).send("Impossibile leggere il profilo Google.");
      return;
    }
    const user = upsertUser(profile.sub, profile.email, profile.name);
    saveTokens(user.id, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date,
      scope: tokens.scope,
    });
    setSession(res, user.id);
    res.redirect(env.webOrigin + "/dashboard");
  } catch (err) {
    console.error("[auth] callback fallito:", err);
    res.status(500).send("Errore durante il login. Controlla i log del server.");
  }
});

/** Logout: cancella il cookie di sessione. */
authRouter.post("/logout", (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});
