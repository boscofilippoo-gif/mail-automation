import Anthropic from "@anthropic-ai/sdk";

import { env } from "../env.js";
import type { PriceListItem } from "../types.js";
import { MAX_ITEMS } from "./parse.js";

const client = new Anthropic({ apiKey: env.anthropic.apiKey });

const ITEMS_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          code: { type: ["string", "null"], description: "Codice articolo, null se assente." },
          description: { type: "string", description: "Descrizione dell'articolo." },
          unit: { type: ["string", "null"], description: "Unità di misura (pz, kg, m…), null se assente." },
          unit_price: { type: "number", description: "Prezzo unitario. OBBLIGATORIO: righe senza prezzo vanno omesse." },
        },
        required: ["code", "description", "unit", "unit_price"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
} as const;

/**
 * Estrae gli articoli del listino da un PDF: Claude legge il documento
 * nativamente (document block base64). Una sola chiamata per upload.
 */
export async function extractListinoFromPdf(base64: string): Promise<PriceListItem[]> {
  // il client può mandare un data URL: teniamo solo il payload base64
  const data = base64.replace(/^data:application\/pdf;base64,/, "");

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: env.anthropic.listinoModel,
      // 16k copre ~400-500 articoli; oltre, meglio un Google Sheet
      max_tokens: 16000,
      system:
        "Sei un estrattore di listini prezzi da PDF italiani. Estrai TUTTI gli articoli con prezzo. Ometti le righe senza prezzo. Non inventare nulla. Usa SEMPRE il tool 'extract_price_list'.",
      tools: [
        {
          name: "extract_price_list",
          description: "Restituisce gli articoli del listino estratti dal PDF.",
          input_schema: ITEMS_SCHEMA as unknown as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: "extract_price_list" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data },
            },
            {
              type: "text",
              text: "Estrai il listino prezzi completo da questo PDF.",
            },
          ],
        },
      ],
    });
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      if (err.status === 413) {
        throw new Error("PDF troppo grande per l'elaborazione. Riduci il file o usa un Google Sheet.");
      }
      if (err.status === 400 && /page|prompt is too long|too many/i.test(err.message)) {
        throw new Error(
          "PDF troppo lungo o complesso (limite ~100 pagine). Per listini molto grandi usa un Google Sheet.",
        );
      }
    }
    throw err;
  }

  // ATTENZIONE: controllare il troncamento PRIMA di leggere l'input del tool —
  // con stop_reason=max_tokens l'oggetto può essere parziale/corrotto.
  if (response.stop_reason === "max_tokens") {
    throw new Error(
      "Listino PDF troppo lungo per essere estratto per intero. Per listini così grandi usa un Google Sheet.",
    );
  }

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Impossibile estrarre articoli dal PDF.");
  }

  const raw = (toolUse.input as { items?: unknown[] }).items ?? [];
  const items: PriceListItem[] = [];
  for (const r of raw) {
    if (items.length >= MAX_ITEMS) break;
    const it = r as Partial<PriceListItem>;
    if (typeof it.description !== "string" || !it.description.trim()) continue;
    if (typeof it.unit_price !== "number" || !Number.isFinite(it.unit_price) || it.unit_price < 0) continue;
    items.push({
      code: typeof it.code === "string" && it.code.trim() ? it.code.trim() : null,
      description: it.description.trim().slice(0, 300),
      unit: typeof it.unit === "string" && it.unit.trim() ? it.unit.trim().slice(0, 20) : null,
      unit_price: it.unit_price,
    });
  }
  return items;
}
