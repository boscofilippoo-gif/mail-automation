import crypto from "node:crypto";

import express, { Router } from "express";

import { BASIC_SCOPES, GOOGLE_SCOPES, env } from "../env.js";
import { exchangeCode, getAuthUrl } from "../auth/google.js";
import { clearSession, requireAuth, setSession } from "../auth/session.js";
import {
  createMagicLink,
  consumeMagicLink,
  getUserByEmail,
  getUserById,
  linkGoogleSub,
  saveTokens,
  setMailMode,
  upsertEmailUser,
  upsertUser,
} from "../repo.js";
import { sendMagicLink } from "../mail/send.js";

export const authRouter = Router();

/* ───────────────────────── OAuth Google: login vs connect ───────────────────────── */

interface PendingState {
  intent: "login" | "connect";
  userId?: number;
}

// nonce anti-CSRF per il flusso OAuth (single-instance: in-memory va bene)
const pendingStates = new Map<string, PendingState>();

function newState(entry: PendingState): string {
  const state = crypto.randomBytes(16).toString("hex");
  pendingStates.set(state, entry);
  setTimeout(() => pendingStates.delete(state), 10 * 60 * 1000);
  return state;
}

/** Login con Google: SOLI scope base → nessun avviso "app non verificata", nessuna scadenza. */
authRouter.get("/google", (_req, res) => {
  const state = newState({ intent: "login" });
  res.redirect(getAuthUrl(state, BASIC_SCOPES, false));
});

/**
 * Collega Gmail (incremental auth): scope pieni, refresh token.
 * Solo per utenti già loggati che scelgono la modalità Gmail.
 */
authRouter.get("/google/connect", requireAuth, (req, res) => {
  const state = newState({ intent: "connect", userId: req.userId! });
  res.redirect(getAuthUrl(state, GOOGLE_SCOPES, true));
});

/** Callback condiviso: si dirama sull'intent registrato nello state. */
authRouter.get("/google/callback", async (req, res) => {
  const { code, state } = req.query as { code?: string; state?: string };
  const entry = state ? pendingStates.get(state) : undefined;

  if (!code || !state || !entry) {
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

    if (entry.intent === "login") {
      // LOGIN BASE: MAI salvare i token qui — sovrascriverebbero lo scope
      // completo degli utenti Gmail-mode (bozze/listino/scan si romperebbero).
      const existing = getUserByEmail(profile.email);
      const user = existing && !existing.google_sub
        ? (linkGoogleSub(existing.id, profile.sub), existing)
        : upsertUser(profile.sub, profile.email, profile.name);
      setSession(res, user.id);
      const fresh = getUserById(user.id)!;
      res.redirect(env.webOrigin + (fresh.mail_mode ? "/dashboard" : "/onboarding"));
      return;
    }

    // CONNECT: aggancia i token all'utente della sessione registrato nello state
    const user = entry.userId ? getUserById(entry.userId) : undefined;
    if (!user) {
      res.status(400).send("Sessione scaduta: rifai l'accesso e riprova.");
      return;
    }
    if (user.google_sub && user.google_sub !== profile.sub) {
      res.redirect(env.webOrigin + "/onboarding?error=account-google-diverso");
      return;
    }
    if (!user.google_sub) linkGoogleSub(user.id, profile.sub);
    saveTokens(user.id, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date,
      scope: tokens.scope,
    });
    setMailMode(user.id, "gmail");
    res.redirect(env.webOrigin + "/dashboard");
  } catch (err) {
    console.error("[auth] callback fallito:", err);
    res.status(500).send("Errore durante il login. Controlla i log del server.");
  }
});

/* ───────────────────────── Magic link ───────────────────────── */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// rate limit in-memory: 3 per email / 10 per IP ogni 15 minuti
const byEmail = new Map<string, number[]>();
const byIp = new Map<string, number[]>();

function allow(map: Map<string, number[]>, key: string, max: number): boolean {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const hits = (map.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    map.set(key, hits);
    return false;
  }
  hits.push(now);
  map.set(key, hits);
  return true;
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Richiesta del link: risposta SEMPRE ok (niente enumeration degli account). */
authRouter.post("/magic", async (req, res) => {
  const email = String((req.body as { email?: string }).email ?? "").trim().toLowerCase();
  const ip = req.ip ?? "?";
  res.json({ ok: true }); // risposta immediata e uniforme

  if (!EMAIL_RE.test(email)) return;
  if (!allow(byEmail, email, 3) || !allow(byIp, ip, 10)) return;

  try {
    const token = crypto.randomBytes(32).toString("base64url");
    createMagicLink(email, hashToken(token)); // si salva SOLO l'hash
    const url = `${env.webOrigin}/auth/magic/verify?token=${token}`;
    await sendMagicLink(email, url);
  } catch (err) {
    console.error("[auth] invio magic link fallito:", err);
  }
});

/**
 * Pagina di verifica: NON consuma il token (gli scanner aziendali tipo Outlook
 * SafeLinks fanno GET sui link nelle email e brucerebbero il single-use).
 * Il consumo avviene solo col POST del form auto-inviato.
 */
authRouter.get("/magic/verify", (req, res) => {
  const token = String(req.query.token ?? "");
  res.type("html").send(`<!doctype html>
<html lang="it"><head><meta charset="utf-8"><title>Accesso — Mail Automation</title></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#1a1613;color:#fcfaf6;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
  <form method="POST" action="/auth/magic/consume" style="text-align:center">
    <input type="hidden" name="token" value="${token.replace(/[^A-Za-z0-9_-]/g, "")}" />
    <h2 style="font-weight:600">Un attimo…</h2>
    <p style="color:#a89f92">Ti stiamo facendo entrare.</p>
    <noscript><button type="submit" style="background:#b1ddf1;color:#1a1613;border:0;padding:12px 28px;border-radius:999px;font-weight:600;font-size:16px;cursor:pointer">Entra</button></noscript>
  </form>
  <script>document.forms[0].submit()</script>
</body></html>`);
});

/** Consumo atomico del token → sessione. Il form invia urlencoded, non JSON. */
authRouter.post("/magic/consume", express.urlencoded({ extended: false }), (req, res) => {
  const token = String((req.body as { token?: string }).token ?? "");
  const email = token ? consumeMagicLink(hashToken(token)) : null;
  if (!email) {
    res
      .status(400)
      .type("html")
      .send(`<p style="font-family:sans-serif">Link non valido, scaduto o già usato. <a href="${env.webOrigin}">Richiedine un altro</a>.</p>`);
    return;
  }
  const user = upsertEmailUser(email);
  setSession(res, user.id);
  res.redirect(env.webOrigin + (user.mail_mode ? "/dashboard" : "/onboarding"));
});

/** Logout: cancella il cookie di sessione. */
authRouter.post("/logout", (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});
