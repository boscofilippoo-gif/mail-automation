import { Router } from "express";

import { requireAuth } from "../auth/session.js";
import { MANUAL_SCAN_OPTS, scanUser } from "../jobs/dailyScan.js";

export const scanRouter = Router();

scanRouter.use(requireAuth);

/** Trigger manuale ("Scansiona ora"): finestra 15 giorni, budget 50 classificazioni. */
scanRouter.post("/", async (req, res) => {
  try {
    const result = await scanUser(req.userId!, MANUAL_SCAN_OPTS);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[scan] trigger manuale fallito:", message);
    res.status(500).json({ error: message });
  }
});
