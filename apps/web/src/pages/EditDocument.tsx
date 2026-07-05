import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, ChevronDown, ExternalLink, Loader2, Mail, Plus, Send, Trash2 } from "lucide-react";

import { api, gmailUrl, type ExtractedDocument, type LineItem, type SourceMail } from "@/api";
import { cn } from "@/lib/utils";

const inputCls =
  "w-full rounded-xl border border-border bg-card px-3.5 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/50 focus:border-accent";

/** Ricalcola i totali derivati: riga = qty×prezzo, subtotale = somma non-null, totale = sub+tax. */
function recalc(doc: ExtractedDocument): ExtractedDocument {
  const line_items = doc.line_items.map((li) => ({
    ...li,
    total: li.unit_price === null ? null : Math.round(li.quantity * li.unit_price * 100) / 100,
  }));
  const totals = line_items.map((li) => li.total).filter((t): t is number => t !== null);
  const subtotal = totals.length ? Math.round(totals.reduce((a, b) => a + b, 0) * 100) / 100 : null;
  const total = subtotal === null ? null : Math.round((subtotal + (doc.tax ?? 0)) * 100) / 100;
  return { ...doc, line_items, subtotal, total };
}

/** Parsing numerico tollerante alla virgola italiana ("12,5" → 12.5). */
function parseNum(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function EditDocument() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<ExtractedDocument | null>(null);
  const [docType, setDocType] = useState<string>("");
  const [sourceMessageId, setSourceMessageId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getDocument(Number(id))
      .then((d) => {
        setDraft(recalc(d.data));
        setDocType(d.type);
        setSourceMessageId(d.sourceMessageId ?? null);
      })
      .catch((e) => setError(e.message));
  }, [id]);

  function patch(p: Partial<ExtractedDocument>) {
    setDraft((d) => (d ? recalc({ ...d, ...p }) : d));
  }

  function patchItem(i: number, p: Partial<LineItem>) {
    setDraft((d) => {
      if (!d) return d;
      const items = d.line_items.map((li, j) => (j === i ? { ...li, ...p } : li));
      return recalc({ ...d, line_items: items });
    });
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      await api.updateDocument(Number(id), draft);
      navigate("/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore nel salvataggio");
      setSaving(false);
    }
  }

  const [drafting, setDrafting] = useState(false);
  /** Salva le modifiche correnti e crea la bozza di risposta in Gmail. */
  async function saveAndDraft() {
    if (!draft) return;
    setDrafting(true);
    setError(null);
    try {
      await api.updateDocument(Number(id), draft);
      const r = await api.createDraft(Number(id));
      if ("error" in r) {
        setError(r.needsReauth ? "Servono nuovi permessi Google: torna alla dashboard e premi 'Riautorizza con Google'." : r.error);
      } else {
        navigate("/dashboard");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore nella creazione della bozza");
    } finally {
      setDrafting(false);
    }
  }

  if (!draft) return <p className="text-muted-foreground">{error ?? "Caricamento…"}</p>;

  const fmt = (n: number | null) =>
    n === null
      ? "—"
      : new Intl.NumberFormat("it-IT", { style: "currency", currency: draft.currency || "EUR" }).format(n);
  const missingPrices = draft.line_items.filter((li) => li.unit_price === null).length;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <button
            onClick={() => navigate("/dashboard")}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Documenti
          </button>
          <h1 className="mt-2 flex items-center gap-3 text-2xl font-semibold tracking-tight">
            Modifica documento
            <span
              className="rounded-full px-2.5 py-0.5 text-xs font-normal capitalize"
              style={{ background: `color-mix(in oklab, ${docType === "fattura" ? "var(--azzurro)" : "var(--rosa)"} 22%, transparent)` }}
            >
              {docType}
            </span>
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={saveAndDraft}
            disabled={saving || drafting}
            className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-2.5 font-medium transition-colors hover:border-accent disabled:opacity-60"
          >
            {drafting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {drafting ? "Preparo la bozza…" : "Salva e prepara risposta"}
          </button>
          <button
            onClick={save}
            disabled={saving || drafting}
            className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 font-medium disabled:opacity-60"
            style={{ background: "var(--azzurro)", color: "var(--nero)" }}
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            {saving ? "Salvataggio e rigenerazione PDF…" : "Salva e rigenera PDF"}
          </button>
        </div>
      </div>
      {error && <p className="mt-3 text-sm" style={{ color: "var(--rosa)" }}>{error}</p>}
      {missingPrices > 0 && (
        <p className="mt-4 inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm" style={{ borderColor: "var(--rosa)" }}>
          <AlertTriangle className="size-4" style={{ color: "var(--rosa)" }} />
          {missingPrices === 1 ? "1 riga è senza prezzo" : `${missingPrices} righe sono senza prezzo`} — completala prima di inviare il documento.
        </p>
      )}

      <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-[1fr_420px]">
        <div className="space-y-8">
          <SourceMailSection docId={Number(id)} sourceMessageId={sourceMessageId} />

          {/* Cliente */}
          <section>
            <h2 className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">Destinatario</h2>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input className={inputCls} placeholder="Nome cliente" value={draft.customer_name} onChange={(e) => patch({ customer_name: e.target.value })} />
              <input className={inputCls} placeholder="P.IVA / CF" value={draft.customer_vat ?? ""} onChange={(e) => patch({ customer_vat: e.target.value || null })} />
              <input className={cn(inputCls, "sm:col-span-2")} placeholder="Indirizzo" value={draft.customer_address ?? ""} onChange={(e) => patch({ customer_address: e.target.value || null })} />
              <input className={inputCls} placeholder="Email" value={draft.customer_email ?? ""} onChange={(e) => patch({ customer_email: e.target.value || null })} />
            </div>
          </section>

          {/* Meta */}
          <section>
            <h2 className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">Documento</h2>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <input className={inputCls} placeholder="Numero (es. 2026-001)" value={draft.document_number ?? ""} onChange={(e) => patch({ document_number: e.target.value || null })} />
              <input className={inputCls} type="date" value={draft.document_date ?? ""} onChange={(e) => patch({ document_date: e.target.value || null })} />
              <input className={inputCls} placeholder="Valuta" value={draft.currency} onChange={(e) => patch({ currency: e.target.value.toUpperCase() })} />
            </div>
          </section>

          {/* Righe */}
          <section>
            <div className="flex items-center justify-between">
              <h2 className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">Righe</h2>
              <button
                onClick={() => patch({ line_items: [...draft.line_items, { description: "", quantity: 1, unit_price: null, total: null }] })}
                className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs transition-colors hover:border-accent"
              >
                <Plus className="size-3.5" />
                Aggiungi riga
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {draft.line_items.map((li, i) => (
                <div
                  key={i}
                  className={cn(
                    "grid grid-cols-[1fr_72px_110px_100px_32px] items-center gap-2 rounded-xl border p-2",
                    li.unit_price === null ? "border-[color:var(--rosa)]" : "border-border",
                  )}
                >
                  <input className={inputCls} placeholder="Descrizione" value={li.description} onChange={(e) => patchItem(i, { description: e.target.value })} />
                  <input
                    className={cn(inputCls, "text-right")}
                    inputMode="decimal"
                    title="Quantità"
                    value={String(li.quantity)}
                    onChange={(e) => patchItem(i, { quantity: parseNum(e.target.value) ?? 0 })}
                  />
                  <input
                    className={cn(inputCls, "text-right", li.unit_price === null && "placeholder:text-[color:var(--rosa)]")}
                    inputMode="decimal"
                    placeholder="prezzo mancante"
                    title="Prezzo unitario"
                    value={li.unit_price === null ? "" : String(li.unit_price)}
                    onChange={(e) => patchItem(i, { unit_price: parseNum(e.target.value) })}
                  />
                  <span className="text-right text-sm text-muted-foreground">{fmt(li.total)}</span>
                  <button
                    onClick={() => patch({ line_items: draft.line_items.filter((_, j) => j !== i) })}
                    aria-label="Elimina riga"
                    className="rounded-full p-1.5 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* Totali */}
          <section className="ml-auto w-full max-w-xs space-y-2 text-sm">
            <div className="flex justify-between text-muted-foreground"><span>Imponibile</span><span>{fmt(draft.subtotal)}</span></div>
            <div className="flex items-center justify-between gap-3 text-muted-foreground">
              <span>Imposta</span>
              <input
                className={cn(inputCls, "w-28 text-right")}
                inputMode="decimal"
                placeholder="0"
                value={draft.tax === null ? "" : String(draft.tax)}
                onChange={(e) => patch({ tax: parseNum(e.target.value) })}
              />
            </div>
            <div className="flex justify-between border-t border-border pt-2 text-base font-semibold"><span>Totale</span><span>{fmt(draft.total)}</span></div>
          </section>

          {/* Note */}
          <section>
            <h2 className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">Note</h2>
            <textarea
              className={cn(inputCls, "mt-3")}
              rows={3}
              placeholder="Condizioni, validità, articoli da confermare…"
              value={draft.notes ?? ""}
              onChange={(e) => patch({ notes: e.target.value || null })}
            />
          </section>
        </div>

        <EditPreview draft={draft} />
      </div>
    </div>
  );
}

/** Mail originale del cliente: collassabile, caricata da Gmail solo al primo click. */
function SourceMailSection({ docId, sourceMessageId }: { docId: number; sourceMessageId: string | null }) {
  const [open, setOpen] = useState(false);
  const [mail, setMail] = useState<SourceMail | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !mail && state !== "loading") {
      setState("loading");
      try {
        setMail(await api.getSource(docId));
        setState("idle");
      } catch {
        setState("error");
      }
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-card">
      <button
        onClick={toggle}
        className="flex w-full items-center justify-between px-5 py-3.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <span className="inline-flex items-center gap-2">
          <Mail className="size-4" style={{ color: "var(--azzurro)" }} />
          Mail originale del cliente
        </span>
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="border-t border-border px-5 py-4 text-sm">
          {state === "loading" && <p className="text-muted-foreground">Caricamento…</p>}
          {state === "error" && (
            <p style={{ color: "var(--rosa)" }}>Mail originale non trovata (eliminata da Gmail?).</p>
          )}
          {mail && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{mail.subject || "(senza oggetto)"}</p>
                {sourceMessageId && (
                  <a
                    href={gmailUrl(sourceMessageId)}
                    target="_blank"
                    rel="noopener"
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-accent hover:text-foreground"
                  >
                    <ExternalLink className="size-3" />
                    Apri in Gmail
                  </a>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {mail.from} · {mail.date}
              </p>
              {/* testo puro, mai HTML: bodyText è già estratto come plain text */}
              <pre className="mt-3 max-h-64 overflow-y-auto whitespace-pre-wrap font-sans text-sm leading-relaxed text-muted-foreground">
                {mail.bodyText || "(corpo vuoto)"}
              </pre>
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** Anteprima live del documento in modifica (stesso pattern delle Impostazioni). */
function EditPreview({ draft }: { draft: ExtractedDocument }) {
  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  useEffect(() => {
    const mySeq = ++seq.current;
    setLoading(true);
    const t = setTimeout(() => {
      api
        .previewDocument(draft)
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
    </div>
  );
}
