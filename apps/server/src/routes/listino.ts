import { Router } from "express";

import { requireAuth } from "../auth/session.js";
import { SHEETS_SCOPE } from "../env.js";
import {
  deletePriceList,
  getPriceList,
  getPriceListApiConfig,
  hasScope,
  savePriceListItems,
  updatePriceListApiConfig,
  upsertPriceList,
} from "../repo.js";
import { applyMapping, parseCsv, MAX_ITEMS } from "../listino/parse.js";
import { mapColumns } from "../listino/mapColumns.js";
import { fetchSheetRows, NeedsReauthError, parseSheetUrl } from "../listino/sheet.js";
import { extractListinoFromPdf } from "../listino/pdf.js";
import { fetchApiItems } from "../listino/api.js";
import type { ApiConnectorConfig, PriceListItem } from "../types.js";

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

/** Risincronizza la fonte già collegata (Google Sheet o API). */
listinoRouter.post("/sync", async (req, res) => {
  const pl = getPriceList(req.userId!);
  if (!pl || (pl.meta.source_type !== "sheet" && pl.meta.source_type !== "api")) {
    res.status(400).json({ error: "Nessuna fonte sincronizzabile collegata (Google Sheet o API)." });
    return;
  }

  try {
    if (pl.meta.source_type === "api") {
      const config = getPriceListApiConfig(req.userId!);
      if (!config) {
        res.status(400).json({ error: "Configurazione API mancante: ricollega la fonte." });
        return;
      }
      const items = await fetchApiItems(config);
      if (items.length === 0) {
        res.status(400).json({ error: "Nessun articolo con prezzo nella risposta API." });
        return;
      }
      upsertPriceList(req.userId!, "api", pl.meta.source_ref, items, config);
      res.json(stateResponse(req.userId!));
      return;
    }

    if (!hasScope(req.userId!, SHEETS_SCOPE)) {
      res.json({ error: "Servono nuovi permessi Google per leggere il foglio.", needsReauth: true });
      return;
    }
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

/** Collega un'API REST/JSON: fetch, mapping AI dei campi, credenziali cifrate. */
listinoRouter.post("/api", async (req, res) => {
  const { url, authType, headerName, secret } = req.body as {
    url?: string;
    authType?: string;
    headerName?: string;
    secret?: string;
  };
  const AUTH_TYPES = ["none", "apikey", "bearer", "basic"];
  if (!url || !authType || !AUTH_TYPES.includes(authType)) {
    res.status(400).json({ error: "Servono URL e tipo di autenticazione validi." });
    return;
  }
  const config: ApiConnectorConfig = {
    url: url.trim(),
    authType: authType as ApiConnectorConfig["authType"],
    headerName: headerName?.trim().slice(0, 80) || undefined,
    secret: secret?.trim().slice(0, 500) || undefined,
  };

  try {
    const items = await fetchApiItems(config);
    if (items.length === 0) {
      res.status(400).json({ error: "Nessun articolo con prezzo riconosciuto nella risposta API." });
      return;
    }
    // source_ref = solo l'URL (mai le credenziali); la config completa va cifrata
    upsertPriceList(req.userId!, "api", config.url.slice(0, 300), items, config);
    res.json(stateResponse(req.userId!));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Errore nel collegamento dell'API" });
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

/* ───────────────── Articoli: ricerca, modifica, aggiunta, cancellazione ───────────────── */

function cleanItem(b: Record<string, unknown>, cur?: PriceListItem): PriceListItem {
  const str = (v: unknown, cap: number) => (typeof v === "string" ? v.trim().slice(0, cap) : "");
  const description = "description" in b ? str(b.description, 300) : (cur?.description ?? "");
  if (!description) throw new Error("La descrizione è obbligatoria.");
  let unit_price = cur?.unit_price ?? NaN;
  if ("unit_price" in b) {
    const n = typeof b.unit_price === "string" ? Number(b.unit_price.replace(",", ".")) : Number(b.unit_price);
    if (!Number.isFinite(n) || n < 0) throw new Error("Prezzo non valido.");
    unit_price = Math.round(n * 10000) / 10000;
  }
  if (!Number.isFinite(unit_price)) throw new Error("Prezzo obbligatorio.");
  return {
    id: cur?.id,
    code: "code" in b ? str(b.code, 60) || null : (cur?.code ?? null),
    description,
    unit: "unit" in b ? str(b.unit, 30) || null : (cur?.unit ?? null),
    unit_price,
  };
}

/** Ricerca paginata negli articoli (codice, descrizione, unità). */
listinoRouter.get("/items", (req, res) => {
  const pl = getPriceList(req.userId!);
  if (!pl) {
    res.json({ items: [], total: 0 });
    return;
  }
  const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const filtered = q
    ? pl.items.filter((it) => `${it.code ?? ""} ${it.description} ${it.unit ?? ""}`.toLowerCase().includes(q))
    : pl.items;
  res.json({ items: filtered.slice(offset, offset + limit), total: filtered.length });
});

/** Nuovo articolo (in testa: è quello che l'utente ha appena scritto). */
listinoRouter.post("/items", (req, res) => {
  const pl = getPriceList(req.userId!);
  if (!pl) {
    res.status(400).json({ error: "Nessun listino collegato." });
    return;
  }
  try {
    if (pl.items.length >= MAX_ITEMS) throw new Error(`Listino pieno (max ${MAX_ITEMS} articoli).`);
    const item = cleanItem(req.body as Record<string, unknown>);
    const meta = savePriceListItems(req.userId!, [item, ...pl.items]);
    const saved = getPriceList(req.userId!)!.items[0];
    res.json({ item: saved, meta });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Articolo non valido" });
  }
});

/** Correzione di un articolo. */
listinoRouter.patch("/items/:id", (req, res) => {
  const pl = getPriceList(req.userId!);
  const idx = pl?.items.findIndex((it) => it.id === req.params.id) ?? -1;
  if (!pl || idx < 0) {
    res.status(404).json({ error: "Articolo non trovato." });
    return;
  }
  try {
    const next = [...pl.items];
    next[idx] = cleanItem(req.body as Record<string, unknown>, pl.items[idx]);
    const meta = savePriceListItems(req.userId!, next);
    res.json({ item: next[idx], meta });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Articolo non valido" });
  }
});

listinoRouter.delete("/items/:id", (req, res) => {
  const pl = getPriceList(req.userId!);
  if (!pl || !pl.items.some((it) => it.id === req.params.id)) {
    res.status(404).json({ error: "Articolo non trovato." });
    return;
  }
  const meta = savePriceListItems(req.userId!, pl.items.filter((it) => it.id !== req.params.id));
  res.json({ ok: true, meta });
});

/* ───────────────── Connessione API: lettura (senza segreto) e modifica ───────────────── */

listinoRouter.get("/api-config", (req, res) => {
  const cfg = getPriceListApiConfig(req.userId!);
  if (!cfg) {
    res.status(404).json({ error: "Nessuna connessione API." });
    return;
  }
  // il segreto non esce mai dal server: si dice solo se c'è
  res.json({ url: cfg.url, authType: cfg.authType, headerName: cfg.headerName ?? null, hasSecret: Boolean(cfg.secret) });
});

/** Modifica URL/autenticazione: prova la chiamata, poi salva. Segreto vuoto = mantieni quello attuale. */
listinoRouter.patch("/api-config", async (req, res) => {
  const cur = getPriceListApiConfig(req.userId!);
  if (!cur) {
    res.status(404).json({ error: "Nessuna connessione API da modificare." });
    return;
  }
  const b = req.body as { url?: string; authType?: string; headerName?: string; secret?: string };
  const AUTH_TYPES = ["none", "apikey", "bearer", "basic"];
  const authType = (b.authType && AUTH_TYPES.includes(b.authType) ? b.authType : cur.authType) as ApiConnectorConfig["authType"];
  const config: ApiConnectorConfig = {
    url: (b.url?.trim() || cur.url).slice(0, 2000),
    authType,
    headerName: b.headerName !== undefined ? b.headerName.trim().slice(0, 80) || undefined : cur.headerName,
    secret: authType === "none" ? undefined : (b.secret?.trim().slice(0, 500) || cur.secret),
  };
  try {
    const items = await fetchApiItems(config);
    if (items.length === 0) throw new Error("La chiamata funziona ma non restituisce articoli con prezzo.");
    updatePriceListApiConfig(req.userId!, config);
    res.json({ ok: true, tested: items.length, url: config.url, authType: config.authType, headerName: config.headerName ?? null, hasSecret: Boolean(config.secret) });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Connessione non riuscita" });
  }
});

/** Rimuove il listino. */
listinoRouter.delete("/", (req, res) => {
  deletePriceList(req.userId!);
  res.json({ ok: true });
});
