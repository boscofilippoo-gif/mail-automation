import { Router } from "express";

import { requireAuth } from "../auth/session.js";
import { scanUser } from "../jobs/dailyScan.js";

export const scanRouter = Router();

scanRouter.use(requireAuth);

/** Trigger manuale dello scan per l'utente loggato ("Scansiona ora"). */
scanRouter.post("/", async (req, res) => {
  try {
    const result = await scanUser(req.userId!);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[scan] trigger manuale fallito:", message);
    res.status(500).json({ error: message });
  }
});
