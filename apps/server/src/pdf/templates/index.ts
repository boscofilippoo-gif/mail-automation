import type { ExtractedDocument, TemplateSettings } from "../../types.js";
import { renderClassic } from "./classic.js";
import { renderMinimal } from "./minimal.js";
import { renderBold } from "./bold.js";

export interface PdfTemplate {
  id: string;
  name: string;
  description: string;
  render(doc: ExtractedDocument, settings: TemplateSettings): string;
}

/** Registry dei template disponibili. Il primo è il default. */
export const TEMPLATES: PdfTemplate[] = [
  {
    id: "classic",
    name: "Classico",
    description: "Intestazione pulita, righe ordinate, blocco totali incorniciato.",
    render: renderClassic,
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "Arioso ed essenziale: filetti sottili e maiuscoletto.",
    render: renderMinimal,
  },
  {
    id: "bold",
    name: "Bold",
    description: "Banda scura in testata, tipo documento oversize, righe zebrate.",
    render: renderBold,
  },
];

/** Ritorna il template richiesto, con fallback sul classic. */
export function getTemplate(id: string | null | undefined): PdfTemplate {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0]!;
}
