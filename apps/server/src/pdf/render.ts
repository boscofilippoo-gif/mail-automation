import type { ExtractedDocument, TemplateSettings } from "../types.js";
import { getTemplate } from "./templates/index.js";
import { renderCustom } from "./templates/custom.js";

/**
 * Punto unico di render: sceglie tra template base e template su misura.
 * Qualsiasi problema col custom (html assente, corrotto, errore di render)
 * degrada in silenzio sul classic: un documento brutto batte un errore 500.
 */
export function renderDocument(
  doc: ExtractedDocument,
  settings: TemplateSettings,
  customHtml: string | null,
): string {
  if (settings.template_id === "custom" && customHtml) {
    try {
      return renderCustom(customHtml, doc, settings);
    } catch {
      // fallback sotto
    }
  }
  const id = settings.template_id === "custom" ? "classic" : settings.template_id;
  return getTemplate(id).render(doc, settings);
}
