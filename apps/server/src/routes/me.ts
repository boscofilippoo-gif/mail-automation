import { Router } from "express";

import { requireAuth } from "../auth/session.js";
import { getUserById } from "../repo.js";

export const meRouter = Router();

/** Profilo dell'utente loggato. Usata dal frontend per capire se c'è una sessione. */
meRouter.get("/", requireAuth, (req, res) => {
  const user = getUserById(req.userId!);
  if (!user) {
    res.status(404).json({ error: "utente non trovato" });
    return;
  }
  res.json({ id: user.id, email: user.email, displayName: user.display_name });
});
