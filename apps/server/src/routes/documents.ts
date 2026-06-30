import fs from "node:fs";

import { Router } from "express";

import { requireAuth } from "../auth/session.js";
import { getDocument, listDocuments, listProcessed } from "../repo.js";

export const documentsRouter = Router();

documentsRouter.use(requireAuth);

/** Lista documenti generati, con i dati estratti già parsati. */
documentsRouter.get("/", (req, res) => {
  const docs = listDocuments(req.userId!).map((d) => ({
    id: d.id,
    type: d.type,
    createdAt: d.created_at,
    sourceMessageId: d.source_message_id,
    data: JSON.parse(d.extracted_json),
  }));
  res.json(docs);
});

/** Log delle mail processate (per la dashboard: stato done/error). */
documentsRouter.get("/processed", (req, res) => {
  res.json(listProcessed(req.userId!));
});

/** Anteprima/download del PDF. ?download=1 forza il download. */
documentsRouter.get("/:id/pdf", (req, res) => {
  const doc = getDocument(req.userId!, Number(req.params.id));
  if (!doc || !fs.existsSync(doc.pdf_path)) {
    res.status(404).json({ error: "PDF non trovato" });
    return;
  }
  const disposition = req.query.download ? "attachment" : "inline";
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${disposition}; filename="${doc.type}-${doc.id}.pdf"`);
  fs.createReadStream(doc.pdf_path).pipe(res);
});
