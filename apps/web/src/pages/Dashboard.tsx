import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Calendar,
  Check,
  ChevronDown,
  Download,
  Eye,
  FileText,
  Loader2,
  Pencil,
  RefreshCw,
  RotateCcw,
  Send,
  Square,
} from "lucide-react";

import { api, type DocumentItem, type ProcessedItem, type ScanResult, type ScanRun, type SentStatus } from "@/api";
import { cn } from "@/lib/utils";

const RUN_KIND_LABEL: Record<ScanRun["kind"], string> = {
  manuale: "Manuale",
  giornaliero: "Automatica",
  periodo: "Periodo",
};

const RUN_KIND_BG: Record<ScanRun["kind"], string> = {
  manuale: "color-mix(in oklab, var(--azzurro) 22%, transparent)",
  giornaliero: "color-mix(in oklab, var(--porcellana) 12%, transparent)",
  periodo: "color-mix(in oklab, var(--rosa) 18%, transparent)",
};

const CATEGORY_LABEL: Record<string, string> = {
  richiesta_commerciale: "Richiesta commerciale",
  newsletter: "Newsletter",
  notifica_automatica: "Notifica automatica",
  spam_marketing: "Marketing",
  personale: "Personale",
  altro: "Altro",
};

const EMPTY_RESULT: ScanResult = {
  scanned: 0,
  created: 0,
  errors: 0,
  skipped: 0,
  classified: 0,
  skippedIrrelevant: 0,
  draftsCreated: 0,
  remaining: 0,
};

const STATUS_LABEL: Record<SentStatus, string> = {
  da_inviare: "Da inviare",
  bozza: "Bozza in Gmail",
  inviato: "Inviato",
};

const STATUS_BG: Record<SentStatus, string> = {
  da_inviare: "color-mix(in oklab, var(--rosa) 18%, transparent)",
  bozza: "color-mix(in oklab, var(--azzurro) 22%, transparent)",
  inviato: "color-mix(in oklab, var(--porcellana) 12%, transparent)",
};

export function Dashboard() {
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [processed, setProcessed] = useState<ProcessedItem[]>([]);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);

  // ── scan per periodo ──
  const [showRange, setShowRange] = useState(false);
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [rangePhase, setRangePhase] = useState<"idle" | "counting" | "confirm" | "running">("idle");
  const [rangeEstimate, setRangeEstimate] = useState(0);
  const [rangeProgress, setRangeProgress] = useState<{ analyzed: number; remaining: number } | null>(null);
  const stopRange = useRef(false);

  const [history, setHistory] = useState<ScanRun[]>([]);

  function reload() {
    api.listDocuments().then(setDocs).catch(() => {});
    api.listProcessed().then(setProcessed).catch(() => {});
    api.listScanHistory().then(setHistory).catch(() => {});
  }
  useEffect(reload, []);

  async function scanNow() {
    setScanning(true);
    setError(null);
    setResult(null);
    try {
      const r = await api.scanNow();
      setResult(r);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore durante lo scan");
    } finally {
      setScanning(false);
    }
  }

  /** Conteggio a secco del periodo: quante mail nuove analizzeremmo (gratis). */
  async function countRange() {
    if (!rangeFrom || !rangeTo) return;
    setRangePhase("counting");
    setError(null);
    try {
      const { toAnalyze } = await api.scanRangeCount(rangeFrom, rangeTo);
      setRangeEstimate(toAnalyze);
      setRangePhase("confirm");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore nel conteggio");
      setRangePhase("idle");
    }
  }

  /** Loop a lotti: ogni chiamata analizza fino a 50 mail, finché il periodo è coperto. */
  async function runRange() {
    setRangePhase("running");
    setError(null);
    stopRange.current = false;
    const acc: ScanResult = { ...EMPTY_RESULT };
    let analyzed = 0;
    let prevRemaining = Infinity;
    try {
      for (;;) {
        const r = await api.scanRangeBatch(rangeFrom, rangeTo);
        acc.created += r.created;
        acc.errors += r.errors;
        acc.skipped += r.skipped;
        acc.classified += r.classified;
        acc.skippedIrrelevant += r.skippedIrrelevant;
        acc.draftsCreated += r.draftsCreated;
        acc.remaining = r.remaining;
        analyzed += r.classified;
        setRangeProgress({ analyzed, remaining: r.remaining });
        setResult({ ...acc });
        reload();
        if (stopRange.current || r.remaining <= 0) break;
        // guardia anti-stallo: nessun progresso e remaining invariato → stop
        if (r.remaining >= prevRemaining && r.classified === 0 && r.created === 0 && r.skippedIrrelevant === 0) {
          setError("Alcune mail non sono leggibili al momento: riprova più tardi.");
          break;
        }
        prevRemaining = r.remaining;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore durante lo scan del periodo");
    } finally {
      setRangePhase("idle");
      setRangeProgress(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Documenti</h1>
          <p className="mt-2 text-muted-foreground">
            I PDF generati dalle tue mail. Lo scan gira ogni giorno; puoi anche lanciarlo subito.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowRange((v) => !v)}
            disabled={rangePhase === "running"}
            className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-2.5 font-medium transition-colors hover:border-accent disabled:opacity-60"
          >
            <Calendar className="size-4" />
            Periodo…
          </button>
          <button
            onClick={scanNow}
            disabled={scanning || rangePhase === "running"}
            className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 font-medium disabled:opacity-60"
            style={{ background: "var(--azzurro)", color: "var(--nero)" }}
          >
            <RefreshCw className={cn("size-4", scanning && "animate-spin")} />
            {scanning ? "Scansione…" : "Scansiona ora"}
          </button>
        </div>
      </div>

      {/* ── pannello scan per periodo ── */}
      {showRange && (
        <div className="mt-4 rounded-2xl border border-border bg-card p-5">
          <p className="text-sm text-muted-foreground">
            Analizza <strong>tutte</strong> le mail di un periodo a tua scelta. Prima ti mostriamo
            quante sono e il costo stimato; le già analizzate non si ripagano mai.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={rangeFrom}
              onChange={(e) => { setRangeFrom(e.target.value); setRangePhase("idle"); }}
              disabled={rangePhase === "running"}
              className="rounded-xl border border-border bg-background px-3.5 py-2 text-sm outline-none focus:border-accent"
            />
            <span className="text-sm text-muted-foreground">→</span>
            <input
              type="date"
              value={rangeTo}
              onChange={(e) => { setRangeTo(e.target.value); setRangePhase("idle"); }}
              disabled={rangePhase === "running"}
              className="rounded-xl border border-border bg-background px-3.5 py-2 text-sm outline-none focus:border-accent"
            />
            {rangePhase === "idle" && (
              <button
                onClick={countRange}
                disabled={!rangeFrom || !rangeTo}
                className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-50"
                style={{ background: "var(--azzurro)", color: "var(--nero)" }}
              >
                Analizza periodo
              </button>
            )}
            {rangePhase === "counting" && (
              <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Conto le mail…
              </span>
            )}
            {rangePhase === "confirm" && (
              <span className="inline-flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">
                  {rangeEstimate === 0
                    ? "Nessuna mail nuova nel periodo (già tutto analizzato)."
                    : `${rangeEstimate} mail da analizzare · ~${Math.max(1, Math.round(rangeEstimate / 10))} cent`}
                </span>
                {rangeEstimate > 0 && (
                  <button
                    onClick={runRange}
                    className="rounded-xl px-4 py-2 text-sm font-medium"
                    style={{ background: "var(--azzurro)", color: "var(--nero)" }}
                  >
                    Procedi
                  </button>
                )}
              </span>
            )}
            {rangePhase === "running" && rangeProgress && (
              <span className="inline-flex items-center gap-3 text-sm">
                <Loader2 className="size-4 animate-spin" style={{ color: "var(--azzurro)" }} />
                <span className="text-muted-foreground">
                  Analizzate {rangeProgress.analyzed} · ancora {rangeProgress.remaining}
                </span>
                <button
                  onClick={() => { stopRange.current = true; }}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-xs transition-colors hover:border-accent"
                >
                  <Square className="size-3" />
                  Ferma
                </button>
              </span>
            )}
          </div>
        </div>
      )}

      {result && (
        <p className="mt-4 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          Scan completato — {result.created} documenti generati · {result.skipped} già visti ·{" "}
          {result.errors} errori
          {result.classified > 0 && (
            <>
              {" "}· {result.classified} analizzate dall'AI · {result.skippedIrrelevant} ignorate
            </>
          )}
          {result.draftsCreated > 0 && <> · {result.draftsCreated} bozze create</>}
          .
        </p>
      )}
      {error && <p className="mt-4 text-sm" style={{ color: "var(--rosa)" }}>{error}</p>}
      {needsReauth && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-5" style={{ borderColor: "var(--rosa)" }}>
          <p className="text-sm">
            <strong>Servono nuovi permessi Google</strong> per creare le bozze di risposta.
            Riautorizza l'accesso (un click, torni qui subito).
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

      {/* Storico scansioni */}
      <ScanHistory history={history} />

      {/* Documenti */}
      {docs.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-border p-12 text-center">
          <FileText className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-4 text-muted-foreground">
            Ancora nessun documento. Configura una{" "}
            <Link to="/keywords" className="underline decoration-dotted underline-offset-4">
              parola chiave
            </Link>{" "}
            e premi “Scansiona ora”.
          </p>
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {docs.map((d) => (
            <DocCard key={d.id} doc={d} onChanged={reload} onNeedsReauth={() => setNeedsReauth(true)} />
          ))}
        </div>
      )}

      {/* Log mail processate */}
      {processed.length > 0 && (
        <ProcessedLog processed={processed} onChanged={reload} />
      )}
    </div>
  );
}

/* ───────────────── Storico scansioni ───────────────── */

function ScanHistory({ history }: { history: ScanRun[] }) {
  const [open, setOpen] = useState(true);

  return (
    <div className="mt-8">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 font-mono text-sm uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground"
      >
        Storico scansioni
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="mt-4 overflow-hidden rounded-xl border border-border">
          {history.length === 0 && (
            <p className="px-4 py-3 text-sm text-muted-foreground">
              Nessuna scansione registrata (lo storico parte da oggi).
            </p>
          )}
          {history.map((r, i) => (
            <div
              key={r.id}
              className={cn(
                "flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm",
                i > 0 && "border-t border-border",
              )}
            >
              <span className="shrink-0 rounded-full px-2.5 py-0.5 text-xs" style={{ background: RUN_KIND_BG[r.kind] }}>
                {RUN_KIND_LABEL[r.kind]}
              </span>
              {r.label && <span className="shrink-0 font-mono text-xs text-muted-foreground/70">{r.label}</span>}
              <span className="shrink-0 font-mono text-xs text-muted-foreground/70">
                {new Date(r.run_at + "Z").toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
              </span>
              <span className="ml-auto text-muted-foreground">
                <strong className={cn(r.created > 0 && "text-foreground")}>{r.created} documenti</strong>
                {" · "}{r.classified} analizzate · {r.skipped_irrelevant} ignorate
                {r.errors > 0 ? (
                  <>
                    {" · "}
                    <span style={{ color: "var(--rosa)" }}>{r.errors} errori</span>
                  </>
                ) : (
                  " · 0 errori"
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ───────────────── Log mail processate: espandibile, con Riprova ───────────────── */

function ProcessedLog({ processed, onChanged }: { processed: ProcessedItem[]; onChanged: () => void }) {
  const [hideSkipped, setHideSkipped] = useState(false);
  const skippedCount = processed.filter((p) => p.status === "skipped").length;
  const visible = hideSkipped ? processed.filter((p) => p.status !== "skipped") : processed;

  return (
    <div className="mt-14">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-mono text-sm uppercase tracking-[0.16em] text-muted-foreground">
          Mail processate
        </h2>
        {skippedCount > 0 && (
          <button
            onClick={() => setHideSkipped((v) => !v)}
            className={cn(
              "rounded-full border px-3.5 py-1 text-xs transition-colors",
              hideSkipped ? "border-accent text-foreground" : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {hideSkipped ? `Mostra ignorate (${skippedCount})` : `Nascondi ignorate (${skippedCount})`}
          </button>
        )}
      </div>
      <div className="mt-4 overflow-hidden rounded-xl border border-border">
        {visible.map((p, i) => (
          <ProcessedRow key={p.id} p={p} first={i === 0} onChanged={onChanged} />
        ))}
        {visible.length === 0 && (
          <p className="px-4 py-3 text-sm text-muted-foreground">Nessuna riga da mostrare col filtro attivo.</p>
        )}
      </div>
    </div>
  );
}

function ProcessedRow({ p, first, onChanged }: { p: ProcessedItem; first: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryMsg, setRetryMsg] = useState<string | null>(null);

  async function retry(e: React.MouseEvent) {
    e.stopPropagation();
    setRetrying(true);
    setRetryMsg(null);
    try {
      const r = await api.retryProcessed(p.id);
      if (r.outcome === "done") setRetryMsg("Documento generato ✓");
      else if (r.outcome === "skipped") setRetryMsg(`Confermata non pertinente: ${r.reason}`);
      else setRetryMsg(`Errore: ${r.error}`);
      onChanged();
    } catch (err) {
      setRetryMsg(err instanceof Error ? err.message : "Errore");
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className={cn(!first && "border-t border-border")}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left text-sm transition-colors hover:bg-foreground/[0.03]"
      >
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {p.subject || "(senza oggetto)"}
        </span>
        {p.matched_keyword === "auto" ? (
          <span
            className="shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider"
            style={{ background: "color-mix(in oklab, var(--rosa) 18%, transparent)" }}
          >
            AI
          </span>
        ) : (
          <span className="shrink-0 font-mono text-xs text-muted-foreground/70">{p.matched_keyword}</span>
        )}
        <span
          className="shrink-0 rounded-full px-2.5 py-0.5 text-xs"
          style={{
            background:
              p.status === "done"
                ? "color-mix(in oklab, var(--azzurro) 22%, transparent)"
                : p.status === "skipped"
                  ? "color-mix(in oklab, var(--porcellana) 12%, transparent)"
                  : "color-mix(in oklab, var(--rosa) 22%, transparent)",
          }}
        >
          {p.status === "done" ? "OK" : p.status === "skipped" ? "Ignorata" : "Errore"}
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="border-t border-border/50 bg-foreground/[0.02] px-4 py-3 text-sm">
          {p.category && (
            <span
              className="mr-2 rounded-full px-2.5 py-0.5 text-xs"
              style={{ background: "color-mix(in oklab, var(--azzurro) 14%, transparent)" }}
            >
              {CATEGORY_LABEL[p.category] ?? p.category}
            </span>
          )}
          {p.status === "error" && p.error && (
            <p className="mt-2" style={{ color: "var(--rosa)" }}>{p.error}</p>
          )}
          {p.status === "skipped" && (
            <p className="mt-2 text-muted-foreground">
              {p.detail ??
                "Motivo non registrato (analizzata prima dell'aggiornamento) — usa Riprova per rianalizzarla."}
            </p>
          )}
          {p.status === "done" && p.detail && <p className="mt-2 text-muted-foreground">{p.detail}</p>}

          {(p.status === "skipped" || p.status === "error") && (
            <div className="mt-3 flex items-center gap-3">
              <button
                onClick={retry}
                disabled={retrying}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-xs transition-colors hover:border-accent disabled:opacity-50"
              >
                {retrying ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
                {retrying ? "Rianalizzo…" : "Riprova"}
              </button>
              {retryMsg && <span className="text-xs text-muted-foreground">{retryMsg}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DocCard({
  doc,
  onChanged,
  onNeedsReauth,
}: {
  doc: DocumentItem;
  onChanged: () => void;
  onNeedsReauth: () => void;
}) {
  const d = doc.data;
  const [drafting, setDrafting] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const accent = doc.type === "fattura" ? "var(--azzurro)" : "var(--rosa)";
  const fmt = (n: number | null) =>
    n === null
      ? "—"
      : new Intl.NumberFormat("it-IT", { style: "currency", currency: d.currency || "EUR" }).format(n);

  async function prepareDraft() {
    if (doc.sentStatus === "bozza" && !confirm("Esiste già una bozza in Gmail per questo documento. Crearne un'altra?")) {
      return;
    }
    setDrafting(true);
    setCardError(null);
    try {
      const r = await api.createDraft(doc.id);
      if ("error" in r) {
        if (r.needsReauth) onNeedsReauth();
        else setCardError(r.error);
      } else {
        onChanged();
      }
    } catch (e) {
      setCardError(e instanceof Error ? e.message : "Errore");
    } finally {
      setDrafting(false);
    }
  }

  async function markSent() {
    await api.setStatus(doc.id, "inviato").catch(() => {});
    onChanged();
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="rounded-full px-2.5 py-0.5 text-xs capitalize" style={{ background: `color-mix(in oklab, ${accent} 22%, transparent)` }}>
            {doc.type}
          </span>
          <span className="rounded-full px-2.5 py-0.5 text-xs" style={{ background: STATUS_BG[doc.sentStatus] }}>
            {STATUS_LABEL[doc.sentStatus]}
          </span>
        </div>
        <span className="font-mono text-xs text-muted-foreground/70">
          {new Date(doc.createdAt + "Z").toLocaleDateString("it-IT")}
        </span>
      </div>
      <h3 className="mt-4 truncate text-lg font-semibold">{d.customer_name || "Cliente non rilevato"}</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {d.line_items.length} righe · Totale {fmt(d.total)}
      </p>
      {cardError && <p className="mt-2 text-xs" style={{ color: "var(--rosa)" }}>{cardError}</p>}

      <button
        onClick={prepareDraft}
        disabled={drafting}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium disabled:opacity-60"
        style={{ background: "var(--azzurro)", color: "var(--nero)" }}
      >
        {drafting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        {drafting ? "Preparo la bozza…" : "Prepara risposta"}
      </button>
      {doc.sentStatus !== "inviato" && (
        <button
          onClick={markSent}
          className="mt-2 inline-flex w-full items-center justify-center gap-1.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <Check className="size-3.5" />
          Segna come inviato
        </button>
      )}
      <div className="mt-5 flex gap-2">
        <a
          href={api.pdfUrl(doc.id)}
          target="_blank"
          rel="noopener"
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border py-2 text-sm transition-colors hover:border-accent"
        >
          <Eye className="size-4" />
          Anteprima
        </a>
        <Link
          to={`/documents/${doc.id}/edit`}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border py-2 text-sm transition-colors hover:border-accent"
        >
          <Pencil className="size-4" />
          Modifica
        </Link>
        <a
          href={api.pdfUrl(doc.id, true)}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border py-2 text-sm transition-colors hover:border-accent"
        >
          <Download className="size-4" />
          Scarica
        </a>
      </div>
    </div>
  );
}
