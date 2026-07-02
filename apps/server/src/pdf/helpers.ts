import type { DocType } from "../types.js";

// Palette brand BORU, riusata per coerenza visiva con l'ecosistema.
export const NERO = "#1a1613";
export const PORCELLANA = "#fcfaf6";
export const AZZURRO = "#b1ddf1";
export const ROSA = "#ef95b4";

export const DOC_LABEL: Record<DocType, string> = {
  fattura: "Fattura",
  preventivo: "Preventivo",
  ordine: "Ordine",
};

export function esc(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function money(n: number | null, currency: string): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: currency || "EUR" }).format(n);
}

/**
 * Colore accento sicuro per l'interpolazione in CSS: accetta solo hex #rrggbb.
 * Qualsiasi altro valore (incluso un tentativo di CSS injection) cade sul fallback.
 */
export function safeColor(input: string | null | undefined, fallback: string): string {
  if (input && /^#[0-9a-f]{6}$/i.test(input)) return input;
  return fallback;
}

/** Accento di default per tipo documento (comportamento storico del template). */
export function defaultAccent(docType: DocType): string {
  return docType === "fattura" ? AZZURRO : ROSA;
}
