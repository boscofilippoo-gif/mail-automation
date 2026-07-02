import { Router } from "express";

import { requireAuth } from "../auth/session.js";
import { SHEETS_SCOPE } from "../env.js";
import { deletePriceList, getPriceList, hasScope, upsertPriceList } from "../repo.js";
import { applyMapping, parseCsv, MAX_ITEMS } from "../listino/parse.js";
import { mapColumns } from "../listino/mapColumns.js";
import { fetchSheetRows, NeedsReauthError, parseSheetUrl } from "../listino/sheet.js";
import { extractListinoFromPdf } from "../listino/pdf.js";
import type { PriceListItem } from "../types.js";

export const listinoRouter = Router();

listinoRouter.use(requireAuth);

const MAX_PDF_BYTES = 10 * 1024 * 1024; // 10MB binari

function stateResponse(userId: number) {
  const pl = getPriceList(userId);
  if (!pl) return { connected: false as const };
  return {
    connected: true as const,
    ...pl.meta,
    preview: pl.items.slice(0, 20),
  };
}

/** Stato del listino: fonte, conteggio, anteprima primi articoli. */
listinoRouter.get("/", (req, res) => {
  res.json(stateResponse(req.userId!));
});

/** Sincronizza (o collega) un Google Sheet: legge, mappa colonne, salva. */
async function syncSheet(userId: number, spreadsheetId: string) {
  const rows = await fetchSheetRows(userId, spreadsheetId);
  if (rows.length === 0) throw new Error("Il foglio è vuoto.");
  const mapping = await mapColumns(rows);
  const items = applyMapping(rows, mapping);
  if (items.length === 0) {
    throw new Error("Nessun articolo con prezzo riconosciuto nel foglio. Controlla che ci siano colonne descrizione e prezzo.");
  }
  upsertPriceList(userId, "sheet", spreadsheetId, items);
}

/** Collega un Google Sheet dal suo URL (o ID). */
listinoRouter.post("/sheet", async (req, res) => {
  const { url } = req.body as { url?: string };
  const spreadsheetId = parseSheetUrl(url ?? "");
  if (!spreadsheetId) {
    res.status(400).json({ error: "URL del foglio non riconosciuto. Incolla il link completo di Google Sheets." });
    return;
  }
  // check deterministico sullo scope salvato PRIMA di chiamare l'API
  if (!hasScope(req.userId!, SHEETS_SCOPE)) {
    res.json({ error: "Servono nuovi permessi Google per leggere il foglio.", needsReauth: true });
    return;
  }
  try {
    await syncSheet(req.userId!, spreadsheetId);
    res.json(stateResponse(req.userId!));
  } catch (err) {
    if (err instanceof NeedsReauthError) {
      res.json({ error: err.message, needsReauth: true });
      return;
    }
    res.status(400).json({ error: err instanceof Error ? err.message : "Errore nel collegamento del foglio" });
  }
});

/** Risincronizza il foglio già collegato. */
listinoRouter.post("/sync", async (req, res) => {
  const pl = getPriceList(req.userId!);
  if (!pl || pl.meta.source_type !== "sheet") {
    res.status(400).json({ error: "Nessun Google Sheet collegato da sincronizzare." });
    return;
  }
  if (!hasScope(req.userId!, SHEETS_SCOPE)) {
    res.json({ error: "Servono nuovi permessi Google per leggere il foglio.", needsReauth: true });
    return;
  }
  try {
    await syncSheet(req.userId!, pl.meta.source_ref);
    res.json(stateResponse(req.userId!));
  } catch (err) {
    if (err instanceof NeedsReauthError) {
      res.json({ error: err.message, needsReauth: true });
      return;
    }
    res.status(400).json({ error: err instanceof Error ? err.message : "Errore nella sincronizzazione" });
  }
});

/** Upload di un listino come file: PDF (letto da Claude) o CSV. */
listinoRouter.post("/upload", async (req, res) => {
  const { filename, data, kind } = req.body as { filename?: string; data?: string; kind?: string };
  if (!data || (kind !== "pdf" && kind !== "csv")) {
    res.status(400).json({ error: "Upload non valido: servono 'data' (base64) e 'kind' (pdf|csv)." });
    return;
  }
  const name = (filename ?? `listino.${kind}`).slice(0, 120);

  try {
    let items: PriceListItem[];
    if (kind === "pdf") {
      const payload = data.replace(/^data:[^;]+;base64,/, "");
      if (Buffer.byteLength(payload, "base64") > MAX_PDF_BYTES) {
        res.status(400).json({ error: "PDF troppo grande (max 10MB). Riduci il file o usa un Google Sheet." });
        return;
      }
      items = await extractListinoFromPdf(payload);
    } else {
      const text = Buffer.from(data.replace(/^data:[^;]+;base64,/, ""), "base64").toString("utf8");
      const probeRows = text.split(/\r?\n/).slice(0, 15).map((l) => [l]);
      const mapping = await mapColumns(probeRows);
      const rows = parseCsv(text, mapping.delimiter ?? ",");
      items = applyMapping(rows, mapping);
    }

    if (items.length === 0) {
      res.status(400).json({ error: "Nessun articolo con prezzo riconosciuto nel file." });
      return;
    }
    upsertPriceList(req.userId!, kind, name, items.slice(0, MAX_ITEMS));
    res.json(stateResponse(req.userId!));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Errore nell'elaborazione del file" });
  }
});

/** Rimuove il listino. */
listinoRouter.delete("/", (req, res) => {
  deletePriceList(req.userId!);
  res.json({ ok: true });
});
