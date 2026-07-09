import { Router } from "express";

import { requireAuth } from "../auth/session.js";
import {
  getCustomTemplateHtml,
  getUserSettings,
  setCustomTemplateHtml,
  upsertUserSettings,
} from "../repo.js";
import { TEMPLATES } from "../pdf/templates/index.js";
import { renderCustom, validateCustomTemplate } from "../pdf/templates/custom.js";
import { renderDocument } from "../pdf/render.js";
import { SAMPLE_DOCUMENT } from "../pdf/sample.js";
import { analyzeStyleFromPdf, generateTemplateFromPdf } from "../ai/customTemplate.js";
import { DEFAULT_SETTINGS, type UserSettings } from "../types.js";

export const settingsRouter = Router();

settingsRouter.use(requireAuth);

const HEX_RE = /^#[0-9a-f]{6}$/i;
// charset base64 attribute-safe: non può contenere " < > per costruzione
const LOGO_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const LOGO_MAX_CHARS = 700_000; // ≈ 500KB binari

const TEXT_CAPS: Record<string, number> = {
  company_name: 120,
  company_address: 300,
  company_vat: 40,
  company_email: 120,
  company_phone: 40,
  footer_note: 500,
  email_signature: 500,
};

/**
 * Valida e normalizza un body parziale di impostazioni.
 * Ritorna solo i campi presenti e validi; lancia con messaggio chiaro sugli invalidi.
 */
function validateSettings(body: Record<string, unknown>, allowCustom = false): Partial<UserSettings> {
  const out: Partial<UserSettings> = {};

  if ("template_id" in body) {
    const id = String(body.template_id ?? "");
    const known = TEMPLATES.some((t) => t.id === id) || (allowCustom && id === "custom");
    if (!known) {
      throw new Error(
        id === "custom"
          ? "Nessun template personalizzato salvato: crealo prima da un PDF di esempio."
          : `Template sconosciuto: "${id}".`,
      );
    }
    out.template_id = id;
  }

  if ("accent_color" in body) {
    const c = body.accent_color;
    if (c === null || c === "") out.accent_color = null;
    else if (typeof c === "string" && HEX_RE.test(c)) out.accent_color = c.toLowerCase();
    else throw new Error("Colore accento non valido: usa il formato #rrggbb.");
  }

  if ("logo_data_url" in body) {
    const l = body.logo_data_url;
    if (l === null || l === "") out.logo_data_url = null;
    else if (typeof l === "string" && LOGO_RE.test(l) && l.length <= LOGO_MAX_CHARS) {
      out.logo_data_url = l;
    } else {
      throw new Error("Logo non valido: PNG/JPEG/WebP in data URL, max ~500KB.");
    }
  }

  for (const [field, cap] of Object.entries(TEXT_CAPS)) {
    if (field in body) {
      const v = body[field];
      if (v === null || v === "") {
        (out as Record<string, unknown>)[field] = null;
      } else if (typeof v === "string") {
        (out as Record<string, unknown>)[field] = v.trim().slice(0, cap) || null;
      } else {
        throw new Error(`Campo "${field}" non valido.`);
      }
    }
  }

  if ("smart_scan" in body) {
    out.smart_scan = body.smart_scan ? 1 : 0;
  }
  if ("auto_draft" in body) {
    out.auto_draft = body.auto_draft ? 1 : 0;
  }

  return out;
}

/** true se l'utente ha un template su misura salvato. */
function hasCustom(userId: number): boolean {
  return getCustomTemplateHtml(userId) !== null;
}

/** Impostazioni correnti dell'utente (default se mai salvate). */
settingsRouter.get("/", (req, res) => {
  res.json({ ...getUserSettings(req.userId!), has_custom_template: hasCustom(req.userId!) });
});

/**
 * Salva (merge) le impostazioni. Body: Partial<UserSettings>.
 * NB: la risposta DEVE includere has_custom_template — il frontend fa
 * setDraft(risposta) e senza flag la card "Personalizzato" sparirebbe.
 */
settingsRouter.put("/", (req, res) => {
  try {
    const allowCustom = hasCustom(req.userId!);
    const patch = validateSettings(req.body as Record<string, unknown>, allowCustom);
    res.json({ ...upsertUserSettings(req.userId!, patch), has_custom_template: allowCustom });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Impostazioni non valide" });
  }
});

/**
 * Anteprima live: rende il documento CAMPIONE con le impostazioni passate nel
 * body (anche non salvate), merge su quelle salvate. Solo string templating —
 * niente Puppeteer, niente scritture. POST perché il logo non sta in una URL.
 */
settingsRouter.post("/preview", (req, res) => {
  try {
    const customHtml = getCustomTemplateHtml(req.userId!);
    const patch = validateSettings(req.body as Record<string, unknown>, customHtml !== null);
    const merged: UserSettings = { ...DEFAULT_SETTINGS, ...getUserSettings(req.userId!), ...patch };
    // la bozza non trasporta l'html: se sceglie 'custom' si usa quello salvato
    res.type("html").send(renderDocument(SAMPLE_DOCUMENT, merged, customHtml));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Anteprima non disponibile" });
  }
});

/* ───────────────── Template su misura da PDF di esempio ───────────────── */

const MAX_PDF_BYTES = 10 * 1024 * 1024;

/** Estrae e controlla il PDF base64 dal body; lancia con messaggio chiaro. */
function pdfFromBody(body: unknown): string {
  const data = (body as { data?: unknown }).data;
  if (typeof data !== "string" || !data) {
    throw new Error("Serve il PDF di esempio in base64 nel campo 'data'.");
  }
  const payload = data.replace(/^data:[^;]+;base64,/, "");
  if (Buffer.byteLength(payload, "base64") > MAX_PDF_BYTES) {
    throw new Error("PDF troppo grande (max 10MB): basta un esempio di 1-2 pagine.");
  }
  return data;
}

/**
 * Step A "Applica il mio stile": estrae colore, dati azienda, footer e template
 * base più simile. Non salva nulla: il frontend applica i valori alla bozza.
 */
settingsRouter.post("/analyze-pdf", async (req, res) => {
  try {
    res.json(await analyzeStyleFromPdf(pdfFromBody(req.body)));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Analisi non riuscita" });
  }
});

/**
 * Step B "Ricrea il mio layout": genera il template su misura e lo rende in
 * anteprima col documento campione. NON salva: l'utente deve approvare.
 */
settingsRouter.post("/generate-template", async (req, res) => {
  try {
    const data = pdfFromBody(req.body);
    const body = req.body as { instructions?: unknown; settings?: unknown };
    const instructions = typeof body.instructions === "string" ? body.instructions : undefined;

    const html = await generateTemplateFromPdf(data, instructions);
    const errors = validateCustomTemplate(html);
    if (errors.length > 0) {
      res.status(422).json({
        error: `Il template generato non ha passato i controlli: ${errors.join(" ")} Riprova (spesso al secondo tentativo riesce).`,
      });
      return;
    }
    // l'anteprima usa la BOZZA del frontend (colore/dati appena applicati con lo
    // Step A, magari non ancora salvati), merge sulle impostazioni salvate
    let patch: Partial<UserSettings> = {};
    if (body.settings && typeof body.settings === "object") {
      try {
        patch = validateSettings(body.settings as Record<string, unknown>, true);
      } catch {
        patch = {}; // bozza invalida → anteprima con le impostazioni salvate
      }
    }
    delete patch.template_id; // qui si renderizza SEMPRE il template generato
    const settings: UserSettings = { ...DEFAULT_SETTINGS, ...getUserSettings(req.userId!), ...patch };
    // test-render col campione: se esplode qui, meglio ora che sui documenti veri
    const preview = renderCustom(html, SAMPLE_DOCUMENT, settings);
    res.json({ html, preview });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Generazione non riuscita" });
  }
});

/** Approvazione: salva il template generato e lo attiva (template_id='custom'). */
settingsRouter.post("/custom-template", (req, res) => {
  try {
    const html = (req.body as { html?: unknown }).html;
    if (typeof html !== "string" || !html.trim()) {
      throw new Error("Template mancante.");
    }
    // rivalidazione completa: il client non è una fonte fidata
    const errors = validateCustomTemplate(html);
    if (errors.length > 0) {
      throw new Error(`Template non valido: ${errors.join(" ")}`);
    }
    renderCustom(html, SAMPLE_DOCUMENT, getUserSettings(req.userId!)); // test-render
    setCustomTemplateHtml(req.userId!, html);
    res.json({ ...getUserSettings(req.userId!), has_custom_template: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Salvataggio non riuscito" });
  }
});

/** Rimozione del template su misura (torna al classic se era attivo). */
settingsRouter.delete("/custom-template", (req, res) => {
  setCustomTemplateHtml(req.userId!, null);
  res.json({ ...getUserSettings(req.userId!), has_custom_template: false });
});
