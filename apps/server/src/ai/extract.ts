import Anthropic from "@anthropic-ai/sdk";

import { env } from "../env.js";
import type { DocType, ExtractedDocument, PriceListItem } from "../types.js";

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
          unit_price: {
            type: ["number", "null"],
            description: "Prezzo unitario. Se c'è un listino, SOLO dal listino per gli articoli abbinati; null se il prezzo non è noto. MAI inventato.",
          },
          total: { type: ["number", "null"], description: "quantity × unit_price; null se unit_price è null." },
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

const LISTINO_RULES = `

REGOLE LISTINO (è fornito il listino prezzi dell'azienda):
- Abbina ogni articolo richiesto nella mail alla voce di listino più pertinente (match flessibile in italiano: sinonimi, abbreviazioni, singolare/plurale, codici articolo).
- Per gli articoli abbinati usa ESCLUSIVAMENTE il prezzo del listino come unit_price.
- Se un articolo richiesto NON è nel listino: unit_price = null e total = null, e segnalalo nelle notes (es. "Articolo X non presente a listino: prezzo da confermare").
- MAI inventare o stimare prezzi. Se la mail indica prezzi diversi dal listino, usa comunque il listino e segnala la differenza nelle notes.
- subtotal = somma dei total non-null; se qualche riga è senza prezzo, indicalo nelle notes.`;

/** Quante voci di listino al massimo entrano nel prompt. */
const LISTINO_PROMPT_CAP = 150;

/**
 * Prefiltro gratuito lato codice per listini grandi: ordina le voci per
 * sovrapposizione di parole con il testo della mail e tiene le prime N.
 */
function prefilterListino(items: PriceListItem[], emailText: string): PriceListItem[] {
  if (items.length <= LISTINO_PROMPT_CAP) return items;
  const emailWords = new Set(
    emailText
      .toLowerCase()
      .split(/[^a-zà-ù0-9]+/)
      .filter((w) => w.length > 2),
  );
  const scored = items.map((item) => {
    const words = `${item.code ?? ""} ${item.description}`
      .toLowerCase()
      .split(/[^a-zà-ù0-9]+/)
      .filter((w) => w.length > 2);
    let score = 0;
    for (const w of words) if (emailWords.has(w)) score++;
    return { item, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, LISTINO_PROMPT_CAP).map((s) => s.item);
}

/** Blocco compatto del listino per il prompt: una riga per articolo. */
function listinoBlock(items: PriceListItem[]): string {
  const lines = items.map(
    (i) => `${i.code ?? "-"} | ${i.description} | ${i.unit ?? "-"} | ${i.unit_price}`,
  );
  return `\n\nLISTINO PREZZI (CODICE | DESCRIZIONE | UNITÀ | PREZZO):\n${lines.join("\n")}`;
}

/**
 * Estrae i dati strutturati dal testo di una mail usando Claude.
 * `expectedType` è il tipo associato alla keyword/classificazione.
 * `listino`, se presente, guida i prezzi: mai inventati, solo dal listino.
 */
export async function extractDocument(
  bodyText: string,
  expectedType: DocType,
  listino?: PriceListItem[],
): Promise<ExtractedDocument> {
  const hasListino = Boolean(listino && listino.length > 0);
  const listinoText = hasListino ? listinoBlock(prefilterListino(listino!, bodyText)) : "";

  const response = await client.messages.create({
    model: env.anthropic.model,
    max_tokens: 4096,
    system: hasListino ? SYSTEM_PROMPT + LISTINO_RULES : SYSTEM_PROMPT,
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
        content: `Tipo di documento atteso: ${expectedType}.\n\nTesto dell'email:\n"""\n${bodyText}\n"""${listinoText}`,
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
