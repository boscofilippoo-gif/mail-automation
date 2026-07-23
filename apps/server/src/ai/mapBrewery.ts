import Anthropic from "@anthropic-ai/sdk";

import { env } from "../env.js";
import type { BreweryRow, LineItem, SortAssignment } from "../types.js";

const client = new Anthropic({ apiKey: env.anthropic.apiKey });

/* ─────────────── Step caricamento: proponi alias per ogni riga ─────────────── */

const ALIASES_SCHEMA = {
  type: "object",
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        properties: {
          row: { type: "number", description: "Il numero di riga fornito in input." },
          aliases: {
            type: "array",
            items: { type: "string" },
            description:
              "Nomi/sinonimi con cui un cliente potrebbe chiamare questo prodotto (italiano/tedesco, abbreviazioni, senza gradazione), es. per 'HURTIP HELL Beer 4,8%': ['hell','helles','bionda','chiara'].",
          },
        },
        required: ["row", "aliases"],
        additionalProperties: false,
      },
    },
  },
  required: ["rows"],
  additionalProperties: false,
} as const;

/**
 * Al caricamento del modulo: propone sinonimi per ogni riga-prodotto, così la
 * mappatura runtime può spesso risolvere in locale senza chiamare l'AI.
 * L'utente rivede/corregge gli alias proposti.
 */
export async function suggestAliases(rows: BreweryRow[]): Promise<BreweryRow[]> {
  if (rows.length === 0) return rows;
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: env.anthropic.listinoModel,
      max_tokens: 2000,
      system:
        "Sei un esperto di birra e vino. Ricevi le righe-prodotto di un modulo d'ordine di un birrificio e, per ognuna, proponi i nomi con cui un cliente italiano potrebbe indicarla in un ordine via mail (sinonimi, abbreviazioni, nome senza la gradazione alcolica, eventuale tedesco). Usa SEMPRE il tool 'propose_aliases'.",
      tools: [
        {
          name: "propose_aliases",
          description: "Restituisce alias per ciascuna riga-prodotto.",
          input_schema: ALIASES_SCHEMA as unknown as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: "propose_aliases" },
      messages: [
        {
          role: "user",
          content: `Righe-prodotto (row = numero riga, label = testo del modulo):\n${JSON.stringify(
            rows.map((r) => ({ row: r.row, label: r.label })),
            null,
            1,
          )}`,
        },
      ],
    });
  } catch {
    return rows; // se l'AI fallisce, l'utente compila gli alias a mano
  }

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") return rows;
  const raw = (toolUse.input as { rows?: unknown[] }).rows ?? [];
  const byRow = new Map<number, string[]>();
  for (const r of raw) {
    const o = r as { row?: unknown; aliases?: unknown };
    if (typeof o.row !== "number" || !Array.isArray(o.aliases)) continue;
    const aliases = o.aliases
      .filter((a): a is string => typeof a === "string" && a.trim().length > 0)
      .map((a) => a.trim().slice(0, 60))
      .slice(0, 12);
    byRow.set(o.row, aliases);
  }
  return rows.map((r) => ({ ...r, aliases: byRow.get(r.row) ?? r.aliases }));
}

/* ─────────────── Step ordine: mappa le righe d'ordine → righe modulo ─────────────── */

const MATCH_SCHEMA = {
  type: "object",
  properties: {
    matches: {
      type: "array",
      items: {
        type: "object",
        properties: {
          item_index: { type: "number", description: "Indice (0-based) della riga d'ordine." },
          row: {
            type: ["number", "null"],
            description: "Numero riga del modulo che corrisponde, oppure null se nessuna corrisponde.",
          },
        },
        required: ["item_index", "row"],
        additionalProperties: false,
      },
    },
  },
  required: ["matches"],
  additionalProperties: false,
} as const;

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const words = (s: string) => new Set(norm(s).split(" ").filter(Boolean));

/**
 * Punteggio di match tra una descrizione d'ordine e una riga-modulo.
 * alias/label identico = 100; tutte le parole contenute = 50+; substring debole = 10.
 * Estratto per essere riusato dal match locale mono- e cross-modulo.
 */
function scoreRow(descNorm: string, descWords: Set<string>, r: BreweryRow): number {
  const needles = [r.label, ...r.aliases].map(norm).filter(Boolean);
  let score = 0;
  for (const n of needles) {
    if (n === descNorm) score = Math.max(score, 100);
    else {
      const nWords = words(n);
      const nInDesc = [...nWords].every((w) => descWords.has(w));
      const descInN = [...descWords].every((w) => nWords.has(w));
      if (nInDesc || descInN) score = Math.max(score, 50 + Math.min(nWords.size, descWords.size));
      else if (descNorm.includes(n) || n.includes(descNorm)) score = Math.max(score, 10);
    }
  }
  return score;
}

const LOCAL_MATCH_THRESHOLD = 50;

/**
 * Mappa ogni riga d'ordine sulla riga del modulo birrificio.
 * Prima tenta un match locale (label/alias contenuti nella descrizione) — gratis;
 * solo le righe d'ordine non risolte vengono passate all'AI per il match flessibile.
 * Ritorna Map<indice line_item → riga modulo>. Le righe non mappate sono assenti.
 */
export async function mapOrderToRows(
  lineItems: LineItem[],
  rows: BreweryRow[],
): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  const unresolved: number[] = [];

  // 1) match locale: scelgo il candidato col punteggio migliore, non il primo.
  for (let i = 0; i < lineItems.length; i++) {
    const desc = norm(lineItems[i]!.description);
    if (!desc) continue;
    const descWords = words(lineItems[i]!.description);
    let best: { row: number; score: number } | null = null;
    for (const r of rows) {
      const score = scoreRow(desc, descWords, r);
      if (score > 0 && (!best || score > best.score)) best = { row: r.row, score };
    }
    if (best && best.score >= LOCAL_MATCH_THRESHOLD) result.set(i, best.row);
    else unresolved.push(i);
  }

  if (unresolved.length === 0) return result;

  // 2) match flessibile via AI per le sole righe non risolte
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: env.anthropic.listinoModel,
      max_tokens: 1000,
      system:
        "Abbini le righe di un ordine cliente (nomi liberi) alle righe di un modulo d'ordine di un birrificio. Match flessibile: sinonimi, abbreviazioni, italiano/tedesco, gradazione ignorata. Se nessuna riga del modulo corrisponde, usa null. Usa SEMPRE il tool 'match_rows'.",
      tools: [
        {
          name: "match_rows",
          description: "Restituisce, per ogni riga d'ordine, la riga del modulo corrispondente o null.",
          input_schema: MATCH_SCHEMA as unknown as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: "match_rows" },
      messages: [
        {
          role: "user",
          content:
            `Righe del modulo (row = numero, label = testo):\n${JSON.stringify(
              rows.map((r) => ({ row: r.row, label: r.label, aliases: r.aliases })),
              null,
              1,
            )}\n\nRighe d'ordine da abbinare (item_index = indice):\n${JSON.stringify(
              unresolved.map((i) => ({ item_index: i, description: lineItems[i]!.description })),
              null,
              1,
            )}`,
        },
      ],
    });
  } catch {
    return result; // le non risolte restano non mappate (segnalate a valle)
  }

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") return result;
  const validRows = new Set(rows.map((r) => r.row));
  const matches = (toolUse.input as { matches?: unknown[] }).matches ?? [];
  for (const m of matches) {
    const o = m as { item_index?: unknown; row?: unknown };
    if (typeof o.item_index !== "number") continue;
    if (typeof o.row === "number" && validRows.has(o.row)) {
      result.set(o.item_index, o.row);
    }
  }
  return result;
}

/* ─────────────── Smistamento cross-modulo (N fornitori) ─────────────── */

interface TemplateForMatch {
  breweryKey: string;
  rows: BreweryRow[];
}

const CROSS_MATCH_SCHEMA = {
  type: "object",
  properties: {
    matches: {
      type: "array",
      items: {
        type: "object",
        properties: {
          item_index: { type: "number", description: "Indice (0-based) della riga d'ordine." },
          brewery_key: {
            type: ["string", "null"],
            description: "Chiave del fornitore/modulo che contiene il prodotto, null se nessuno.",
          },
          row: {
            type: ["number", "null"],
            description: "Numero riga dentro quel modulo, null se nessuna corrisponde.",
          },
        },
        required: ["item_index", "brewery_key", "row"],
        additionalProperties: false,
      },
    },
  },
  required: ["matches"],
  additionalProperties: false,
} as const;

/**
 * Mappa ogni riga d'ordine sul fornitore+riga giusti, cercando tra TUTTI i moduli.
 * Match locale globale (miglior punteggio su tutte le righe di tutti i moduli) +
 * una sola chiamata AI per il residuo. Ritorna le assegnazioni risolte e gli
 * indici non assegnati a nessun fornitore.
 */
export async function mapOrderAcrossTemplates(
  lineItems: LineItem[],
  templates: TemplateForMatch[],
): Promise<{ assignments: SortAssignment[]; unassigned: number[] }> {
  const assignments: SortAssignment[] = [];
  const unresolved: number[] = [];

  // 1) match locale globale: per ogni prodotto, il miglior (modulo,riga) su tutti i moduli
  for (let i = 0; i < lineItems.length; i++) {
    const desc = norm(lineItems[i]!.description);
    if (!desc) {
      unresolved.push(i);
      continue;
    }
    const descWords = words(lineItems[i]!.description);
    let best: { breweryKey: string; row: number; score: number } | null = null;
    for (const t of templates) {
      for (const r of t.rows) {
        const score = scoreRow(desc, descWords, r);
        if (score > 0 && (!best || score > best.score)) {
          best = { breweryKey: t.breweryKey, row: r.row, score };
        }
      }
    }
    if (best && best.score >= LOCAL_MATCH_THRESHOLD) {
      assignments.push({ itemIndex: i, breweryKey: best.breweryKey, row: best.row });
    } else {
      unresolved.push(i);
    }
  }

  if (unresolved.length === 0) return { assignments, unassigned: [] };

  // 2) una sola chiamata AI per il residuo, con tutte le righe di tutti i moduli
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: env.anthropic.listinoModel,
      max_tokens: 1500,
      system:
        "Abbini le righe di un ordine cliente (nomi liberi) alle righe dei moduli d'ordine di più fornitori. Per ogni riga d'ordine indica quale fornitore (brewery_key) e quale riga del suo modulo corrisponde. Match flessibile: sinonimi, abbreviazioni, italiano/tedesco, gradazione ignorata. Se nessun fornitore ha il prodotto, brewery_key e row = null. Usa SEMPRE il tool 'match_rows'.",
      tools: [
        {
          name: "match_rows",
          description: "Per ogni riga d'ordine, il fornitore+riga corrispondente o null.",
          input_schema: CROSS_MATCH_SCHEMA as unknown as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: "match_rows" },
      messages: [
        {
          role: "user",
          content:
            `Moduli fornitori (brewery_key + righe):\n${JSON.stringify(
              templates.map((t) => ({
                brewery_key: t.breweryKey,
                rows: t.rows.map((r) => ({ row: r.row, label: r.label, aliases: r.aliases })),
              })),
              null,
              1,
            )}\n\nRighe d'ordine da abbinare (item_index = indice):\n${JSON.stringify(
              unresolved.map((i) => ({ item_index: i, description: lineItems[i]!.description })),
              null,
              1,
            )}`,
        },
      ],
    });
  } catch {
    return { assignments, unassigned: unresolved }; // residuo non assegnato
  }

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") return { assignments, unassigned: unresolved };

  // validazione: brewery_key deve esistere e row appartenere a QUEL modulo
  const rowsByKey = new Map(templates.map((t) => [t.breweryKey, new Set(t.rows.map((r) => r.row))]));
  const resolved = new Set<number>();
  const matches = (toolUse.input as { matches?: unknown[] }).matches ?? [];
  for (const m of matches) {
    const o = m as { item_index?: unknown; brewery_key?: unknown; row?: unknown };
    if (typeof o.item_index !== "number") continue;
    if (typeof o.brewery_key !== "string" || typeof o.row !== "number") continue;
    const validRows = rowsByKey.get(o.brewery_key);
    if (validRows?.has(o.row)) {
      assignments.push({ itemIndex: o.item_index, breweryKey: o.brewery_key, row: o.row });
      resolved.add(o.item_index);
    }
  }
  const unassigned = unresolved.filter((i) => !resolved.has(i));
  return { assignments, unassigned };
}
