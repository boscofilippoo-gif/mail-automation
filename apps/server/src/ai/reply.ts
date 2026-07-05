import Anthropic from "@anthropic-ai/sdk";

import { env } from "../env.js";
import type { DocType } from "../types.js";

const client = new Anthropic({ apiKey: env.anthropic.apiKey });

const REPLY_SCHEMA = {
  type: "object",
  properties: {
    body: {
      type: "string",
      description:
        "Il corpo della risposta email in italiano, testo semplice. SENZA firma finale e SENZA preamboli tipo 'Ecco la bozza'.",
    },
  },
  required: ["body"],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `Scrivi il corpo di una risposta email commerciale italiana per conto di un'azienda che invia al cliente il documento richiesto (in allegato).
Regole:
- Usa SEMPRE il tool 'write_reply'.
- Registro cortese e professionale, diretto, niente frasi gonfie.
- Cita il documento allegato (tipo e numero se presente).
- MAI inventare prezzi, sconti, tempi di consegna o impegni non forniti.
- Se alcuni articoli sono senza prezzo, di' che sono in verifica e seguirà conferma.
- Chiudi invitando a rispondere per qualsiasi chiarimento. NIENTE firma: viene aggiunta dopo.
- Lunghezza: 4-8 righe.`;

export interface ReplyInput {
  customerName: string;
  docType: DocType;
  docNumber: string | null;
  total: number | null;
  currency: string;
  itemCount: number;
  missingPriceCount: number;
  originalSnippet: string;
}

/**
 * Genera il corpo della bozza di risposta (senza firma: la appende il chiamante,
 * così il modello non può storpiarla).
 */
export async function generateReplyBody(input: ReplyInput): Promise<string> {
  const response = await client.messages.create({
    model: env.anthropic.replyModel,
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    tools: [
      {
        name: "write_reply",
        description: "Restituisce il corpo della risposta email.",
        input_schema: REPLY_SCHEMA as unknown as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: "tool", name: "write_reply" },
    messages: [
      {
        role: "user",
        content: `Dati del documento allegato:
- Cliente: ${input.customerName || "non indicato"}
- Tipo: ${input.docType}${input.docNumber ? ` n. ${input.docNumber}` : ""}
- Totale: ${input.total !== null ? `${input.total} ${input.currency}` : "in definizione"}
- Righe: ${input.itemCount}${input.missingPriceCount > 0 ? ` (di cui ${input.missingPriceCount} con prezzo in verifica)` : ""}

Richiesta originale del cliente (estratto):
"""
${input.originalSnippet.slice(0, 500)}
"""`,
      },
    ],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Generazione della risposta non riuscita.");
  }
  const body = String((toolUse.input as { body?: unknown }).body ?? "").trim();
  if (!body) throw new Error("Risposta vuota dal generatore.");
  return body;
}
