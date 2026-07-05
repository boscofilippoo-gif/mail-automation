import { useEffect, useRef, useState } from "react";
import { FileSpreadsheet, FileText, Link2, Loader2, Plug, RefreshCw, Trash2 } from "lucide-react";

import { api, type ListinoResult, type ListinoState } from "@/api";

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
            onClick={() => (window.location.href = "/auth/google")}
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
                <FileSpreadsheet className="size-6" style={{ color: "var(--azzurro)" }} />
              ) : state.source_type === "api" ? (
                <Plug className="size-6" style={{ color: "var(--azzurro)" }} />
              ) : (
                <FileText className="size-6" style={{ color: "var(--azzurro)" }} />
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
                  onClick={() => run("sync", () => api.syncListino())}
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

          {/* anteprima articoli */}
          <div className="mt-6 overflow-hidden rounded-xl border border-border">
            <div className="grid grid-cols-[100px_1fr_80px_110px] gap-2 border-b border-border px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <span>Codice</span><span>Descrizione</span><span>Unità</span><span className="text-right">Prezzo</span>
            </div>
            {state.preview.map((it, i) => (
              <div key={i} className="grid grid-cols-[100px_1fr_80px_110px] gap-2 border-b border-border/50 px-4 py-2.5 text-sm last:border-0">
                <span className="truncate font-mono text-xs text-muted-foreground">{it.code ?? "—"}</span>
                <span className="truncate">{it.description}</span>
                <span className="text-muted-foreground">{it.unit ?? "—"}</span>
                <span className="text-right">
                  {new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(it.unit_price)}
                </span>
              </div>
            ))}
            {state.item_count > state.preview.length && (
              <p className="px-4 py-2.5 text-xs text-muted-foreground">
                … e altri {state.item_count - state.preview.length} articoli.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-2">
          {/* Google Sheet */}
          <div className="rounded-2xl border border-border bg-card p-6">
            <FileSpreadsheet className="size-6" style={{ color: "var(--azzurro)" }} />
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
            <Plug className="size-6" style={{ color: "var(--azzurro)" }} />
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
