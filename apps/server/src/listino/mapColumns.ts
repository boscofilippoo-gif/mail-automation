import Anthropic from "@anthropic-ai/sdk";

import { env } from "../env.js";
import type { ColumnMapping } from "./parse.js";

const client = new Anthropic({ apiKey: env.anthropic.apiKey });

const MAPPING_SCHEMA = {
  type: "object",
  properties: {
    header_row_index: {
      type: "number",
      description: "Indice (0-based) della riga di intestazione. -1 se non c'è intestazione.",
    },
    description_col: { type: "number", description: "Indice colonna della descrizione articolo." },
    price_col: { type: "number", description: "Indice colonna del prezzo unitario." },
    code_col: { type: ["number", "null"], description: "Indice colonna del codice articolo, null se assente." },
    unit_col: { type: ["number", "null"], description: "Indice colonna dell'unità di misura, null se assente." },
    delimiter: {
      type: ["string", "null"],
      description: "Per file CSV: il delimitatore usato (',' ';' o tab). null se non applicabile.",
    },
  },
  required: ["header_row_index", "description_col", "price_col", "code_col", "unit_col", "delimiter"],
  additionalProperties: false,
} as const;

export interface MappingWithDelimiter extends ColumnMapping {
  delimiter: string | null;
}

/**
 * Individua le colonne del listino da un campione di righe grezze.
 * Una sola chiamata al modello economico per upload/sync; il parsing completo
 * di tutte le righe avviene poi in codice, gratis.
 */
export async function mapColumns(sampleRows: unknown[][]): Promise<MappingWithDelimiter> {
  const response = await client.messages.create({
    model: env.anthropic.listinoModel,
    max_tokens: 256,
    system:
      "Sei un analizzatore di listini prezzi italiani in forma tabellare. Ricevi le prime righe grezze e individui quali colonne contengono descrizione, prezzo unitario, codice articolo e unità di misura. Usa SEMPRE il tool 'map_columns'.",
    tools: [
      {
        name: "map_columns",
        description: "Restituisce il mapping delle colonne del listino.",
        input_schema: MAPPING_SCHEMA as unknown as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: "tool", name: "map_columns" },
    messages: [
      {
        role: "user",
        content: `Prime righe del listino (array JSON, una riga per elemento):\n${JSON.stringify(sampleRows.slice(0, 15), null, 1)}`,
      },
    ],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Impossibile interpretare la struttura del listino.");
  }
  const raw = toolUse.input as Partial<MappingWithDelimiter>;
  const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isInteger(v) && v >= -1 ? v : fallback);
  return {
    header_row_index: num(raw.header_row_index, 0),
    description_col: num(raw.description_col, 0),
    price_col: num(raw.price_col, 1),
    code_col: typeof raw.code_col === "number" ? raw.code_col : null,
    unit_col: typeof raw.unit_col === "number" ? raw.unit_col : null,
    delimiter: typeof raw.delimiter === "string" && raw.delimiter ? raw.delimiter : null,
  };
}
