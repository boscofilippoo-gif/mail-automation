import Anthropic from "@anthropic-ai/sdk";

import { env } from "../env.js";
import type { ApiConnectorConfig, PriceListItem } from "../types.js";
import { MAX_ITEMS, parseItalianPrice } from "./parse.js";

const client = new Anthropic({ apiKey: env.anthropic.apiKey });

const FETCH_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5MB

/**
 * Guardia SSRF: il connettore fetcha URL forniti dall'utente — non deve poter
 * raggiungere la rete interna del server. Solo https e host pubblici.
 */
function assertSafeUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("URL non valido.");
  }
  if (url.protocol !== "https:") {
    throw new Error("Sono ammessi solo URL https://.");
  }
  const host = url.hostname.toLowerCase();
  const isPrivate =
    host === "localhost" ||
    host === "::1" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (isPrivate) {
    throw new Error("Host non ammesso.");
  }
  return url;
}

function authHeaders(config: ApiConnectorConfig): Record<string, string> {
  switch (config.authType) {
    case "apikey":
      if (!config.headerName || !config.secret) throw new Error("API key: servono nome header e chiave.");
      return { [config.headerName]: config.secret };
    case "bearer":
      if (!config.secret) throw new Error("Bearer: serve il token.");
      return { Authorization: `Bearer ${config.secret}` };
    case "basic":
      if (!config.secret?.includes(":")) throw new Error('Basic: inserisci le credenziali come "utente:password".');
      return { Authorization: `Basic ${Buffer.from(config.secret, "utf8").toString("base64")}` };
    default:
      return {};
  }
}

/** Mapping AI: dai primi elementi del JSON individua dove stanno gli articoli e i nomi dei campi. */
const API_MAPPING_SCHEMA = {
  type: "object",
  properties: {
    items_path: {
      type: ["string", "null"],
      description:
        "Percorso (dot-notation) dell'array di articoli dentro la risposta, es. 'data.products'. null se la risposta È direttamente l'array.",
    },
    description_field: { type: "string", description: "Nome del campo con la descrizione articolo." },
    price_field: { type: "string", description: "Nome del campo col prezzo unitario." },
    code_field: { type: ["string", "null"], description: "Campo codice articolo, null se assente." },
    unit_field: { type: ["string", "null"], description: "Campo unità di misura, null se assente." },
  },
  required: ["items_path", "description_field", "price_field", "code_field", "unit_field"],
  additionalProperties: false,
} as const;

interface ApiMapping {
  items_path: string | null;
  description_field: string;
  price_field: string;
  code_field: string | null;
  unit_field: string | null;
}

function resolvePath(obj: unknown, path: string | null): unknown {
  if (!path) return obj;
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

async function mapApiFields(sample: unknown): Promise<ApiMapping> {
  const response = await client.messages.create({
    model: env.anthropic.listinoModel,
    max_tokens: 256,
    system:
      "Sei un analizzatore di risposte API JSON di listini prezzi. Individua dove sta l'array degli articoli e come si chiamano i campi. Usa SEMPRE il tool 'map_api'.",
    tools: [
      {
        name: "map_api",
        description: "Restituisce il mapping dei campi del listino nella risposta API.",
        input_schema: API_MAPPING_SCHEMA as unknown as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: "tool", name: "map_api" },
    messages: [
      {
        role: "user",
        content: `Campione della risposta API (troncato):\n${JSON.stringify(sample).slice(0, 4000)}`,
      },
    ],
  });
  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Impossibile interpretare la struttura della risposta API.");
  }
  return toolUse.input as ApiMapping;
}

/**
 * Scarica il listino dall'API dell'utente e lo normalizza.
 * Una chiamata AI per sync (mapping campi); il parsing completo è in codice.
 */
export async function fetchApiItems(config: ApiConnectorConfig): Promise<PriceListItem[]> {
  const url = assertSafeUrl(config.url);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let text: string;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json", ...authHeaders(config) },
      signal: controller.signal,
      redirect: "error", // niente redirect: eviterebbe la guardia SSRF
    });
    if (!res.ok) {
      throw new Error(`L'API ha risposto ${res.status}${res.status === 401 || res.status === 403 ? ": credenziali non valide?" : ""}`);
    }
    text = await res.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
      throw new Error("Risposta API troppo grande (max 5MB).");
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("L'API non ha risposto entro 20 secondi.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("La risposta dell'API non è JSON valido.");
  }

  // campione per il mapping: primi elementi se è già un array, altrimenti l'oggetto
  const sample = Array.isArray(json) ? json.slice(0, 10) : json;
  const mapping = await mapApiFields(sample);

  const rawItems = resolvePath(json, mapping.items_path);
  if (!Array.isArray(rawItems)) {
    throw new Error("Non ho trovato l'elenco degli articoli nella risposta API.");
  }

  const items: PriceListItem[] = [];
  for (const raw of rawItems) {
    if (items.length >= MAX_ITEMS) break;
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const description = String(r[mapping.description_field] ?? "").trim();
    if (!description) continue;
    const price = parseItalianPrice(r[mapping.price_field]);
    if (price === null) continue;
    const code = mapping.code_field ? String(r[mapping.code_field] ?? "").trim() : "";
    const unit = mapping.unit_field ? String(r[mapping.unit_field] ?? "").trim() : "";
    items.push({
      code: code || null,
      description: description.slice(0, 300),
      unit: unit ? unit.slice(0, 20) : null,
      unit_price: price,
    });
  }
  return items;
}
