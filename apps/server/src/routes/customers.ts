import { Router } from "express";

import { requireAuth } from "../auth/session.js";
import {
  customerMonthly,
  deleteCustomerIfEmpty,
  getCustomerWithStats,
  listCustomers,
  mergeCustomers,
  queryDocuments,
  updateCustomer,
  type CustomerSort,
} from "../repo.js";

export const customersRouter = Router();
customersRouter.use(requireAuth);

const SORTS: readonly CustomerSort[] = ["name", "recent", "total"];

function qInt(v: unknown, fallback: number, max: number): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? Math.min(n, max) : fallback;
}
function cleanStr(v: unknown, cap: number): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return String(v).trim().slice(0, cap);
}

/** Lista clienti con i tre numeri (preventivi/ordini/fatture). Query: q, sort, limit, offset. */
customersRouter.get("/", (req, res) => {
  const limit = qInt(req.query.limit, 50, 200) || 50;
  const offset = qInt(req.query.offset, 0, 1_000_000);
  const sort = SORTS.includes(req.query.sort as CustomerSort) ? (req.query.sort as CustomerSort) : "recent";
  const q = typeof req.query.q === "string" && req.query.q.trim() ? req.query.q.trim().slice(0, 100) : undefined;
  res.json({ ...listCustomers(req.userId!, { q, sort, limit, offset }), limit, offset });
});

/** Scheda: anagrafica + numeri + andamento mensile + documenti (prima pagina). */
customersRouter.get("/:id", (req, res) => {
  const c = getCustomerWithStats(req.userId!, Number(req.params.id));
  if (!c) {
    res.status(404).json({ error: "Cliente non trovato" });
    return;
  }
  const docs = queryDocuments(req.userId!, { customerId: c.id, sort: "recent", limit: 200, offset: 0 });
  res.json({
    customer: c,
    monthly: customerMonthly(req.userId!, c.id),
    documents: docs.items.map((d) => ({
      id: d.id,
      type: d.type,
      createdAt: d.created_at,
      sentStatus: d.sent_status,
      subject: d.subject,
      documentNumber: (JSON.parse(d.extracted_json) as { document_number: string | null }).document_number,
      total: (JSON.parse(d.extracted_json) as { total: number | null }).total,
      currency: (JSON.parse(d.extracted_json) as { currency: string }).currency,
      review: d.review_json && d.review_json !== "[]" ? JSON.parse(d.review_json).length : 0,
    })),
    documentsTotal: docs.total,
  });
});

/** Correzione manuale dell'anagrafica (vince sui dati dedotti dall'AI). */
customersRouter.patch("/:id", (req, res) => {
  const b = req.body as Record<string, unknown>;
  const name = cleanStr(b.name, 200);
  if (name === "") {
    res.status(400).json({ error: "Il nome non può essere vuoto." });
    return;
  }
  const updated = updateCustomer(req.userId!, Number(req.params.id), {
    name: name ?? undefined,
    vat: cleanStr(b.vat, 40),
    email: cleanStr(b.email, 200),
    address: cleanStr(b.address, 300),
    notes: cleanStr(b.notes, 2000),
  });
  if (!updated) {
    res.status(404).json({ error: "Cliente non trovato" });
    return;
  }
  res.json(getCustomerWithStats(req.userId!, updated.id));
});

/** Unisce questa scheda in un'altra: i documenti passano di là, questa sparisce. */
customersRouter.post("/:id/merge", (req, res) => {
  const intoId = Number((req.body as { intoId?: unknown }).intoId);
  if (!Number.isInteger(intoId)) {
    res.status(400).json({ error: "Destinazione non valida." });
    return;
  }
  const merged = mergeCustomers(req.userId!, Number(req.params.id), intoId);
  if (!merged) {
    res.status(404).json({ error: "Cliente non trovato o unione non valida." });
    return;
  }
  res.json(getCustomerWithStats(req.userId!, merged.id));
});

/** Elimina una scheda vuota (con documenti si usa l'unione). */
customersRouter.delete("/:id", (req, res) => {
  const r = deleteCustomerIfEmpty(req.userId!, Number(req.params.id));
  if (r === "not_found") res.status(404).json({ error: "Cliente non trovato" });
  else if (r === "has_documents") res.status(400).json({ error: "La scheda ha documenti: uniscila a un'altra invece di eliminarla." });
  else res.json({ ok: true });
});
