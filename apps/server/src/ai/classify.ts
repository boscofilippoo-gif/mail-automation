import Anthropic from "@anthropic-ai/sdk";

import { env } from "../env.js";
import { DOC_TYPES, type DocType } from "../types.js";

const client = new Anthropic({ apiKey: env.anthropic.apiKey });

export interface ClassificationResult {
  relevant: boolean;
  doc_type: DocType | null;
  confidence: number; // 0..1
}

/** Sotto questa confidenza la mail viene ignorata anche se marcata rilevante. */
export const CONFIDENCE_THRESHOLD = 0.6;

const CLASSIFY_SCHEMA = {
  type: "object",
  properties: {
    relevant: {
      type: "boolean",
      description:
        "true SOLO se l'email è una comunicazione commerciale da cui generare un documento (richiesta di preventivo, ordine, dati per una fattura): contiene o richiede prodotti/servizi, quantità, prezzi o condizioni.",
    },
    doc_type: {
      type: ["string", "null"],
      enum: ["fattura", "preventivo", "ordine", null],
      description: "Tipo di documento più adatto; null se non rilevante.",
    },
    confidence: {
      type: "number",
      description: "Confidenza della classificazione, da 0 a 1.",
    },
  },
  required: ["relevant", "doc_type", "confidence"],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `Sei un filtro per email aziendali italiane. Decidi se un'email è una comunicazione commerciale da cui generare un documento (preventivo, ordine, fattura).
NON sono rilevanti: newsletter, notifiche automatiche di servizi, marketing, spam, conversazioni personali, conferme di registrazione, fatture GIÀ emesse da fornitori terzi verso l'utente.
Sono rilevanti: un cliente che chiede un preventivo, un ordine con prodotti e quantità, una richiesta di fatturazione con dati concreti.
Usa SEMPRE il tool 'classify_email'. Nel dubbio, marca come non rilevante con confidenza bassa.`;

/**
 * Classifica una mail (smart scan) con il modello economico.
 * Legge solo oggetto + primi 1500 caratteri del corpo: pochi token, costo minimo.
 */
export async function classifyEmail(mail: {
  subject: string;
  from: string;
  bodyText: string;
}): Promise<ClassificationResult> {
  const response = await client.messages.create({
    model: env.anthropic.classifyModel,
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    tools: [
      {
        name: "classify_email",
        description: "Restituisce la classificazione dell'email.",
        input_schema: CLASSIFY_SCHEMA as unknown as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: "tool", name: "classify_email" },
    messages: [
      {
        role: "user",
        content: `Da: ${mail.from}\nOggetto: ${mail.subject}\n\nCorpo (primi 1500 caratteri):\n"""\n${mail.bodyText.slice(0, 1500)}\n"""`,
      },
    ],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Classificazione non riuscita: nessun output strutturato.");
  }

  const raw = toolUse.input as { relevant?: boolean; doc_type?: string | null; confidence?: number };
  const docType = DOC_TYPES.includes(raw.doc_type as DocType) ? (raw.doc_type as DocType) : null;
  const confidence = Math.min(Math.max(Number(raw.confidence ?? 0), 0), 1);
  return {
    relevant: Boolean(raw.relevant) && docType !== null,
    doc_type: docType,
    confidence,
  };
}
