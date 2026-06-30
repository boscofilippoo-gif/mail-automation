import Anthropic from "@anthropic-ai/sdk";

import { env } from "../env.js";
import type { DocType, ExtractedDocument } from "../types.js";

const client = new Anthropic({ apiKey: env.anthropic.apiKey });

/**
 * JSON Schema del documento da estrarre. Lo passiamo a Claude come `input_schema`
 * di un tool: forzando l'uso del tool, l'output è JSON conforme garantito.
 */
const DOCUMENT_SCHEMA = {
  type: "object",
  properties: {
    doc_type: { type: "string", enum: ["fattura", "preventivo", "ordine"] },
    customer_name: { type: "string", description: "Nome del cliente o dell'azienda destinataria" },
    customer_email: { type: ["string", "null"] },
    customer_vat: { type: ["string", "null"], description: "Partita IVA / codice fiscale, se presente" },
    customer_address: { type: ["string", "null"] },
    document_number: { type: ["string", "null"], description: "Numero documento, se indicato" },
    document_date: { type: ["string", "null"], description: "Data in formato ISO YYYY-MM-DD se ricavabile" },
    currency: { type: "string", description: "Codice valuta ISO, es. EUR. Default EUR se non indicato." },
    line_items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
          quantity: { type: "number" },
          unit_price: { type: "number" },
          total: { type: "number" },
        },
        required: ["description", "quantity", "unit_price", "total"],
        additionalProperties: false,
      },
    },
    subtotal: { type: ["number", "null"] },
    tax: { type: ["number", "null"], description: "Importo imposta/IVA, se ricavabile" },
    total: { type: ["number", "null"] },
    notes: { type: ["string", "null"], description: "Eventuali note o condizioni rilevanti" },
  },
  required: [
    "doc_type",
    "customer_name",
    "customer_email",
    "customer_vat",
    "customer_address",
    "document_number",
    "document_date",
    "currency",
    "line_items",
    "subtotal",
    "tax",
    "total",
    "notes",
  ],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `Sei un estrattore di dati per documenti commerciali italiani (fatture, preventivi, ordini).
Ricevi il testo grezzo di un'email e devi estrarre i campi richiesti in modo accurato.
Regole:
- Usa SEMPRE il tool 'extract_document' per rispondere.
- Se un dato non è presente nel testo, usa null (non inventare).
- Gli importi sono numeri (niente simboli di valuta nel valore numerico).
- Se la valuta non è esplicita, usa "EUR".
- Per ogni riga calcola 'total' = quantity * unit_price quando non indicato esplicitamente.
- 'doc_type' deve riflettere il tipo richiesto dal chiamante.`;

/**
 * Estrae i dati strutturati dal testo di una mail usando Claude.
 * `expectedType` è il tipo associato alla keyword che ha fatto match.
 */
export async function extractDocument(
  bodyText: string,
  expectedType: DocType,
): Promise<ExtractedDocument> {
  const response = await client.messages.create({
    model: env.anthropic.model,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    tools: [
      {
        name: "extract_document",
        description: "Restituisce i dati strutturati estratti dal testo dell'email.",
        input_schema: DOCUMENT_SCHEMA as unknown as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: "tool", name: "extract_document" },
    messages: [
      {
        role: "user",
        content: `Tipo di documento atteso: ${expectedType}.\n\nTesto dell'email:\n"""\n${bodyText}\n"""`,
      },
    ],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude non ha restituito dati strutturati.");
  }

  const data = toolUse.input as ExtractedDocument;
  // Garantiamo coerenza del tipo con la keyword che ha fatto match.
  data.doc_type = expectedType;
  return data;
}
