import { useEffect, useRef, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { Check, FileSpreadsheet, FileUp, ImagePlus, Loader2, Sparkles, Trash2, Wand2 } from "lucide-react";

import {
  api,
  type BreweryRow,
  type BreweryTemplateSummary,
  type Me,
  type StyleProposal,
  type UserSettings,
} from "@/api";
import { cn } from "@/lib/utils";

/** Stato del collegamento posta: modalità attiva, alias, cambio. */
function MailboxSection() {
  const { me } = useOutletContext<{ me: Me | null }>();
  const [address, setAddress] = useState<string | null>(null);

  useEffect(() => {
    if (me?.mailMode === "inoltro") {
      api.getInboundAddress().then((a) => setAddress(a.address)).catch(() => {});
    }
  }, [me?.mailMode]);

  return (
    <section>
      <h2 className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">Casella collegata</h2>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-5 text-sm">
        <div>
          {me?.mailMode === "gmail" && (
            <p><strong>Gmail (accesso diretto)</strong> — {me.email}</p>
          )}
          {me?.mailMode === "inoltro" && (
            <>
              <p><strong>Inoltro automatico</strong></p>
              <p className="mt-1 font-mono text-xs" style={{ color: "var(--azzurro)" }}>{address ?? "…"}</p>
            </>
          )}
          {!me?.mailMode && <p className="text-muted-foreground">Nessuna casella collegata.</p>}
        </div>
        <Link
          to="/onboarding"
          className="rounded-full border border-border px-4 py-2 text-xs transition-colors hover:border-accent"
        >
          Cambia modalità
        </Link>
      </div>
    </section>
  );
}

/* Metadati dei template (specchiano il registry lato server). */
const TEMPLATES = [
  { id: "classic", name: "Classico", description: "Intestazione pulita, righe ordinate." },
  { id: "minimal", name: "Minimal", description: "Arioso ed essenziale, filetti sottili." },
  { id: "bold", name: "Bold", description: "Banda scura in testata, presenza forte." },
];

const SWATCHES = ["#b1ddf1", "#ef95b4", "#1a1613", "#4a6b5a", "#c9a04e"];

/** Ridimensiona l'immagine (max 400px lato lungo) e la converte in data URL PNG. */
function fileToLogoDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 400;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const dataUrl = canvas.toDataURL("image/png");
      if (dataUrl.length > 700_000) {
        reject(new Error("Logo troppo pesante anche dopo il ridimensionamento. Usa un'immagine più semplice."));
      } else {
        resolve(dataUrl);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Immagine non valida."));
    };
    img.src = url;
  });
}

export function Settings() {
  const [draft, setDraft] = useState<UserSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getSettings().then(setDraft).catch((e) => setError(e.message));
  }, []);

  function patch(p: Partial<UserSettings>) {
    setSaved(false);
    setDraft((d) => (d ? { ...d, ...p } : d));
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const s = await api.saveSettings(draft);
      setDraft(s);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore nel salvataggio");
    } finally {
      setSaving(false);
    }
  }

  if (!draft) {
    return <p className="text-muted-foreground">{error ?? "Caricamento…"}</p>;
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Impostazioni documento</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Scegli il template e personalizza i tuoi documenti. L'anteprima si aggiorna mentre
            modifichi.
          </p>
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 font-medium disabled:opacity-60"
          style={{ background: "var(--azzurro)", color: "var(--nero)" }}
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : saved ? <Check className="size-4" /> : null}
          {saving ? "Salvataggio…" : saved ? "Salvato" : "Salva"}
        </button>
      </div>
      {error && <p className="mt-3 text-sm" style={{ color: "var(--rosa)" }}>{error}</p>}

      <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-[1fr_420px]">
        <div className="space-y-10">
          <MailboxSection />
          <TemplateGallery
            value={draft.template_id}
            accent={draft.accent_color}
            hasCustom={Boolean(draft.has_custom_template)}
            onChange={(id) => patch({ template_id: id })}
          />
          <CustomTemplateSection draft={draft} onPatch={patch} onError={setError} />
          <BrewerySection onError={setError} />
          <AccentPicker value={draft.accent_color} onChange={(c) => patch({ accent_color: c })} />
          <LogoUploader value={draft.logo_data_url} onChange={(l) => patch({ logo_data_url: l })} onError={setError} />
          <CompanyForm draft={draft} onPatch={patch} />

          {/* firma per le bozze di risposta Gmail */}
          <section>
            <h2 className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">Firma email</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Aggiunta in fondo alle bozze di risposta create in Gmail.
            </p>
            <textarea
              className={cn(inputCls, "mt-3")}
              rows={3}
              placeholder={"Cordiali saluti,\nMario Rossi — ACME Srl\ntel. 02 1234567"}
              value={draft.email_signature ?? ""}
              onChange={(e) => patch({ email_signature: e.target.value || null })}
            />
          </section>
        </div>

        <LivePreview draft={draft} />
      </div>
    </div>
  );
}

/* ───────────────────────── Galleria template ───────────────────────── */

function Thumb({ id, accent }: { id: string; accent: string }) {
  // mini-rappresentazioni CSS dei layout, nessuna immagine
  if (id === "bold") {
    return (
      <div className="flex h-28 w-full flex-col overflow-hidden rounded-md bg-[#fcfaf6]">
        <div className="flex h-10 flex-col justify-center gap-1 bg-[#1a1613] px-2">
          <div className="h-1 w-8 rounded-sm bg-white/40" />
          <div className="h-2 w-14 rounded-sm" style={{ background: accent }} />
        </div>
        <div className="flex-1 space-y-1.5 p-2">
          <div className="h-1.5 w-full rounded-sm bg-[#1a1613]/10" />
          <div className="h-1.5 w-full rounded-sm bg-[#1a1613]/20" />
          <div className="h-1.5 w-full rounded-sm bg-[#1a1613]/10" />
          <div className="ml-auto h-5 w-14 rounded-sm bg-[#1a1613]" />
        </div>
      </div>
    );
  }
  if (id === "minimal") {
    return (
      <div className="flex h-28 w-full flex-col overflow-hidden rounded-md bg-white p-2">
        <div className="flex items-start justify-between">
          <div className="h-2 w-10 rounded-sm bg-[#1a1613]/30" />
          <div className="h-1.5 w-8 rounded-sm" style={{ background: accent }} />
        </div>
        <div className="mt-3 space-y-2">
          <div className="h-px w-full bg-[#1a1613]/10" />
          <div className="h-1 w-3/4 rounded-sm bg-[#1a1613]/15" />
          <div className="h-px w-full bg-[#1a1613]/10" />
          <div className="h-1 w-2/3 rounded-sm bg-[#1a1613]/15" />
        </div>
        <div className="ml-auto mt-auto h-1.5 w-12 rounded-sm" style={{ background: accent }} />
      </div>
    );
  }
  // classic
  return (
    <div className="flex h-28 w-full flex-col overflow-hidden rounded-md bg-[#fcfaf6] p-2">
      <div className="flex items-center justify-between border-b-2 pb-1.5" style={{ borderColor: accent }}>
        <div className="h-2 w-10 rounded-sm bg-[#1a1613]/60" />
        <div className="h-2 w-12 rounded-sm" style={{ background: accent }} />
      </div>
      <div className="mt-2 space-y-1.5">
        <div className="h-1.5 w-full rounded-sm bg-[#1a1613]/10" />
        <div className="h-1.5 w-full rounded-sm bg-[#1a1613]/15" />
        <div className="h-1.5 w-5/6 rounded-sm bg-[#1a1613]/10" />
      </div>
      <div className="ml-auto mt-auto h-4 w-16 rounded-sm border-t-2 bg-white" style={{ borderColor: accent }} />
    </div>
  );
}

function TemplateGallery({
  value,
  accent,
  hasCustom,
  onChange,
}: {
  value: string;
  accent: string | null;
  hasCustom: boolean;
  onChange: (id: string) => void;
}) {
  const previewAccent = accent ?? "#ef95b4";
  return (
    <section>
      <h2 className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">Template</h2>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {TEMPLATES.map((t) => (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={cn(
              "rounded-2xl border p-3 text-left transition-colors",
              value === t.id ? "border-accent bg-foreground/5" : "border-border hover:border-accent/40",
            )}
          >
            <Thumb id={t.id} accent={previewAccent} />
            <p className="mt-3 text-sm font-semibold">{t.name}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t.description}</p>
          </button>
        ))}
        {hasCustom && (
          <button
            onClick={() => onChange("custom")}
            className={cn(
              "rounded-2xl border p-3 text-left transition-colors",
              value === "custom" ? "border-accent bg-foreground/5" : "border-border hover:border-accent/40",
            )}
          >
            <div className="flex h-28 w-full items-center justify-center rounded-md bg-[#fcfaf6]">
              <Sparkles className="size-8" style={{ color: previewAccent }} />
            </div>
            <p className="mt-3 text-sm font-semibold">Personalizzato</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Ricreato dal tuo PDF di esempio.
            </p>
          </button>
        )}
      </div>
    </section>
  );
}

/* ───────────────────────── Template su misura ───────────────────────── */

/** Legge un PDF come data URL base64. */
function fileToPdfDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > 10 * 1024 * 1024) {
      reject(new Error("PDF troppo grande (max 10MB): basta un esempio di 1-2 pagine."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Impossibile leggere il file."));
    reader.readAsDataURL(file);
  });
}

function CustomTemplateSection({
  draft,
  onPatch,
  onError,
}: {
  draft: UserSettings;
  onPatch: (p: Partial<UserSettings>) => void;
  onError: (e: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pdf, setPdf] = useState<{ name: string; data: string } | null>(null);
  const [busy, setBusy] = useState<"style" | "layout" | "save" | null>(null);
  const [generated, setGenerated] = useState<{ html: string; preview: string } | null>(null);
  const [instructions, setInstructions] = useState("");
  const [applied, setApplied] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    onError(null);
    setApplied(false);
    try {
      setPdf({ name: file.name, data: await fileToPdfDataUrl(file) });
      setGenerated(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Errore nel caricamento del PDF");
    }
  }

  /** Step A: estrae lo stile e lo applica alla bozza (si salva col normale Salva). */
  async function applyStyle() {
    if (!pdf) return;
    setBusy("style");
    onError(null);
    setApplied(false);
    try {
      const p: StyleProposal = await api.analyzeStylePdf(pdf.data);
      const patch: Partial<UserSettings> = { template_id: p.template_id };
      if (p.accent_color) patch.accent_color = p.accent_color;
      if (p.company_name) patch.company_name = p.company_name;
      if (p.company_address) patch.company_address = p.company_address;
      if (p.company_vat) patch.company_vat = p.company_vat;
      if (p.company_email) patch.company_email = p.company_email;
      if (p.company_phone) patch.company_phone = p.company_phone;
      if (p.footer_note) patch.footer_note = p.footer_note;
      onPatch(patch);
      setApplied(true);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Analisi non riuscita");
    } finally {
      setBusy(null);
    }
  }

  /** Step B: genera il template su misura (anteprima, poi approvazione esplicita). */
  async function generateLayout() {
    if (!pdf) return;
    setBusy("layout");
    onError(null);
    try {
      // passa anche la bozza: l'anteprima esce già con colore/dati appena applicati
      setGenerated(await api.generateTemplate(pdf.data, instructions.trim() || undefined, draft));
    } catch (err) {
      onError(err instanceof Error ? err.message : "Generazione non riuscita");
    } finally {
      setBusy(null);
    }
  }

  async function approve() {
    if (!generated) return;
    setBusy("save");
    onError(null);
    try {
      await api.saveCustomTemplate(generated.html);
      // il server ha già salvato e attivato: allinea la bozza senza perdere
      // le altre modifiche non ancora salvate
      onPatch({ template_id: "custom", has_custom_template: true });
      setGenerated(null);
      setPdf(null);
      setInstructions("");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Salvataggio non riuscito");
    } finally {
      setBusy(null);
    }
  }

  async function removeCustom() {
    setBusy("save");
    onError(null);
    try {
      await api.deleteCustomTemplate();
      onPatch({
        has_custom_template: false,
        template_id: draft.template_id === "custom" ? "classic" : draft.template_id,
      });
    } catch (err) {
      onError(err instanceof Error ? err.message : "Rimozione non riuscita");
    } finally {
      setBusy(null);
    }
  }

  const btnCls =
    "inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm transition-colors hover:border-accent disabled:opacity-50";

  return (
    <section>
      <h2 className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
        Il tuo template su misura
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Carica un tuo preventivo o una tua fattura in PDF: l'AI può copiarne lo stile nelle
        impostazioni qui sopra, oppure ricreare l'intero layout come template personale.
      </p>

      <div className="mt-4 space-y-4 rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => inputRef.current?.click()} className={btnCls} disabled={busy !== null}>
            <FileUp className="size-4" />
            {pdf ? pdf.name : "Carica PDF di esempio"}
          </button>
          <input ref={inputRef} type="file" accept="application/pdf" onChange={onFile} className="hidden" />

          {pdf && (
            <>
              <button onClick={applyStyle} className={btnCls} disabled={busy !== null}>
                {busy === "style" ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                Applica il mio stile
              </button>
              <button onClick={generateLayout} className={btnCls} disabled={busy !== null}>
                {busy === "layout" ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
                {generated ? "Rigenera il layout" : "Ricrea il mio layout"}
              </button>
            </>
          )}

          {draft.has_custom_template && (
            <button onClick={removeCustom} className={cn(btnCls, "ml-auto")} disabled={busy !== null}>
              <Trash2 className="size-4" />
              Rimuovi template personale
            </button>
          )}
        </div>

        {applied && (
          <p className="text-sm" style={{ color: "var(--azzurro)" }}>
            Stile applicato alle impostazioni: controlla l'anteprima e premi Salva per confermare.
          </p>
        )}

        {busy === "layout" && (
          <p className="text-sm text-muted-foreground">
            L'AI sta studiando il tuo documento e ricostruendo il layout: ci vuole circa un minuto…
          </p>
        )}

        {generated && (
          <div className="space-y-3">
            <div className="aspect-[210/297] w-full max-w-sm overflow-hidden rounded-xl border border-border bg-white">
              <iframe
                sandbox=""
                srcDoc={generated.preview}
                title="Anteprima template personalizzato"
                className="h-full w-full border-0"
              />
            </div>
            <input
              className={inputCls}
              placeholder="Ritocchi? Es: intestazione più compatta, totale più grande… (poi Rigenera)"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
            <div className="flex flex-wrap gap-3">
              <button
                onClick={approve}
                disabled={busy !== null}
                className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium disabled:opacity-60"
                style={{ background: "var(--azzurro)", color: "var(--nero)" }}
              >
                {busy === "save" ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                Usa questo template
              </button>
              <button onClick={() => setGenerated(null)} className={btnCls} disabled={busy !== null}>
                Scarta
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/* ───────────────────────── Modulo Excel del birrificio ───────────────────────── */

/** Legge un file come data URL base64. */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > 5 * 1024 * 1024) {
      reject(new Error("File troppo grande (max 5MB)."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Impossibile leggere il file."));
    reader.readAsDataURL(file);
  });
}

function BrewerySection({ onError }: { onError: (e: string | null) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [templates, setTemplates] = useState<BreweryTemplateSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => {
    api.getBreweryTemplates().then((r) => setTemplates(r.templates)).catch(() => setTemplates([]));
  }, []);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    onError(null);
    setBusy(true);
    try {
      const data = await fileToDataUrl(file);
      const breweryName = name.trim() || file.name.replace(/\.xlsx?$/i, "");
      const r = await api.uploadBreweryTemplate(data, breweryName);
      setTemplates(r.templates);
      setName("");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Caricamento non riuscito");
    } finally {
      setBusy(false);
    }
  }

  async function saveMapping(breweryKey: string, mapping: BreweryRow[]) {
    setBusy(true);
    onError(null);
    try {
      const r = await api.updateBreweryMapping(breweryKey, mapping);
      setTemplates(r.templates);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Salvataggio non riuscito");
    } finally {
      setBusy(false);
    }
  }

  async function remove(breweryKey: string) {
    setBusy(true);
    onError(null);
    try {
      const r = await api.deleteBreweryTemplate(breweryKey);
      setTemplates(r.templates);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Rimozione non riuscita");
    } finally {
      setBusy(false);
    }
  }

  const btnCls =
    "inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm transition-colors hover:border-accent disabled:opacity-50";

  return (
    <section>
      <h2 className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
        Moduli Excel dei birrifici
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Carica il file Excel di ogni birrificio con cui lavori. Quando arriva un ordine, il sistema
        compila le quantità sui moduli giusti (lasciando intatte formule e formato) e te li prepara
        pronti da inviare. Con più birrifici, l'ordine viene smistato tra i moduli.
      </p>

      <div className="mt-4 space-y-4">
        {templates.map((t) => (
          <div key={t.brewery_key} className="space-y-3 rounded-2xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-sm">
                <FileSpreadsheet className="size-4" style={{ color: "var(--azzurro)" }} />
                <strong>{t.name}</strong>
                <span className="text-muted-foreground">
                  · {t.mapping.length} prodotti · quantità in colonna {t.qty_column}
                </span>
              </p>
              <button onClick={() => remove(t.brewery_key)} className={btnCls} disabled={busy}>
                <Trash2 className="size-4" />
                Rimuovi
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Per ogni prodotto, controlla i nomi con cui i clienti lo ordinano: il sistema li usa
              per capire in quale modulo scrivere la quantità.
            </p>
            <MappingEditor
              mapping={t.mapping}
              busy={busy}
              onSave={(m) => saveMapping(t.brewery_key, m)}
            />
          </div>
        ))}

        {/* aggiungi un nuovo modulo */}
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-border p-5">
          <input
            className={inputCls + " max-w-xs"}
            placeholder="Nome birrificio (es. Eschenbacher)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button onClick={() => inputRef.current?.click()} className={btnCls} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}
            {templates.length === 0 ? "Carica modulo .xlsx" : "Aggiungi un altro modulo"}
          </button>
        </div>
        <input ref={inputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onFile} className="hidden" />
      </div>
    </section>
  );
}

/** Editor della mappa prodotti↔alias: una riga per prodotto del modulo. */
function MappingEditor({
  mapping,
  busy,
  onSave,
}: {
  mapping: BreweryRow[];
  busy: boolean;
  onSave: (m: BreweryRow[]) => void;
}) {
  const [rows, setRows] = useState<BreweryRow[]>(mapping);
  useEffect(() => setRows(mapping), [mapping]);
  const dirty = JSON.stringify(rows) !== JSON.stringify(mapping);

  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={r.row} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_2fr] sm:items-center">
          <span className="truncate text-sm font-medium" title={r.label}>
            {r.label}
          </span>
          <input
            className={inputCls}
            placeholder="nomi/sinonimi separati da virgola (es. lager, bionda)"
            value={r.aliases.join(", ")}
            onChange={(e) => {
              const aliases = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
              setRows((prev) => prev.map((x, j) => (j === i ? { ...x, aliases } : x)));
            }}
          />
        </div>
      ))}
      {dirty && (
        <button
          onClick={() => onSave(rows)}
          disabled={busy}
          className="mt-2 inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-medium disabled:opacity-60"
          style={{ background: "var(--azzurro)", color: "var(--nero)" }}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          Salva corrispondenze
        </button>
      )}
    </div>
  );
}

/* ───────────────────────── Colore accento ───────────────────────── */

function AccentPicker({ value, onChange }: { value: string | null; onChange: (c: string | null) => void }) {
  return (
    <section>
      <h2 className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">Colore accento</h2>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => onChange(null)}
          className={cn(
            "rounded-full border px-3.5 py-1.5 text-xs transition-colors",
            value === null ? "border-accent text-foreground" : "border-border text-muted-foreground hover:text-foreground",
          )}
        >
          Automatico
        </button>
        {SWATCHES.map((c) => (
          <button
            key={c}
            onClick={() => onChange(c)}
            aria-label={`Colore ${c}`}
            className={cn(
              "size-8 rounded-full border-2 transition-transform hover:scale-110",
              value === c ? "border-foreground" : "border-transparent",
            )}
            style={{ background: c }}
          />
        ))}
        <label className="ml-1 inline-flex cursor-pointer items-center gap-2 rounded-full border border-border px-3.5 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
          Personalizzato
          <input
            type="color"
            value={value ?? "#b1ddf1"}
            onChange={(e) => onChange(e.target.value)}
            className="size-5 cursor-pointer border-0 bg-transparent p-0"
          />
        </label>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Con "Automatico": azzurro per le fatture, rosa per preventivi e ordini.
      </p>
    </section>
  );
}

/* ───────────────────────── Logo ───────────────────────── */

function LogoUploader({
  value,
  onChange,
  onError,
}: {
  value: string | null;
  onChange: (l: string | null) => void;
  onError: (e: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    onError(null);
    try {
      onChange(await fileToLogoDataUrl(file));
    } catch (err) {
      onError(err instanceof Error ? err.message : "Errore nel caricamento del logo");
    }
  }

  return (
    <section>
      <h2 className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">Logo</h2>
      <div className="mt-4 flex items-center gap-4">
        {value ? (
          <>
            <div className="flex h-16 w-40 items-center justify-center rounded-xl border border-border bg-white p-2">
              <img src={value} alt="Logo" className="max-h-full max-w-full object-contain" />
            </div>
            <button
              onClick={() => onChange(null)}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <Trash2 className="size-3.5" />
              Rimuovi
            </button>
          </>
        ) : (
          <button
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-xl border border-dashed border-border px-5 py-4 text-sm text-muted-foreground transition-colors hover:border-accent hover:text-foreground"
          >
            <ImagePlus className="size-4" />
            Carica logo (PNG, JPEG o WebP)
          </button>
        )}
        <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={onFile} className="hidden" />
      </div>
    </section>
  );
}

/* ───────────────────────── Dati azienda ───────────────────────── */

const inputCls =
  "w-full rounded-xl border border-border bg-card px-4 py-2.5 text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-accent";

function CompanyForm({ draft, onPatch }: { draft: UserSettings; onPatch: (p: Partial<UserSettings>) => void }) {
  return (
    <section>
      <h2 className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">Dati azienda</h2>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <input className={inputCls} placeholder="Nome azienda" value={draft.company_name ?? ""} onChange={(e) => onPatch({ company_name: e.target.value || null })} />
        <input className={inputCls} placeholder="P.IVA / CF" value={draft.company_vat ?? ""} onChange={(e) => onPatch({ company_vat: e.target.value || null })} />
        <input className={cn(inputCls, "sm:col-span-2")} placeholder="Indirizzo" value={draft.company_address ?? ""} onChange={(e) => onPatch({ company_address: e.target.value || null })} />
        <input className={inputCls} placeholder="Email" value={draft.company_email ?? ""} onChange={(e) => onPatch({ company_email: e.target.value || null })} />
        <input className={inputCls} placeholder="Telefono" value={draft.company_phone ?? ""} onChange={(e) => onPatch({ company_phone: e.target.value || null })} />
        <textarea
          className={cn(inputCls, "sm:col-span-2")}
          rows={2}
          placeholder="Nota a piè di pagina (condizioni, validità, ringraziamenti…)"
          value={draft.footer_note ?? ""}
          onChange={(e) => onPatch({ footer_note: e.target.value || null })}
        />
      </div>
    </section>
  );
}

/* ───────────────────────── Anteprima live ───────────────────────── */

function LivePreview({ draft }: { draft: UserSettings }) {
  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  useEffect(() => {
    const mySeq = ++seq.current;
    setLoading(true);
    const t = setTimeout(() => {
      api
        .previewSettings(draft)
        .then((h) => {
          if (seq.current === mySeq) setHtml(h);
        })
        .catch(() => {})
        .finally(() => {
          if (seq.current === mySeq) setLoading(false);
        });
    }, 450);
    return () => clearTimeout(t);
  }, [draft]);

  return (
    <div className="lg:sticky lg:top-24 lg:self-start">
      <h2 className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
        Anteprima
        {loading && <Loader2 className="size-3 animate-spin" />}
      </h2>
      <div className="mt-4 aspect-[210/297] w-full overflow-hidden rounded-xl border border-border bg-white shadow-[0_20px_60px_-30px_rgba(0,0,0,0.6)]">
        {html ? (
          <iframe sandbox="" srcDoc={html} title="Anteprima documento" className="h-full w-full border-0" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-black/40">Anteprima in caricamento…</div>
        )}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Documento d'esempio: i tuoi PDF reali useranno i dati estratti dalle mail.
      </p>
    </div>
  );
}
