import { Router } from "express";

import { requireAuth } from "../auth/session.js";
import { getUserById, hasScope, setMailMode } from "../repo.js";

const GMAIL_READONLY = "https://www.googleapis.com/auth/gmail.readonly";

export const meRouter = Router();

/** Profilo dell'utente loggato + stato del collegamento casella. */
meRouter.get("/", requireAuth, (req, res) => {
  const user = getUserById(req.userId!);
  if (!user) {
    res.status(404).json({ error: "utente non trovato" });
    return;
  }
  res.json({
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    mailMode: user.mail_mode,
    hasGmail: hasScope(user.id, GMAIL_READONLY),
  });
});

/**
 * Imposta la modalità casella. Solo 'inoltro' via API: la modalità 'gmail'
 * viene impostata dal callback OAuth connect, dopo l'autorizzazione reale.
 */
meRouter.post("/mail-mode", requireAuth, (req, res) => {
  const { mode } = req.body as { mode?: string };
  if (mode !== "inoltro") {
    res.status(400).json({ error: "Modalità non valida (usa il collegamento Gmail per la modalità diretta)." });
    return;
  }
  setMailMode(req.userId!, "inoltro");
  res.json({ ok: true, mailMode: "inoltro" });
});
