import { useEffect, useRef, useState } from "react";
import { Check, FileSpreadsheet, FileText, Link2, Loader2, Pencil, Plug, Plus, RefreshCw, Search, Settings2, Trash2, X } from "lucide-react";

import { api, connectGmail, type ApiConfigView, type ListinoResult, type ListinoState, type PriceListItem } from "@/api";
import { cn } from "@/lib/utils";
import { toast } from "@/components/Toast";

const SOURCE_LABEL: Record<string, string> = {
  sheet: "Google Sheet",
  pdf: "PDF",
  csv: "CSV",
  api: "API",
};

const AUTH_OPTIONS = [
  { value: "none", label: "Nessuna autenticazione" },
  { value: "apikey", label: "API key (header)" },
  { value: "bearer", label: "Token Bearer" },
  { value: "basic", label: "Utente e password (Basic)" },
];

/** Legge un file come base64 (senza prefisso data URL). */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.replace(/^data:[^;]+;base64,/, ""));
    };
    reader.onerror = () => reject(new Error("Impossibile leggere il file."));
    reader.readAsDataURL(file);
  });
}

export function Listino() {
  const [state, setState] = useState<ListinoState | null>(null);
  const [sheetUrl, setSheetUrl] = useState("");
  const [apiUrl, setApiUrl] = useState("");
  const [authType, setAuthType] = useState("apikey");
  const [headerName, setHeaderName] = useState("X-Api-Key");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState<string | null>(null); // 'connect' | 'sync' | 'upload' | 'delete'
  const [error, setError] = useState<string | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function reload() {
    api.getListino().then(setState).catch((e) => setError(e.message));
  }
  useEffect(reload, []);

  /** Gestisce le risposte listino che possono chiedere la riautorizzazione. */
  function handleResult(r: ListinoResult) {
    if ("error" in r) {
      if (r.needsReauth) setNeedsReauth(true);
      else setError(r.error);
      return;
    }
    setState(r);
    setSheetUrl("");
  }

  async function run(action: string, fn: () => Promise<ListinoResult>) {
    setBusy(action);
    setError(null);
    setNeedsReauth(false);
    try {
      handleResult(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore");
    } finally {
      setBusy(null);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const kind = file.name.toLowerCase().endsWith(".pdf") ? "pdf" : "csv";
    if (file.size > 10 * 1024 * 1024) {
      setError("File troppo grande (max 10MB).");
      return;
    }
    await run("upload", async () => api.uploadListino(file.name, await fileToBase64(file), kind));
  }

  async function remove() {
    setBusy("delete");
    setError(null);
    try {
      await api.deleteListino();
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore");
    } finally {
      setBusy(null);
    }
  }

  if (!state) return <p className="text-muted-foreground">{error ?? "Caricamento…"}</p>;

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Listino prezzi</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        Collega il tuo listino: quando arriva una mail con i pezzi richiesti, il documento nasce
        già con i prezzi giusti. Gli articoli non a listino restano senza prezzo, da confermare.
      </p>

      {needsReauth && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-5" style={{ borderColor: "var(--rosa)" }}>
          <p className="text-sm">
            <strong>Servono nuovi permessi Google</strong> per leggere il foglio. Riautorizza
            l'accesso (un click, torni qui subito).
          </p>
          <button
            onClick={connectGmail}
            className="rounded-full px-5 py-2 text-sm font-medium"
            style={{ background: "var(--azzurro)", color: "var(--nero)" }}
          >
            Riautorizza con Google
          </button>
        </div>
      )}
      {error && <p className="mt-4 text-sm" style={{ color: "var(--rosa)" }}>{error}</p>}

      {state.connected ? (
        <div className="mt-8">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-card p-6">
            <div className="flex items-center gap-4">
              {state.source_type === "sheet" ? (
                <FileSpreadsheet className="size-6" style={{ color: "var(--accent)" }} />
              ) : state.source_type === "api" ? (
                <Plug className="size-6" style={{ color: "var(--accent)" }} />
              ) : (
                <FileText className="size-6" style={{ color: "var(--accent)" }} />
              )}
              <div>
                <p className="font-semibold">
                  {SOURCE_LABEL[state.source_type]}{" "}
                  <span className="ml-2 rounded-full px-2.5 py-0.5 text-xs" style={{ background: "color-mix(in oklab, var(--azzurro) 22%, transparent)" }}>
                    {state.item_count} articoli
                  </span>
                </p>
                <p className="mt-0.5 max-w-md truncate text-xs text-muted-foreground">
                  {state.source_ref} · aggiornato {new Date(state.synced_at + "Z").toLocaleString("it-IT")}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              {(state.source_type === "sheet" || state.source_type === "api") && (
                <button
                  onClick={() => {
                    if (
                      state.edited_count > 0 &&
                      !confirm(`Hai ${state.edited_count === 1 ? "1 modifica manuale" : `${state.edited_count} modifiche manuali`} dall'ultima sincronizzazione. Sincronizzando, la fonte (${SOURCE_LABEL[state.source_type]}) sovrascrive tutto e le modifiche vanno perse. Continuare?`)
                    ) return;
                    run("sync", () => api.syncListino());
                  }}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm transition-colors hover:border-accent disabled:opacity-50"
                >
                  {busy === "sync" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                  Sincronizza
                </button>
              )}
              <button
                onClick={remove}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              >
                <Trash2 className="size-4" />
                Rimuovi
              </button>
            </div>
          </div>

          {state.source_type === "api" && <ApiConnectionEditor onChanged={reload} />}
          {state.edited_count > 0 && (state.source_type === "sheet" || state.source_type === "api") && (
            <p className="mt-4 text-xs text-muted-foreground">
              {state.edited_count === 1 ? "1 modifica manuale" : `${state.edited_count} modifiche manuali`} dall'ultima sincronizzazione: alla prossima "Sincronizza" la fonte vince e vengono sovrascritte.
            </p>
          )}
          <ItemsEditor key={state.synced_at + state.item_count} total={state.item_count} onChanged={reload} />
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-2">
          {/* Google Sheet */}
          <div className="rounded-2xl border border-border bg-card p-6">
            <FileSpreadsheet className="size-6" style={{ color: "var(--accent)" }} />
            <h2 className="mt-4 font-semibold">Collega un Google Sheet</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Incolla il link del foglio (colonne: descrizione e prezzo; codice e unità
              facoltativi). Resta privato: lo leggiamo col tuo account.
            </p>
            <div className="mt-4 flex gap-2">
              <input
                value={sheetUrl}
                onChange={(e) => setSheetUrl(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/…"
                className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3.5 py-2 text-sm outline-none placeholder:text-muted-foreground/50 focus:border-accent"
              />
              <button
                onClick={() => run("connect", () => api.connectSheet(sheetUrl))}
                disabled={busy !== null || !sheetUrl.trim()}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-50"
                style={{ background: "var(--azzurro)", color: "var(--nero)" }}
              >
                {busy === "connect" ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
                Collega
              </button>
            </div>
          </div>

          {/* Upload file */}
          <div className="rounded-2xl border border-border bg-card p-6">
            <FileText className="size-6" style={{ color: "var(--rosa)" }} />
            <h2 className="mt-4 font-semibold">Carica un file</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              PDF (lo legge l'AI, max 10MB) oppure CSV esportato dal gestionale. Per listini molto
              grandi consigliamo il Google Sheet.
            </p>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy !== null}
              className="mt-4 inline-flex items-center gap-2 rounded-xl border border-dashed border-border px-5 py-3 text-sm text-muted-foreground transition-colors hover:border-accent hover:text-foreground disabled:opacity-50"
            >
              {busy === "upload" ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
              {busy === "upload" ? "Elaborazione in corso…" : "Scegli file (PDF o CSV)"}
            </button>
            <input ref={fileRef} type="file" accept=".pdf,.csv,application/pdf,text/csv" onChange={onFile} className="hidden" />
          </div>

          {/* Connettore API */}
          <div className="rounded-2xl border border-border bg-card p-6 md:col-span-2">
            <Plug className="size-6" style={{ color: "var(--accent)" }} />
            <h2 className="mt-4 font-semibold">Collega un'API</h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Il listino sta nel tuo gestionale o su un sito protetto? Se espone un'API REST che
              risponde in JSON, collegala qui: i campi (descrizione, prezzo, codice…) li riconosce
              l'AI da sola. Le credenziali sono salvate cifrate e non lasciano mai il server.
            </p>
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                placeholder="https://api.tuogestionale.it/prodotti"
                className="rounded-xl border border-border bg-background px-3.5 py-2 text-sm outline-none placeholder:text-muted-foreground/50 focus:border-accent sm:col-span-2"
              />
              <select
                value={authType}
                onChange={(e) => setAuthType(e.target.value)}
                className="rounded-xl border border-border bg-background px-3.5 py-2 text-sm outline-none focus:border-accent"
              >
                {AUTH_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value} className="bg-background">
                    {o.label}
                  </option>
                ))}
              </select>
              {authType === "apikey" && (
                <input
                  value={headerName}
                  onChange={(e) => setHeaderName(e.target.value)}
                  placeholder="Nome header (es. X-Api-Key)"
                  className="rounded-xl border border-border bg-background px-3.5 py-2 text-sm outline-none placeholder:text-muted-foreground/50 focus:border-accent"
                />
              )}
              {authType !== "none" && (
                <input
                  type="password"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder={authType === "basic" ? "utente:password" : authType === "bearer" ? "Token" : "Chiave API"}
                  className={authType === "apikey" ? "rounded-xl border border-border bg-background px-3.5 py-2 text-sm outline-none placeholder:text-muted-foreground/50 focus:border-accent sm:col-span-2" : "rounded-xl border border-border bg-background px-3.5 py-2 text-sm outline-none placeholder:text-muted-foreground/50 focus:border-accent"}
                />
              )}
            </div>
            <button
              onClick={() => run("connect-api", () => api.connectApi({ url: apiUrl, authType, headerName, secret }))}
              disabled={busy !== null || !apiUrl.trim() || (authType !== "none" && !secret.trim())}
              className="mt-3 inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-50"
              style={{ background: "var(--azzurro)", color: "var(--nero)" }}
            >
              {busy === "connect-api" ? <Loader2 className="size-4 animate-spin" /> : <Plug className="size-4" />}
              {busy === "connect-api" ? "Collego e analizzo…" : "Collega API"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── Articoli: ricerca + modifica in riga ───────────────────────── */

const PAGE = 50;
const cellInput =
  "w-full rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/50 focus:border-accent";
const eur = (n: number) => new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n);
const numStr = (n: number) => String(n).replace(".", ",");
const parseNum = (s: string) => {
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};

type Draft = { code: string; description: string; unit: string; unit_price: string };
const emptyDraft: Draft = { code: "", description: "", unit: "", unit_price: "" };
const toDraft = (it: PriceListItem): Draft => ({ code: it.code ?? "", description: it.description, unit: it.unit ?? "", unit_price: numStr(it.unit_price) });

function ItemsEditor({ total, onChanged }: { total: number; onChanged: () => void }) {
  const [q, setQ] = useState("");
  const [qDraft, setQDraft] = useState("");
  const [items, setItems] = useState<PriceListItem[]>([]);
  const [found, setFound] = useState(total);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null); // id in modifica
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQ(qDraft.trim()), 300);
    return () => clearTimeout(t);
  }, [qDraft]);

  function load(reset: boolean) {
    setLoading(true);
    api.listListinoItems({ q: q || undefined, limit: PAGE, offset: reset ? 0 : items.length })
      .then((p) => {
        setItems((cur) => (reset ? p.items : [...cur, ...p.items]));
        setFound(p.total);
      })
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => load(true), [q]);

  function startEdit(it: PriceListItem) {
    setAdding(false);
    setEditing(it.id ?? null);
    setDraft(toDraft(it));
  }
  function validate(d: Draft): { description: string; code: string | null; unit: string | null; unit_price: number } | null {
    const price = parseNum(d.unit_price);
    if (!d.description.trim()) { toast.error("La descrizione è obbligatoria"); return null; }
    if (!Number.isFinite(price) || price < 0) { toast.error("Prezzo non valido"); return null; }
    return { description: d.description.trim(), code: d.code.trim() || null, unit: d.unit.trim() || null, unit_price: price };
  }
  async function saveEdit(id: string) {
    const v = validate(draft);
    if (!v) return;
    setBusy(true);
    try {
      const { item } = await api.updateListinoItem(id, v);
      setItems((cur) => cur.map((x) => (x.id === id ? item : x)));
      setEditing(null);
      toast.success("Articolo aggiornato");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore");
    } finally {
      setBusy(false);
    }
  }
  async function saveNew() {
    const v = validate(draft);
    if (!v) return;
    setBusy(true);
    try {
      const { item } = await api.addListinoItem(v);
      setItems((cur) => [item, ...cur]);
      setFound((n) => n + 1);
      setAdding(false);
      setDraft(emptyDraft);
      toast.success("Articolo aggiunto");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore");
    } finally {
      setBusy(false);
    }
  }
  async function remove(it: PriceListItem) {
    if (!it.id || !confirm(`Eliminare "${it.description}" dal listino?`)) return;
    try {
      await api.deleteListinoItem(it.id);
      setItems((cur) => cur.filter((x) => x.id !== it.id));
      setFound((n) => n - 1);
      toast.success("Articolo eliminato");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore");
    }
  }

  const rowGrid = "grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 sm:grid-cols-[110px_1fr_90px_120px_72px] sm:items-center sm:gap-2";
  const EditRow = ({ onSave, onCancel }: { onSave: () => void; onCancel: () => void }) => (
    <div className={cn(rowGrid, "border-b border-border/50 bg-foreground/[0.03] px-4 py-2.5")}>
      <input className={cellInput} placeholder="Codice" value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} />
      <input className={cn(cellInput, "col-span-2 sm:col-span-1")} placeholder="Descrizione" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} autoFocus />
      <input className={cellInput} placeholder="Unità" value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} />
      <input className={cn(cellInput, "text-right")} inputMode="decimal" placeholder="Prezzo" value={draft.unit_price} onChange={(e) => setDraft({ ...draft, unit_price: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") onSave(); if (e.key === "Escape") onCancel(); }} />
      <span className="flex justify-end gap-1">
        <button onClick={onSave} disabled={busy} aria-label="Salva" className="rounded-lg p-1.5 disabled:opacity-50" style={{ background: "var(--azzurro)", color: "var(--nero)" }}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}</button>
        <button onClick={onCancel} aria-label="Annulla" className="rounded-lg border border-border p-1.5"><X className="size-4" /></button>
      </span>
    </div>
  );

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input type="search" value={qDraft} onChange={(e) => setQDraft(e.target.value)} placeholder="Cerca codice o descrizione…" className="w-full rounded-full border border-border bg-card py-1.5 pl-9 pr-3.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-accent" />
        </label>
        <button onClick={() => { setEditing(null); setDraft(emptyDraft); setAdding(true); }} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-sm transition-colors hover:border-accent">
          <Plus className="size-4" /> Aggiungi articolo
        </button>
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {q ? `${found} ${found === 1 ? "risultato" : "risultati"}` : `${found} articoli`}
        </span>
      </div>

      <div className="mt-3 overflow-hidden rounded-xl border border-border">
        <div className="hidden gap-2 border-b border-border px-4 py-2.5 font-mono text-xs uppercase tracking-wider text-muted-foreground sm:grid sm:grid-cols-[110px_1fr_90px_120px_72px]">
          <span>Codice</span><span>Descrizione</span><span>Unità</span><span className="text-right">Prezzo</span><span />
        </div>
        {adding && <EditRow onSave={saveNew} onCancel={() => setAdding(false)} />}
        {items.map((it) =>
          editing === it.id ? (
            <EditRow key={it.id} onSave={() => saveEdit(it.id!)} onCancel={() => setEditing(null)} />
          ) : (
            <div key={it.id} className={cn(rowGrid, "group border-b border-border/50 px-4 py-2.5 text-sm last:border-0")}>
              <span className="order-3 truncate font-mono text-xs text-muted-foreground sm:order-none">{it.code ?? "—"}{it.unit ? <span className="sm:hidden"> · {it.unit}</span> : null}</span>
              <span className="order-1 truncate sm:order-none">{it.description}</span>
              <span className="hidden text-muted-foreground sm:block">{it.unit ?? "—"}</span>
              <span className="order-2 text-right sm:order-none">{eur(it.unit_price)}</span>
              <span className="order-4 flex justify-end gap-1 sm:order-none">
                <button onClick={() => startEdit(it)} aria-label="Modifica" className="rounded-lg border border-border p-1.5 text-muted-foreground transition-colors hover:border-accent hover:text-foreground"><Pencil className="size-3.5" /></button>
                <button onClick={() => remove(it)} aria-label="Elimina" className="rounded-lg border border-border p-1.5 text-muted-foreground transition-colors hover:border-[var(--rosa)] hover:text-[var(--rosa)]"><Trash2 className="size-3.5" /></button>
              </span>
            </div>
          ),
        )}
        {!loading && items.length === 0 && (
          <p className="px-4 py-3 text-sm text-muted-foreground">{q ? "Nessun articolo corrisponde." : "Listino vuoto: aggiungi il primo articolo."}</p>
        )}
      </div>
      {items.length < found && (
        <div className="mt-4 flex justify-center">
          <button onClick={() => load(false)} disabled={loading} className="rounded-full border border-border px-5 py-2 text-sm transition-colors hover:border-accent disabled:opacity-50">
            Carica altri ({found - items.length} rimanenti)
          </button>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── Connessione API: modifica senza ricreare ───────────────────────── */

function ApiConnectionEditor({ onChanged }: { onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState<ApiConfigView | null>(null);
  const [form, setForm] = useState({ url: "", authType: "none", headerName: "", secret: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.getListinoApiConfig().then((c) => { setCfg(c); setForm({ url: c.url, authType: c.authType, headerName: c.headerName ?? "", secret: "" }); }).catch(() => {});
  }, []);
  async function save() {
    setBusy(true);
    try {
      const r = await api.updateListinoApiConfig({ url: form.url, authType: form.authType, headerName: form.headerName, secret: form.secret || undefined });
      setCfg(r);
      setForm((f) => ({ ...f, secret: "" }));
      setOpen(false);
      toast.success(`Connessione aggiornata: ${r.tested} articoli letti in prova`);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Connessione non riuscita");
    } finally {
      setBusy(false);
    }
  }
  if (!cfg) return null;
  return (
    <div className="mt-4 rounded-2xl border border-border p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Connessione</span>
          <span className="ml-3 truncate">{cfg.url}</span>
          <span className="ml-2 rounded-full px-2 py-0.5 text-xs" style={{ background: "color-mix(in oklab, var(--foreground) 10%, transparent)" }}>
            {cfg.authType === "none" ? "senza autenticazione" : cfg.authType === "apikey" ? `API key (${cfg.headerName ?? "header"})` : cfg.authType}
          </span>
        </p>
        <button onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-sm transition-colors hover:border-accent">
          <Settings2 className="size-4" /> {open ? "Chiudi" : "Modifica connessione"}
        </button>
      </div>
      {open && (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input className={cn(cellInput, "sm:col-span-2")} placeholder="https://api.tuogestionale.it/prodotti" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
          <select className={cellInput} value={form.authType} onChange={(e) => setForm({ ...form, authType: e.target.value })}>
            <option value="none">Nessuna autenticazione</option>
            <option value="apikey">API key (header)</option>
            <option value="bearer">Bearer token</option>
            <option value="basic">Basic (utente:password)</option>
          </select>
          {form.authType === "apikey" && (
            <input className={cellInput} placeholder="Nome header (es. X-Api-Key)" value={form.headerName} onChange={(e) => setForm({ ...form, headerName: e.target.value })} />
          )}
          {form.authType !== "none" && (
            <input className={cn(cellInput, form.authType === "apikey" ? "sm:col-span-2" : "")} type="password" autoComplete="off" placeholder={cfg.hasSecret ? "Segreto: lascia vuoto per mantenere quello attuale" : "Segreto / token"} value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} />
          )}
          <div className="flex gap-2 sm:col-span-2">
            <button onClick={save} disabled={busy} className="inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-medium disabled:opacity-60" style={{ background: "var(--azzurro)", color: "var(--nero)" }}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Prova e salva
            </button>
            <p className="self-center text-xs text-muted-foreground">Prima di salvare facciamo una chiamata di prova: se non risponde con articoli, non cambia nulla.</p>
          </div>
        </div>
      )}
    </div>
  );
}
