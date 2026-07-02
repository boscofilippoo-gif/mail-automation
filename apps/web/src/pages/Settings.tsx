import { useEffect, useRef, useState } from "react";
import { Check, ImagePlus, Loader2, Trash2 } from "lucide-react";

import { api, type UserSettings } from "@/api";
import { cn } from "@/lib/utils";

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
          <TemplateGallery value={draft.template_id} accent={draft.accent_color} onChange={(id) => patch({ template_id: id })} />
          <AccentPicker value={draft.accent_color} onChange={(c) => patch({ accent_color: c })} />
          <LogoUploader value={draft.logo_data_url} onChange={(l) => patch({ logo_data_url: l })} onError={setError} />
          <CompanyForm draft={draft} onPatch={patch} />
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
  onChange,
}: {
  value: string;
  accent: string | null;
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
      </div>
    </section>
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
