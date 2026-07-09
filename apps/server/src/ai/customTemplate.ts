import Anthropic from "@anthropic-ai/sdk";

import { env } from "../env.js";

const client = new Anthropic({ apiKey: env.anthropic.apiKey });

/** Mappa gli errori API sui messaggi utente (stesso pattern di listino/pdf.ts). */
function mapApiError(err: unknown): never {
  if (err instanceof Anthropic.APIError) {
    if (err.status === 413) {
      throw new Error("PDF troppo grande per l'elaborazione. Usa un esempio più leggero (1-2 pagine).");
    }
    if (err.status === 400 && /page|prompt is too long|too many/i.test(err.message)) {
      throw new Error("PDF troppo lungo o complesso: basta un esempio di 1-2 pagine.");
    }
  }
  throw err;
}

function stripDataUrl(base64: string): string {
  return base64.replace(/^data:application\/pdf;base64,/, "");
}

/* ───────────────────── Step A: analisi dello stile ───────────────────── */

export interface StyleProposal {
  accent_color: string | null;
  company_name: string | null;
  company_address: string | null;
  company_vat: string | null;
  company_email: string | null;
  company_phone: string | null;
  footer_note: string | null;
  template_id: "classic" | "minimal" | "bold";
}

const STYLE_SCHEMA = {
  type: "object",
  properties: {
    accent_color: {
      type: ["string", "null"],
      description: "Colore dominante/accento del documento in hex #rrggbb, null se il documento è in bianco e nero.",
    },
    company_name: { type: ["string", "null"], description: "Ragione sociale dell'EMITTENTE del documento." },
    company_address: { type: ["string", "null"], description: "Indirizzo completo dell'emittente." },
    company_vat: { type: ["string", "null"], description: "P.IVA dell'emittente (con prefisso IT se presente)." },
    company_email: { type: ["string", "null"], description: "Email dell'emittente." },
    company_phone: { type: ["string", "null"], description: "Telefono dell'emittente." },
    footer_note: {
      type: ["string", "null"],
      description: "Nota fissa a piè di pagina (condizioni, coordinate bancarie, validità offerta…), null se assente.",
    },
    template_id: {
      type: "string",
      enum: ["classic", "minimal", "bold"],
      description:
        "Il template base più simile: classic (intestazione tradizionale, tabella bordata), minimal (arioso, filetti sottili, molto bianco), bold (banda scura o colori forti in testata).",
    },
  },
  required: [
    "accent_color",
    "company_name",
    "company_address",
    "company_vat",
    "company_email",
    "company_phone",
    "footer_note",
    "template_id",
  ],
  additionalProperties: false,
} as const;

const HEX_RE = /^#[0-9a-f]{6}$/i;
const TEXT_FIELDS = [
  "company_name",
  "company_address",
  "company_vat",
  "company_email",
  "company_phone",
  "footer_note",
] as const;

/**
 * Step A "Applica il mio stile": legge il PDF di esempio e propone i valori
 * per le impostazioni ESISTENTI (nulla di generato, solo estrazione).
 */
export async function analyzeStyleFromPdf(base64: string): Promise<StyleProposal> {
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: env.anthropic.listinoModel,
      max_tokens: 2000,
      system:
        "Analizzi documenti commerciali italiani (preventivi, fatture, conferme d'ordine) in PDF. " +
        "Estrai lo stile e i dati dell'azienda EMITTENTE (non del destinatario). Non inventare nulla: " +
        "se un dato non c'è, usa null. Usa SEMPRE il tool 'propose_style'.",
      tools: [
        {
          name: "propose_style",
          description: "Restituisce stile e dati aziendali estratti dal documento di esempio.",
          input_schema: STYLE_SCHEMA as unknown as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: "propose_style" },
      messages: [
        {
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: stripDataUrl(base64) } },
            { type: "text", text: "Analizza questo documento di esempio ed estrai stile e dati dell'emittente." },
          ],
        },
      ],
    });
  } catch (err) {
    mapApiError(err);
  }

  if (response.stop_reason === "max_tokens") {
    throw new Error("Analisi del PDF incompleta: riprova con un esempio più semplice.");
  }
  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Impossibile analizzare il PDF di esempio.");
  }

  // validazione difensiva campo per campo: mai fidarsi della forma del tool input
  const raw = toolUse.input as Record<string, unknown>;
  const out: StyleProposal = {
    accent_color:
      typeof raw.accent_color === "string" && HEX_RE.test(raw.accent_color)
        ? raw.accent_color.toLowerCase()
        : null,
    company_name: null,
    company_address: null,
    company_vat: null,
    company_email: null,
    company_phone: null,
    footer_note: null,
    template_id:
      raw.template_id === "minimal" || raw.template_id === "bold" ? raw.template_id : "classic",
  };
  for (const f of TEXT_FIELDS) {
    const v = raw[f];
    out[f] = typeof v === "string" && v.trim() ? v.trim().slice(0, 500) : null;
  }
  return out;
}

/* ───────────────────── Step B: generazione del template ───────────────────── */

const TEMPLATE_SCHEMA = {
  type: "object",
  properties: {
    html: { type: "string", description: "Il template HTML completo, con i soli token ammessi." },
  },
  required: ["html"],
  additionalProperties: false,
} as const;

const TEMPLATE_SYSTEM = `Sei un designer di template per documenti commerciali italiani (preventivi, fatture, ordini). Ricevi il PDF di un documento reale e devi ricrearne il LAYOUT come template HTML riutilizzabile.

REGOLE ASSOLUTE:
- Documento HTML completo: <!doctype html><html><head><meta charset="utf-8"><style>…</style></head><body>…</body></html>
- UN SOLO blocco <style> nel <head>. CSS compatto. NIENTE JavaScript, NIENTE risorse esterne (no font esterni, no immagini http). Font di sistema (es. Helvetica, Arial, Georgia).
- Formato A4 verticale. Il padding della pagina va nel CSS del body (la stampa avviene con margini 0): body { padding: 15mm 14mm; } o simile.
- Template sotto i 40KB.

DATI DINAMICI — usa ESATTAMENTE questi token (verranno sostituiti coi dati veri):
{{doc_type_label}} = tipo documento ("Preventivo", "Fattura", "Ordine")
{{document_number}} {{document_date}} = numero e data
{{customer_name}} {{customer_address}} {{customer_vat}} {{customer_email}} = destinatario
{{company_name}} {{company_address}} {{company_vat}} {{company_email}} {{company_phone}} = emittente
{{logo}} = logo dell'emittente (già un <img> pronto; può essere vuoto)
{{accent_color}} = colore accento (usalo nel CSS come var: :root { --accent: {{accent_color}}; })
{{subtotal}} {{tax}} {{total}} = importi già formattati (es. "1.234,00 €")
{{notes}} = note del documento
{{footer_note}} = nota fissa a piè di pagina

TABELLA ARTICOLI — la riga-modello va racchiusa ESATTAMENTE così, UNA SOLA volta:
<!--ROW_START--><tr><td>{{description}}</td><td>{{quantity}}</td><td>{{unit_price}}</td><td>{{line_total}}</td></tr><!--ROW_END-->
(adatta le celle alle colonne del documento di esempio: se ha colonne diverse — codice, sconto… — usa solo i 4 token disponibili e ometti il resto; {{unit_price}} e {{line_total}} arrivano già formattati, "—" se mancanti)

NON inserire dati reali del PDF di esempio (nomi cliente, importi, date, righe articolo): al loro posto vanno i token. I dati FISSI dell'emittente (intestazione aziendale) vanno resi coi token company_*. Ricrea fedelmente: disposizione, colori, pesi tipografici, bordi, allineamenti.

Usa SEMPRE il tool 'emit_template'.`;

/**
 * Step B "Ricrea il mio layout": genera il template HTML su misura dal PDF.
 * L'output va SEMPRE validato con validateCustomTemplate prima dell'uso.
 */
export async function generateTemplateFromPdf(base64: string, instructions?: string): Promise<string> {
  const userText = instructions?.trim()
    ? `Ricrea il layout di questo documento come template. Indicazioni aggiuntive dell'utente: ${instructions.trim().slice(0, 500)}`
    : "Ricrea il layout di questo documento come template.";

  let response: Anthropic.Message;
  try {
    // streaming obbligatorio: con max_tokens alto l'SDK rifiuta le chiamate
    // non-streaming ("Streaming is required for operations that may take longer…")
    response = await client.messages.stream({
      model: env.anthropic.model,
      // l'HTML in JSON-escape pesa: 24k copre ~40KB di template con margine
      max_tokens: 24000,
      system: TEMPLATE_SYSTEM,
      tools: [
        {
          name: "emit_template",
          description: "Restituisce il template HTML generato.",
          input_schema: TEMPLATE_SCHEMA as unknown as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: "emit_template" },
      messages: [
        {
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: stripDataUrl(base64) } },
            { type: "text", text: userText },
          ],
        },
      ],
    }).finalMessage();
  } catch (err) {
    mapApiError(err);
  }

  if (response.stop_reason === "max_tokens") {
    throw new Error('Layout troppo complesso: riprova aggiungendo l\'istruzione "template più semplice".');
  }
  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Impossibile generare il template dal PDF.");
  }
  const html = (toolUse.input as { html?: unknown }).html;
  if (typeof html !== "string" || !html.trim()) {
    throw new Error("Il template generato è vuoto: riprova.");
  }
  return html;
}
