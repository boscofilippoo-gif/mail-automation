import { Router } from "express";

import { requireAuth } from "../auth/session.js";
import { getUserSettings, upsertUserSettings } from "../repo.js";
import { getTemplate, TEMPLATES } from "../pdf/templates/index.js";
import { SAMPLE_DOCUMENT } from "../pdf/sample.js";
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
};

/**
 * Valida e normalizza un body parziale di impostazioni.
 * Ritorna solo i campi presenti e validi; lancia con messaggio chiaro sugli invalidi.
 */
function validateSettings(body: Record<string, unknown>): Partial<UserSettings> {
  const out: Partial<UserSettings> = {};

  if ("template_id" in body) {
    const id = String(body.template_id ?? "");
    if (!TEMPLATES.some((t) => t.id === id)) {
      throw new Error(`Template sconosciuto: "${id}".`);
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

  return out;
}

/** Impostazioni correnti dell'utente (default se mai salvate). */
settingsRouter.get("/", (req, res) => {
  res.json(getUserSettings(req.userId!));
});

/** Salva (merge) le impostazioni. Body: Partial<UserSettings>. */
settingsRouter.put("/", (req, res) => {
  try {
    const patch = validateSettings(req.body as Record<string, unknown>);
    res.json(upsertUserSettings(req.userId!, patch));
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
    const patch = validateSettings(req.body as Record<string, unknown>);
    const merged: UserSettings = { ...DEFAULT_SETTINGS, ...getUserSettings(req.userId!), ...patch };
    const html = getTemplate(merged.template_id).render(SAMPLE_DOCUMENT, merged);
    res.type("html").send(html);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Anteprima non disponibile" });
  }
});
