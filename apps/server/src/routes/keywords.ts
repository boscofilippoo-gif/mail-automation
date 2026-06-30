import { Router } from "express";

import { requireAuth } from "../auth/session.js";
import { addKeyword, deleteKeyword, listKeywords, setKeywordActive } from "../repo.js";
import { DOC_TYPES, type DocType } from "../types.js";

export const keywordsRouter = Router();

keywordsRouter.use(requireAuth);

/** Elenca le keyword dell'utente. */
keywordsRouter.get("/", (req, res) => {
  res.json(listKeywords(req.userId!));
});

/** Crea una keyword. Body: { term, docType }. */
keywordsRouter.post("/", (req, res) => {
  const { term, docType } = req.body as { term?: string; docType?: string };
  const cleanTerm = (term ?? "").trim();
  if (!cleanTerm) {
    res.status(400).json({ error: "term obbligatorio" });
    return;
  }
  const type: DocType = DOC_TYPES.includes(docType as DocType) ? (docType as DocType) : "preventivo";
  res.status(201).json(addKeyword(req.userId!, cleanTerm, type));
});

/** Attiva/disattiva una keyword. Body: { active }. */
keywordsRouter.patch("/:id", (req, res) => {
  const id = Number(req.params.id);
  const { active } = req.body as { active?: boolean };
  setKeywordActive(req.userId!, id, Boolean(active));
  res.json({ ok: true });
});

/** Elimina una keyword. */
keywordsRouter.delete("/:id", (req, res) => {
  deleteKeyword(req.userId!, Number(req.params.id));
  res.json({ ok: true });
});
