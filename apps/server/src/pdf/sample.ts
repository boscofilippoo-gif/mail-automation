import type { ExtractedDocument } from "../types.js";

/**
 * Documento d'esempio usato SOLO dall'anteprima live delle impostazioni:
 * realistico e completo, così l'anteprima esercita ogni regione del template.
 * Non tocca mai dati reali dell'utente.
 */
export const SAMPLE_DOCUMENT: ExtractedDocument = {
  doc_type: "preventivo",
  customer_name: "Rossi S.r.l.",
  customer_email: "amministrazione@rossisrl.it",
  customer_vat: "IT01234567890",
  customer_address: "Via Roma 42, 20121 Milano (MI)",
  document_number: "2026-014",
  document_date: "2026-07-02",
  currency: "EUR",
  line_items: [
    { description: "Sedia ergonomica modello Aria", quantity: 10, unit_price: 89, total: 890 },
    { description: "Scrivania regolabile 160×80 cm", quantity: 4, unit_price: 320, total: 1280 },
    { description: "Montaggio e consegna al piano", quantity: 1, unit_price: 150, total: 150 },
  ],
  subtotal: 2320,
  tax: 510.4,
  total: 2830.4,
  notes: "Consegna prevista entro 15 giorni lavorativi dalla conferma. Preventivo valido 30 giorni.",
};
