import { useEffect, useState } from "react";
import { Plus, Send, Sparkles, Trash2 } from "lucide-react";

import { api, type DocType, type Keyword } from "@/api";
import { cn } from "@/lib/utils";

const DOC_TYPES: DocType[] = ["preventivo", "fattura", "ordine"];

/** Interruttore on/off in stile brand (azzurro quando attivo). */
function ToggleSwitch({ checked, onToggle }: { checked: boolean | null; onToggle: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked ?? false}
      onClick={onToggle}
      disabled={checked === null}
      className={cn(
        "relative h-7 w-12 shrink-0 rounded-full border transition-colors disabled:opacity-50",
        checked ? "border-transparent" : "border-border bg-transparent",
      )}
      style={checked ? { background: "var(--azzurro)" } : undefined}
    >
      <span
        className={cn(
          "absolute top-0.5 size-[22px] rounded-full bg-foreground transition-transform",
          checked ? "translate-x-[22px]" : "translate-x-0.5",
        )}
        style={checked ? { background: "var(--nero)" } : undefined}
      />
    </button>
  );
}

export function Keywords() {
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [term, setTerm] = useState("");
  const [docType, setDocType] = useState<DocType>("preventivo");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [smartScan, setSmartScan] = useState<boolean | null>(null);
  const [autoDraft, setAutoDraft] = useState<boolean | null>(null);

  function reload() {
    api.listKeywords().then(setKeywords).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }
  useEffect(reload, []);
  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        setSmartScan(Boolean(s.smart_scan));
        setAutoDraft(Boolean(s.auto_draft));
      })
      .catch(() => {
        setSmartScan(false);
        setAutoDraft(false);
      });
  }, []);

  /** Toggle ottimistico con rollback su errore. */
  async function toggleSetting(
    current: boolean | null,
    set: (v: boolean) => void,
    field: "smart_scan" | "auto_draft",
  ) {
    if (current === null) return;
    const next = !current;
    set(next);
    try {
      await api.saveSettings({ [field]: next ? 1 : 0 });
    } catch (e) {
      set(!next);
      setError(e instanceof Error ? e.message : "Errore nel salvataggio");
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const t = term.trim();
    if (!t) return;
    try {
      await api.addKeyword(t, docType);
      setTerm("");
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore");
    }
  }

  async function toggle(k: Keyword) {
    await api.toggleKeyword(k.id, k.active === 0).catch(() => {});
    reload();
  }

  async function remove(id: number) {
    await api.deleteKeyword(id).catch(() => {});
    reload();
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Rilevamento mail</h1>

      {/* ── Smart scan AI ── */}
      <div className="mt-8 flex items-start justify-between gap-6 rounded-2xl border border-border bg-card p-6">
        <div className="flex items-start gap-4">
          <Sparkles className="mt-1 size-5 shrink-0" style={{ color: "var(--rosa)" }} />
          <div>
            <h2 className="font-semibold">Rilevamento automatico con AI</h2>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
              L'AI analizza le mail recenti e riconosce da sola preventivi, ordini e fatture —
              senza bisogno di parole chiave. Ogni mail viene analizzata una sola volta.
            </p>
          </div>
        </div>
        <ToggleSwitch
          checked={smartScan}
          onToggle={() => toggleSetting(smartScan, setSmartScan, "smart_scan")}
        />
      </div>

      {/* ── Bozza automatica ── */}
      <div className="mt-4 flex items-start justify-between gap-6 rounded-2xl border border-border bg-card p-6">
        <div className="flex items-start gap-4">
          <Send className="mt-1 size-5 shrink-0" style={{ color: "var(--azzurro)" }} />
          <div>
            <h2 className="font-semibold">Bozza di risposta automatica</h2>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
              Per ogni documento generato, prepara subito una bozza di risposta in Gmail col PDF
              allegato. L'invio resta sempre a te. (La firma si imposta nelle Impostazioni.)
            </p>
          </div>
        </div>
        <ToggleSwitch
          checked={autoDraft}
          onToggle={() => toggleSetting(autoDraft, setAutoDraft, "auto_draft")}
        />
      </div>

      <h2 className="mt-12 text-lg font-semibold tracking-tight">
        {smartScan ? "Filtri aggiuntivi per parola chiave" : "Parole chiave"}
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        {smartScan
          ? "In aggiunta al rilevamento automatico, puoi cercare parole specifiche nell'oggetto delle mail."
          : "Aggiungi le parole da cercare nell'oggetto delle mail. Quando una mail recente le contiene, il sistema genera il documento del tipo scelto."}
      </p>

      <form onSubmit={add} className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="es. preventivo"
          className="flex-1 rounded-xl border border-border bg-card px-4 py-2.5 text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-accent"
        />
        <select
          value={docType}
          onChange={(e) => setDocType(e.target.value as DocType)}
          className="rounded-xl border border-border bg-card px-4 py-2.5 capitalize text-foreground outline-none focus:border-accent"
        >
          {DOC_TYPES.map((t) => (
            <option key={t} value={t} className="bg-background capitalize">
              {t}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="inline-flex items-center justify-center gap-1.5 rounded-xl px-5 py-2.5 font-medium"
          style={{ background: "var(--azzurro)", color: "var(--nero)" }}
        >
          <Plus className="size-4" />
          Aggiungi
        </button>
      </form>
      {error && <p className="mt-3 text-sm" style={{ color: "var(--rosa)" }}>{error}</p>}

      <div className="mt-8 space-y-2">
        {loading ? (
          <p className="text-muted-foreground">Caricamento…</p>
        ) : keywords.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">
            Nessuna parola chiave. Aggiungine una qui sopra per iniziare.
          </p>
        ) : (
          keywords.map((k) => (
            <div
              key={k.id}
              className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <span className="font-medium">{k.term}</span>
                <span
                  className="rounded-full px-2.5 py-0.5 text-xs capitalize"
                  style={{
                    background: k.doc_type === "fattura" ? "color-mix(in oklab, var(--azzurro) 22%, transparent)" : "color-mix(in oklab, var(--rosa) 22%, transparent)",
                  }}
                >
                  {k.doc_type}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => toggle(k)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs transition-colors",
                    k.active ? "text-foreground" : "text-muted-foreground",
                  )}
                  style={k.active ? { background: "color-mix(in oklab, var(--azzurro) 18%, transparent)" } : undefined}
                >
                  {k.active ? "Attiva" : "Disattiva"}
                </button>
                <button
                  onClick={() => remove(k.id)}
                  className="rounded-full p-1.5 text-muted-foreground transition-colors hover:text-foreground"
                  aria-label="Elimina"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
