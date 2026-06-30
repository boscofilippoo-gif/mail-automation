import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Download, Eye, FileText, RefreshCw } from "lucide-react";

import { api, type DocumentItem, type ProcessedItem, type ScanResult } from "@/api";
import { cn } from "@/lib/utils";

export function Dashboard() {
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [processed, setProcessed] = useState<ProcessedItem[]>([]);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    api.listDocuments().then(setDocs).catch(() => {});
    api.listProcessed().then(setProcessed).catch(() => {});
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

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Documenti</h1>
          <p className="mt-2 text-muted-foreground">
            I PDF generati dalle tue mail. Lo scan gira ogni giorno; puoi anche lanciarlo subito.
          </p>
        </div>
        <button
          onClick={scanNow}
          disabled={scanning}
          className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 font-medium disabled:opacity-60"
          style={{ background: "var(--azzurro)", color: "var(--nero)" }}
        >
          <RefreshCw className={cn("size-4", scanning && "animate-spin")} />
          {scanning ? "Scansione…" : "Scansiona ora"}
        </button>
      </div>

      {result && (
        <p className="mt-4 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          Scan completato — {result.created} documenti generati · {result.skipped} già visti ·{" "}
          {result.errors} errori.
        </p>
      )}
      {error && <p className="mt-4 text-sm" style={{ color: "var(--rosa)" }}>{error}</p>}

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
            <DocCard key={d.id} doc={d} />
          ))}
        </div>
      )}

      {/* Log mail processate */}
      {processed.length > 0 && (
        <div className="mt-14">
          <h2 className="text-sm font-mono uppercase tracking-[0.16em] text-muted-foreground">
            Mail processate
          </h2>
          <div className="mt-4 overflow-hidden rounded-xl border border-border">
            {processed.map((p, i) => (
              <div
                key={p.id}
                className={cn(
                  "flex items-center justify-between gap-4 px-4 py-3 text-sm",
                  i > 0 && "border-t border-border",
                )}
              >
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {p.subject || "(senza oggetto)"}
                </span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground/70">
                  {p.matched_keyword}
                </span>
                <span
                  className="shrink-0 rounded-full px-2.5 py-0.5 text-xs"
                  style={{
                    background:
                      p.status === "done"
                        ? "color-mix(in oklab, var(--azzurro) 22%, transparent)"
                        : "color-mix(in oklab, var(--rosa) 22%, transparent)",
                  }}
                  title={p.error ?? undefined}
                >
                  {p.status === "done" ? "OK" : "Errore"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DocCard({ doc }: { doc: DocumentItem }) {
  const d = doc.data;
  const accent = doc.type === "fattura" ? "var(--azzurro)" : "var(--rosa)";
  const fmt = (n: number | null) =>
    n === null
      ? "—"
      : new Intl.NumberFormat("it-IT", { style: "currency", currency: d.currency || "EUR" }).format(n);

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <span className="rounded-full px-2.5 py-0.5 text-xs capitalize" style={{ background: `color-mix(in oklab, ${accent} 22%, transparent)` }}>
          {doc.type}
        </span>
        <span className="font-mono text-xs text-muted-foreground/70">
          {new Date(doc.createdAt + "Z").toLocaleDateString("it-IT")}
        </span>
      </div>
      <h3 className="mt-4 truncate text-lg font-semibold">{d.customer_name || "Cliente non rilevato"}</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {d.line_items.length} righe · Totale {fmt(d.total)}
      </p>
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
