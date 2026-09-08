import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Calendar,
  Check,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  HelpCircle,
  Eye,
  FileSpreadsheet,
  FileText,
  Loader2,
  Pencil,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Square,
  Trash2,
  Undo2,
  X,
} from "lucide-react";

import { useOutletContext } from "react-router-dom";

import {
  api,
  connectGmail,
  gmailUrl,
  type DocType,
  type DocumentFilters,
  type DocumentItem,
  type DocumentSort,
  type Me,
  type ProcessedItem,
  type ScanResult,
  type ScanRun,
  type SentStatus,
} from "@/api";
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

const PAGE = 20;
const PROCESSED_PAGE = 50;

type Period = "7d" | "30d" | "month" | "all";
const PERIOD_LABEL: Record<Period, string> = {
  "7d": "Ultimi 7 giorni",
  "30d": "Ultimi 30 giorni",
  month: "Questo mese",
  all: "Sempre",
};

/** Intervallo [from, to] in YYYY-MM-DD per un periodo (to = oggi). */
function periodRange(p: Period): { from?: string; to?: string } {
  if (p === "all") return {};
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const now = new Date();
  const from = new Date(now);
  if (p === "7d") from.setDate(now.getDate() - 7);
  else if (p === "30d") from.setDate(now.getDate() - 30);
  else from.setDate(1);
  return { from: iso(from), to: iso(now) };
}

/** Filtri della griglia, letti/scritti nell'URL così sopravvivono a reload e link. */
interface GridFilters {
  q: string;
  type: DocType | "";
  status: SentStatus | "";
  period: Period;
  sort: DocumentSort;
  review: boolean; // solo documenti con campi da controllare
}
const DEFAULT_FILTERS: GridFilters = { q: "", type: "", status: "", period: "all", sort: "recent", review: false };

function readFilters(sp: URLSearchParams): GridFilters {
  const pick = <T extends string>(v: string | null, allowed: readonly T[], fb: T): T =>
    v && (allowed as readonly string[]).includes(v) ? (v as T) : fb;
  return {
    q: sp.get("q") ?? "",
    type: pick(sp.get("type"), ["fattura", "preventivo", "ordine", ""] as const, ""),
    status: pick(sp.get("status"), ["da_inviare", "bozza", "inviato", ""] as const, ""),
    period: pick(sp.get("period"), ["7d", "30d", "month", "all"] as const, "all"),
    sort: pick(sp.get("sort"), ["recent", "oldest", "customer", "total"] as const, "recent"),
    review: sp.get("review") === "1",
  };
}

function toApiFilters(f: GridFilters): DocumentFilters {
  return {
    q: f.q || undefined,
    type: f.type || undefined,
    status: f.status || undefined,
    sort: f.sort,
    review: f.review ? "pending" : undefined,
    ...periodRange(f.period),
  };
}

function isFiltered(f: GridFilters): boolean {
  return Boolean(f.q || f.type || f.status || f.period !== "all" || f.review);
}

export function Dashboard() {
  const { me } = useOutletContext<{ me: Me | null }>();
  const inoltro = me?.mailMode === "inoltro";
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [docsTotal, setDocsTotal] = useState(0);
  const [docsLoading, setDocsLoading] = useState(true);
  const [processed, setProcessed] = useState<ProcessedItem[]>([]);
  const [processedTotal, setProcessedTotal] = useState(0);
  const [processedStatus, setProcessedStatus] = useState<ProcessedItem["status"] | "">("");

  // filtri nell'URL (?q=…&type=…): la fonte di verità è la query string
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = readFilters(searchParams);
  const filtersKey = searchParams.toString();
  function setFilters(patch: Partial<GridFilters>) {
    const next = { ...filters, ...patch };
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) {
      if (v && v !== DEFAULT_FILTERS[k as keyof GridFilters]) sp.set(k, v === true ? "1" : String(v));
    }
    setSearchParams(sp, { replace: true });
  }

  // la ricerca libera aggiorna l'URL con un piccolo ritardo (niente richiesta per ogni tasto)
  const [qDraft, setQDraft] = useState(filters.q);
  useEffect(() => {
    if (qDraft === filters.q) return;
    const t = setTimeout(() => setFilters({ q: qDraft }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qDraft]);
  useEffect(() => setQDraft(filters.q), [filters.q]);
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

  // ricarica dall'inizio, mantenendo però visibile tutto ciò che l'utente ha già
  // caricato con "Carica altri" (limit = quante righe sono a schermo)
  const docsShown = useRef(PAGE);
  const processedShown = useRef(PROCESSED_PAGE);
  function reload() {
    api
      .listDocuments({ ...toApiFilters(filters), limit: Math.min(100, Math.max(PAGE, docsShown.current)), offset: 0 })
      .then((p) => {
        setDocs(p.items);
        setDocsTotal(p.total);
        docsShown.current = p.items.length;
      })
      .catch(() => {})
      .finally(() => setDocsLoading(false));
    api
      .listProcessed({
        status: processedStatus || undefined,
        limit: Math.min(200, Math.max(PROCESSED_PAGE, processedShown.current)),
        offset: 0,
      })
      .then((p) => {
        setProcessed(p.items);
        setProcessedTotal(p.total);
        processedShown.current = p.items.length;
      })
      .catch(() => {});
    api.listScanHistory().then(setHistory).catch(() => {});
  }
  // cambio filtri → si riparte dalla prima pagina
  useEffect(() => {
    docsShown.current = PAGE;
    setDocsLoading(true);
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey]);
  useEffect(() => {
    processedShown.current = PROCESSED_PAGE;
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processedStatus]);

  async function loadMoreDocs() {
    const p = await api.listDocuments({ ...toApiFilters(filters), limit: PAGE, offset: docs.length }).catch(() => null);
    if (!p) return;
    setDocs((cur) => {
      const seen = new Set(cur.map((d) => d.id));
      const merged = [...cur, ...p.items.filter((d) => !seen.has(d.id))];
      docsShown.current = merged.length;
      return merged;
    });
    setDocsTotal(p.total);
  }

  async function loadMoreProcessed() {
    const p = await api
      .listProcessed({ status: processedStatus || undefined, limit: PROCESSED_PAGE, offset: processed.length })
      .catch(() => null);
    if (!p) return;
    setProcessed((cur) => {
      const seen = new Set(cur.map((r) => r.id));
      const merged = [...cur, ...p.items.filter((r) => !seen.has(r.id))];
      processedShown.current = merged.length;
      return merged;
    });
    setProcessedTotal(p.total);
  }

  // auto-refresh: polling ogni 15s SOLO a scheda visibile + refresh immediato
  // quando l'utente torna sul tab (le mail inoltrate arrivano da sole: la
  // dashboard deve mostrarle senza F5)
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(() => {
    const iv = setInterval(() => {
      if (document.visibilityState === "visible") reloadRef.current();
    }, 15_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") reloadRef.current();
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
            onClick={connectGmail}
            className="rounded-full px-5 py-2 text-sm font-medium"
            style={{ background: "var(--azzurro)", color: "var(--nero)" }}
          >
            Riautorizza con Google
          </button>
        </div>
      )}

      {/* Storico scansioni */}
      <ScanHistory history={history} onChanged={reload} />

      {/* Filtri (nascosti finché non c'è almeno un documento nell'archivio) */}
      {(docsTotal > 0 || isFiltered(filters)) && (
        <DocFilters
          filters={filters}
          qDraft={qDraft}
          onQ={setQDraft}
          onChange={setFilters}
          shown={docs.length}
          total={docsTotal}
        />
      )}

      {/* Documenti */}
      {docs.length === 0 && isFiltered(filters) && !docsLoading ? (
        <div className="mt-6 rounded-2xl border border-dashed border-border p-12 text-center">
          <Search className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-4 text-muted-foreground">Nessun documento corrisponde ai filtri.</p>
          <button
            onClick={() => {
              setQDraft("");
              setFilters(DEFAULT_FILTERS);
            }}
            className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-1.5 text-sm transition-colors hover:border-accent"
          >
            <X className="size-3.5" />
            Azzera filtri
          </button>
        </div>
      ) : docs.length === 0 && !docsLoading ? (
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
        <>
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {docs.map((d) => (
              <DocCard key={d.id} doc={d} onChanged={reload} onNeedsReauth={() => setNeedsReauth(true)} />
            ))}
          </div>
          {docs.length < docsTotal && (
            <div className="mt-6 flex justify-center">
              <button
                onClick={loadMoreDocs}
                className="rounded-full border border-border px-5 py-2 text-sm transition-colors hover:border-accent"
              >
                Carica altri ({docsTotal - docs.length} rimanenti)
              </button>
            </div>
          )}
        </>
      )}

      {/* Log mail processate */}
      {(processed.length > 0 || processedStatus) && (
        <ProcessedLog
          processed={processed}
          total={processedTotal}
          status={processedStatus}
          onStatus={setProcessedStatus}
          onMore={loadMoreProcessed}
          onChanged={reload}
        />
      )}
    </div>
  );
}

/* ───────────────── Filtri documenti ───────────────── */

const selectCls =
  "rounded-full border border-border bg-card px-3.5 py-1.5 text-sm text-foreground outline-none focus:border-accent";

function DocFilters({
  filters,
  qDraft,
  onQ,
  onChange,
  shown,
  total,
}: {
  filters: GridFilters;
  qDraft: string;
  onQ: (q: string) => void;
  onChange: (p: Partial<GridFilters>) => void;
  shown: number;
  total: number;
}) {
  return (
    <div className="mt-10 flex flex-wrap items-center gap-2">
      <label className="relative min-w-[220px] flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={qDraft}
          onChange={(e) => onQ(e.target.value)}
          placeholder="Cerca cliente, numero, oggetto…"
          className="w-full rounded-full border border-border bg-card py-1.5 pl-9 pr-3.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-accent"
        />
      </label>
      <select className={selectCls} value={filters.type} onChange={(e) => onChange({ type: e.target.value as GridFilters["type"] })}>
        <option value="">Tutti i tipi</option>
        <option value="preventivo">Preventivi</option>
        <option value="ordine">Ordini</option>
        <option value="fattura">Fatture</option>
      </select>
      <select className={selectCls} value={filters.status} onChange={(e) => onChange({ status: e.target.value as GridFilters["status"] })}>
        <option value="">Tutti gli stati</option>
        <option value="da_inviare">Da inviare</option>
        <option value="bozza">Bozza in Gmail</option>
        <option value="inviato">Inviati</option>
      </select>
      <select className={selectCls} value={filters.period} onChange={(e) => onChange({ period: e.target.value as Period })}>
        {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => (
          <option key={p} value={p}>{PERIOD_LABEL[p]}</option>
        ))}
      </select>
      <select className={selectCls} value={filters.sort} onChange={(e) => onChange({ sort: e.target.value as DocumentSort })}>
        <option value="recent">Più recenti</option>
        <option value="oldest">Più vecchi</option>
        <option value="customer">Per cliente</option>
        <option value="total">Per totale</option>
      </select>
      <button
        onClick={() => onChange({ review: !filters.review })}
        aria-pressed={filters.review}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm transition-colors",
          filters.review ? "text-foreground" : "border-border text-muted-foreground hover:text-foreground",
        )}
        style={filters.review ? { borderColor: "#e2b53f" } : undefined}
      >
        <HelpCircle className="size-4" style={{ color: "#e2b53f" }} />
        Da controllare
      </button>
      <span className="ml-auto font-mono text-xs text-muted-foreground">
        {total === 0 ? "0 documenti" : shown < total ? `${shown} di ${total}` : `${total} ${total === 1 ? "documento" : "documenti"}`}
      </span>
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

const PROCESSED_FILTERS: { value: ProcessedItem["status"] | ""; label: string }[] = [
  { value: "", label: "Tutte" },
  { value: "done", label: "OK" },
  { value: "skipped", label: "Ignorate" },
  { value: "error", label: "Errori" },
];

function ProcessedLog({
  processed,
  total,
  status,
  onStatus,
  onMore,
  onChanged,
}: {
  processed: ProcessedItem[];
  total: number;
  status: ProcessedItem["status"] | "";
  onStatus: (s: ProcessedItem["status"] | "") => void;
  onMore: () => void;
  onChanged: () => void;
}) {
  return (
    <div className="mt-14">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-mono text-sm uppercase tracking-[0.16em] text-muted-foreground">
          Mail processate
          <span className="ml-2 normal-case tracking-normal text-muted-foreground/70">
            {processed.length < total ? `${processed.length} di ${total}` : total}
          </span>
        </h2>
        <div className="flex gap-1.5">
          {PROCESSED_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => onStatus(f.value)}
              className={cn(
                "rounded-full border px-3.5 py-1 text-xs transition-colors",
                status === f.value ? "border-accent text-foreground" : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-4 overflow-hidden rounded-xl border border-border">
        {processed.map((p, i) => (
          <ProcessedRow key={p.id} p={p} first={i === 0} onChanged={onChanged} />
        ))}
        {processed.length === 0 && (
          <p className="px-4 py-3 text-sm text-muted-foreground">Nessuna mail con questo esito.</p>
        )}
      </div>
      {processed.length < total && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={onMore}
            className="rounded-full border border-border px-5 py-2 text-sm transition-colors hover:border-accent"
          >
            Carica altre ({total - processed.length} rimanenti)
          </button>
        </div>
      )}
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
            {p.status === "done" && p.document_id !== null && (
              <Link
                to={`/documents/${p.document_id}/edit`}
                className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium"
                style={{ background: "var(--azzurro)", color: "var(--nero)" }}
              >
                <FileText className="size-3.5" />
                Apri documento
              </Link>
            )}
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

  /** Annulla "inviato": torna a "bozza" se esiste una bozza Gmail, altrimenti a "da inviare". */
  async function unmarkSent() {
    await api.setStatus(doc.id, doc.draftId ? "bozza" : "da_inviare").catch(() => {});
    onChanged();
  }

  const [deleting, setDeleting] = useState(false);
  async function remove() {
    const who = d.customer_name || "questo documento";
    if (!confirm(`Eliminare ${doc.type} di ${who}? Il PDF verrà rimosso. L'operazione non si può annullare.`)) return;
    setDeleting(true);
    setCardError(null);
    try {
      await api.deleteDocument(doc.id);
      onChanged();
    } catch (e) {
      setCardError(e instanceof Error ? e.message : "Errore nell'eliminazione");
      setDeleting(false);
    }
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
          {(doc.review?.length ?? 0) > 0 && (
            <Link
              to={`/documents/${doc.id}/edit`}
              title={doc.review!.map((r) => r.reason).join("\n")}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs"
              style={{ background: "color-mix(in oklab, #e2b53f 28%, transparent)" }}
            >
              <HelpCircle className="size-3" />
              Da controllare ({doc.review!.length})
            </Link>
          )}
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
      {doc.sentStatus !== "inviato" ? (
        <button
          onClick={markSent}
          className="mt-2 inline-flex w-full items-center justify-center gap-1.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <Check className="size-3.5" />
          Segna come inviato
        </button>
      ) : (
        <button
          onClick={unmarkSent}
          title="Riporta il documento allo stato precedente"
          className="mt-2 inline-flex w-full items-center justify-center gap-1.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <Undo2 className="size-3.5" />
          Segna come non inviato
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
        <button
          onClick={remove}
          disabled={deleting}
          title="Elimina documento"
          aria-label="Elimina documento"
          className="inline-flex items-center justify-center rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:border-[var(--rosa)] hover:text-[var(--rosa)] disabled:opacity-60"
        >
          {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
        </button>
      </div>
      {doc.breweryCount === 1 && (
        <a
          href={api.xlsxUrl(doc.id)}
          className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium"
          style={{ background: "var(--azzurro)", color: "var(--nero)" }}
        >
          <FileSpreadsheet className="size-4" />
          Scarica Excel fornitore
        </a>
      )}
      {(doc.breweryCount ?? 0) >= 2 && (
        <Link
          to={`/documents/${doc.id}/sort`}
          className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium"
          style={{ background: "var(--azzurro)", color: "var(--nero)" }}
        >
          <FileSpreadsheet className="size-4" />
          Smista per fornitori
        </Link>
      )}
    </div>
  );
}
