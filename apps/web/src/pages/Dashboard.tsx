import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Calendar,
  Check,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Loader2,
  Pencil,
  RefreshCw,
  RotateCcw,
  Send,
  Square,
} from "lucide-react";

import { useOutletContext } from "react-router-dom";

import { api, gmailUrl, type DocumentItem, type Me, type ProcessedItem, type ScanResult, type ScanRun, type SentStatus } from "@/api";
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
  const { me } = useOutletContext<{ me: Me | null }>();
  const inoltro = me?.mailMode === "inoltro";
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

  // auto-refresh: polling ogni 15s SOLO a scheda visibile + refresh immediato
  // quando l'utente torna sul tab (le mail inoltrate arrivano da sole: la
  // dashboard deve mostrarle senza F5)
  useEffect(() => {
    const iv = setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, 15_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
            {inoltro
              ? "I PDF generati dalle mail che inoltri: arrivano da soli, nessuna scansione necessaria."
              : "I PDF generati dalle tue mail. Lo scan gira ogni giorno; puoi anche lanciarlo subito."}
          </p>
        </div>
        {!inoltro && (
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
        )}
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
      <ScanHistory history={history} onChanged={reload} />

      {/* Documenti */}
      {docs.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-border p-12 text-center">
          <FileText className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-4 text-muted-foreground">
            {inoltro ? (
              <>
                Ancora nessun documento. Inoltra una mail al tuo{" "}
                <Link to="/settings" className="underline decoration-dotted underline-offset-4">
                  indirizzo personale
                </Link>{" "}
                e comparirà qui da solo entro un minuto.
              </>
            ) : (
              <>
                Ancora nessun documento. Configura una{" "}
                <Link to="/keywords" className="underline decoration-dotted underline-offset-4">
                  parola chiave
                </Link>{" "}
                e premi “Scansiona ora”.
              </>
            )}
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

function ScanHistory({ history, onChanged }: { history: ScanRun[]; onChanged: () => void }) {
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
            <ScanRunRow key={r.id} run={r} first={i === 0} onChanged={onChanged} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Riga di run apribile: al click carica e mostra le mail elaborate in quel run. */
function ScanRunRow({ run, first, onChanged }: { run: ScanRun; first: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [mails, setMails] = useState<ProcessedItem[] | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && mails === null && state !== "loading") {
      setState("loading");
      try {
        setMails(await api.listRunMails(run.id));
        setState("idle");
      } catch {
        setState("error");
      }
    }
  }

  /** Dopo un Riprova dentro il run: ricarica sia il dettaglio che il resto della dashboard. */
  async function handleChanged() {
    onChanged();
    try {
      setMails(await api.listRunMails(run.id));
    } catch {
      /* il dettaglio resta com'era */
    }
  }

  return (
    <div className={cn(!first && "border-t border-border")}>
      <button
        onClick={toggle}
        className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-left text-sm transition-colors hover:bg-foreground/[0.03]"
      >
        <span className="shrink-0 rounded-full px-2.5 py-0.5 text-xs" style={{ background: RUN_KIND_BG[run.kind] }}>
          {RUN_KIND_LABEL[run.kind]}
        </span>
        {run.label && <span className="shrink-0 font-mono text-xs text-muted-foreground/70">{run.label}</span>}
        <span className="shrink-0 font-mono text-xs text-muted-foreground/70">
          {new Date(run.run_at + "Z").toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
        </span>
        <span className="ml-auto text-muted-foreground">
          <strong className={cn(run.created > 0 && "text-foreground")}>{run.created} documenti</strong>
          {" · "}{run.classified} analizzate · {run.skipped_irrelevant} ignorate
          {run.errors > 0 ? (
            <>
              {" · "}
              <span style={{ color: "var(--rosa)" }}>{run.errors} errori</span>
            </>
          ) : (
            " · 0 errori"
          )}
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="border-t border-border/50 bg-foreground/[0.02]">
          {state === "loading" && <p className="px-4 py-3 text-sm text-muted-foreground">Caricamento…</p>}
          {state === "error" && (
            <p className="px-4 py-3 text-sm" style={{ color: "var(--rosa)" }}>Errore nel caricamento del dettaglio.</p>
          )}
          {mails !== null && mails.length === 0 && (
            <p className="px-4 py-3 text-sm text-muted-foreground">
              {run.classified + run.created + run.errors > 0
                ? "Dettaglio non disponibile per le scansioni precedenti all'aggiornamento."
                : "Nessuna mail elaborata in questa scansione."}
            </p>
          )}
          {mails !== null && mails.length > 0 && (
            <div className="mx-3 my-2 overflow-hidden rounded-lg border border-border/60">
              {mails.map((p, i) => (
                <ProcessedRow key={p.id} p={p} first={i === 0} onChanged={handleChanged} />
              ))}
            </div>
          )}
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
  const { me: rowMe } = useOutletContext<{ me: Me | null }>();
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

          <div className="mt-3 flex flex-wrap items-center gap-3">
            {rowMe?.mailMode !== "inoltro" && (
              <a
                href={gmailUrl(p.gmail_message_id)}
                target="_blank"
                rel="noopener"
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-xs transition-colors hover:border-accent"
              >
                <ExternalLink className="size-3.5" />
                Apri in Gmail
              </a>
            )}
            {(p.status === "skipped" || p.status === "error") && (
              <button
                onClick={retry}
                disabled={retrying}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-xs transition-colors hover:border-accent disabled:opacity-50"
              >
                {retrying ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
                {retrying ? "Rianalizzo…" : "Riprova"}
              </button>
            )}
            {retryMsg && <span className="text-xs text-muted-foreground">{retryMsg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Modal "Genera risposta" (modalità inoltro): testo AI da copiare + mailto. */
function ReplyModal({ docId, onClose }: { docId: number; onClose: () => void }) {
  const [reply, setReply] = useState<{ to: string; subject: string; body: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.getReplyText(docId).then(setReply).catch((e) => setError(e.message));
  }, [docId]);

  function copy() {
    if (!reply) return;
    void navigator.clipboard.writeText(reply.body).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const mailto = reply
    ? `mailto:${encodeURIComponent(reply.to)}?subject=${encodeURIComponent(reply.subject)}&body=${encodeURIComponent(reply.body.slice(0, 1800))}`
    : "#";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl border border-border bg-background p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold">Risposta pronta</h3>
        {error && <p className="mt-2 text-sm" style={{ color: "var(--rosa)" }}>{error}</p>}
        {!reply && !error && (
          <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> L'AI sta scrivendo la risposta…
          </p>
        )}
        {reply && (
          <>
            <p className="mt-2 text-xs text-muted-foreground">
              A: {reply.to || "—"} · Oggetto: {reply.subject}
            </p>
            <textarea
              readOnly
              value={reply.body}
              rows={10}
              className="mt-3 w-full rounded-xl border border-border bg-card p-3 text-sm leading-relaxed text-foreground outline-none"
            />
            <p className="mt-2 text-xs text-muted-foreground">
              💡 Ricordati di <strong>allegare il PDF</strong> (bottone Scarica sulla card).
            </p>
            <div className="mt-4 flex gap-2">
              <button
                onClick={copy}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium"
                style={{ background: "var(--azzurro)", color: "var(--nero)" }}
              >
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? "Copiato" : "Copia testo"}
              </button>
              <a
                href={mailto}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border py-2 text-sm transition-colors hover:border-accent"
              >
                <Send className="size-4" />
                Apri nel client email
              </a>
            </div>
          </>
        )}
        <button onClick={onClose} className="mt-3 w-full py-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
          Chiudi
        </button>
      </div>
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
  const { me: cardMe } = useOutletContext<{ me: Me | null }>();
  const inoltro = cardMe?.mailMode === "inoltro";
  const d = doc.data;
  const [drafting, setDrafting] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const [replyOpen, setReplyOpen] = useState(false);
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
        <span className="inline-flex items-center gap-2 font-mono text-xs text-muted-foreground/70">
          {new Date(doc.createdAt + "Z").toLocaleDateString("it-IT")}
          {!inoltro && (
            <a
              href={gmailUrl(doc.sourceMessageId)}
              target="_blank"
              rel="noopener"
              title="Apri la mail originale in Gmail"
              className="transition-colors hover:text-foreground"
            >
              <ExternalLink className="size-3.5" />
            </a>
          )}
        </span>
      </div>
      <h3 className="mt-4 truncate text-lg font-semibold">{d.customer_name || "Cliente non rilevato"}</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {d.line_items.length} righe · Totale {fmt(d.total)}
      </p>
      {cardError && <p className="mt-2 text-xs" style={{ color: "var(--rosa)" }}>{cardError}</p>}

      {inoltro ? (
        <button
          onClick={() => setReplyOpen(true)}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium"
          style={{ background: "var(--azzurro)", color: "var(--nero)" }}
        >
          <Send className="size-4" />
          Genera risposta
        </button>
      ) : (
        <button
          onClick={prepareDraft}
          disabled={drafting}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium disabled:opacity-60"
          style={{ background: "var(--azzurro)", color: "var(--nero)" }}
        >
          {drafting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          {drafting ? "Preparo la bozza…" : "Prepara risposta"}
        </button>
      )}
      {replyOpen && <ReplyModal docId={doc.id} onClose={() => setReplyOpen(false)} />}
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
