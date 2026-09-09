import { useEffect, useRef, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, HelpCircle, Loader2, Plus, RotateCcw, Send, Trash2 } from "lucide-react";

import { api, type ExtractedDocument, type LineItem, type Me, type ReviewFlag } from "@/api";
import { cn } from "@/lib/utils";
import { SourceMailSection } from "@/components/SourceMailSection";
import { toast } from "@/components/Toast";
import { PreviewFrame } from "@/components/PreviewFrame";

const inputCls =
  "w-full rounded-xl border border-border bg-card px-3.5 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/50 focus:border-accent";

/** Giallo "da controllare": non è nella palette, definito qui una volta sola. */
const WARN = "#e2b53f";

const FIELD_LABEL: Record<string, string> = {
  customer_name: "Nome cliente",
  customer_email: "Email cliente",
  customer_vat: "P.IVA / CF",
  customer_address: "Indirizzo",
  document_number: "Numero documento",
  document_date: "Data",
  currency: "Valuta",
  subtotal: "Imponibile",
  tax: "Imposta",
  total: "Totale",
  notes: "Note",
  description: "descrizione",
  quantity: "quantità",
  unit_price: "prezzo",
};

/** "line_items[2].quantity" → "Riga 3, quantità"; "customer_vat" → "P.IVA / CF". */
function fieldLabel(field: string): string {
  const m = field.match(/^line_items\[(\d+)\]\.(\w+)$/);
  if (m) return `Riga ${Number(m[1]) + 1}, ${FIELD_LABEL[m[2]!] ?? m[2]}`;
  return FIELD_LABEL[field] ?? field;
}

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
  const { me } = useOutletContext<{ me: Me | null }>();
  const inoltro = me?.mailMode === "inoltro";
  const [draft, setDraft] = useState<ExtractedDocument | null>(null);
  const [docType, setDocType] = useState<string>("");
  const [sourceMessageId, setSourceMessageId] = useState<string | null>(null);
  // estrazione AI originale: presente solo se il documento è già stato modificato a mano
  const [original, setOriginal] = useState<ExtractedDocument | null>(null);
  // campi incerti dichiarati dall'AI (si azzerano lato server al salvataggio)
  const [review, setReview] = useState<ReviewFlag[]>([]);
  /** Motivo del dubbio per un campo, o undefined se l'AI era sicura. */
  const doubt = (field: string) => review.find((r) => r.field === field)?.reason;
  /** Classi + stile per evidenziare un input incerto (bordo giallo). */
  const warn = (field: string) => (doubt(field) ? { style: { borderColor: WARN }, title: doubt(field) } : {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getDocument(Number(id))
      .then((d) => {
        setDraft(recalc(d.data));
        setDocType(d.type);
        setSourceMessageId(d.sourceMessageId ?? null);
        setOriginal(d.originalData ?? null);
        setReview(d.review ?? []);
      })
      .catch((e) => setError(e.message));
  }, [id]);

  /** Riporta il form all'estrazione AI originale (va comunque salvato per rigenerare il PDF). */
  function restoreOriginal() {
    if (!original) return;
    if (!confirm("Ripristinare i dati estratti dall'AI? Le modifiche manuali verranno sostituite nel form (poi premi Salva).")) return;
    setDraft(recalc(original));
  }

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

  /** Salva e resta in pagina: il server ha già azzerato i dubbi e congelato l'originale. */
  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await api.updateDocument(Number(id), draft);
      setDraft(recalc(saved.data));
      setReview([]);
      // il server ha congelato l'estrazione originale al primo salvataggio: rileggila
      if (!original) {
        api.getDocument(Number(id)).then((fresh) => setOriginal(fresh.originalData ?? null)).catch(() => {});
      }
      toast.success("Salvato: PDF aggiornato");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore nel salvataggio");
      toast.error("Salvataggio non riuscito");
    } finally {
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
      setReview([]);
      const r = await api.createDraft(Number(id));
      if ("error" in r) {
        setError(r.needsReauth ? "Servono nuovi permessi Google: torna alla dashboard e premi 'Riautorizza con Google'." : r.error);
      } else {
        toast.success("Salvato e bozza creata in Gmail");
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
          {original && (
            <button
              onClick={restoreOriginal}
              disabled={saving || drafting}
              title="Torna ai dati estratti dall'AI prima delle modifiche manuali"
              className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-2.5 text-sm text-muted-foreground transition-colors hover:border-accent hover:text-foreground disabled:opacity-60"
            >
              <RotateCcw className="size-4" />
              Ripristina originale
            </button>
          )}
          {!inoltro && (
            <button
              onClick={saveAndDraft}
              disabled={saving || drafting}
              className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-2.5 font-medium transition-colors hover:border-accent disabled:opacity-60"
            >
              {drafting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {drafting ? "Preparo la bozza…" : "Salva e prepara risposta"}
            </button>
          )}
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
      {review.length > 0 && (
        <div className="mt-4 rounded-xl border px-4 py-3 text-sm" style={{ borderColor: WARN }}>
          <p className="flex items-center gap-2 font-medium">
            <HelpCircle className="size-4 shrink-0" style={{ color: WARN }} />
            {review.length === 1 ? "L'AI non era sicura su 1 campo" : `L'AI non era sicura su ${review.length} campi`}
            <span className="font-normal text-muted-foreground">— evidenziati in giallo qui sotto. Salvando confermi di averli controllati.</span>
          </p>
          <ul className="mt-2 space-y-1 pl-6 text-muted-foreground">
            {review.map((r) => (
              <li key={r.field}>
                <span className="text-foreground">{fieldLabel(r.field)}</span>: {r.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {missingPrices > 0 && (
        <p className="mt-4 inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm" style={{ borderColor: "var(--rosa)" }}>
          <AlertTriangle className="size-4" style={{ color: "var(--rosa)" }} />
          {missingPrices === 1 ? "1 riga è senza prezzo" : `${missingPrices} righe sono senza prezzo`} — completala prima di inviare il documento.
        </p>
      )}

      <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-[1fr_420px]">
        <div className="space-y-8">
          <SourceMailSection docId={Number(id)} sourceMessageId={sourceMessageId} showGmailLink={!inoltro} />

          {/* Cliente */}
          <section>
            <h2 className="font-mono text-[0.8rem] uppercase tracking-[0.12em] text-muted-foreground">Destinatario</h2>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input className={inputCls} {...warn("customer_name")} placeholder="Nome cliente" value={draft.customer_name} onChange={(e) => patch({ customer_name: e.target.value })} />
              <input className={inputCls} {...warn("customer_vat")} placeholder="P.IVA / CF" value={draft.customer_vat ?? ""} onChange={(e) => patch({ customer_vat: e.target.value || null })} />
              <input className={cn(inputCls, "sm:col-span-2")} {...warn("customer_address")} placeholder="Indirizzo" value={draft.customer_address ?? ""} onChange={(e) => patch({ customer_address: e.target.value || null })} />
              <input className={inputCls} {...warn("customer_email")} placeholder="Email" value={draft.customer_email ?? ""} onChange={(e) => patch({ customer_email: e.target.value || null })} />
            </div>
          </section>

          {/* Meta */}
          <section>
            <h2 className="font-mono text-[0.8rem] uppercase tracking-[0.12em] text-muted-foreground">Documento</h2>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <input className={inputCls} {...warn("document_number")} placeholder="Numero (es. 2026-001)" value={draft.document_number ?? ""} onChange={(e) => patch({ document_number: e.target.value || null })} />
              <input className={inputCls} {...warn("document_date")} type="date" value={draft.document_date ?? ""} onChange={(e) => patch({ document_date: e.target.value || null })} />
              <input className={inputCls} {...warn("currency")} placeholder="Valuta" value={draft.currency} onChange={(e) => patch({ currency: e.target.value.toUpperCase() })} />
            </div>
          </section>

          {/* Righe */}
          <section>
            <div className="flex items-center justify-between">
              <h2 className="font-mono text-[0.8rem] uppercase tracking-[0.12em] text-muted-foreground">Righe</h2>
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
                    // mobile: descrizione + cestino sulla prima riga, q.tà/prezzo/totale sotto;
                    // da sm: tutto su una riga a colonne fisse
                    "grid grid-cols-[1fr_32px] gap-2 rounded-xl border p-2 sm:grid-cols-[1fr_72px_110px_100px_32px] sm:items-center",
                    li.unit_price === null ? "border-[color:var(--rosa)]" : "border-border",
                  )}
                >
                  <input className={inputCls} {...warn(`line_items[${i}].description`)} placeholder="Descrizione" value={li.description} onChange={(e) => patchItem(i, { description: e.target.value })} />
                  <div className="col-span-2 grid grid-cols-3 gap-2 sm:contents">
                    <label className="block sm:contents">
                      <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground sm:hidden">Q.tà</span>
                      <input
                        className={cn(inputCls, "text-right")}
                        inputMode="decimal"
                        title="Quantità"
                        {...warn(`line_items[${i}].quantity`)}
                        value={String(li.quantity)}
                        onChange={(e) => patchItem(i, { quantity: parseNum(e.target.value) ?? 0 })}
                      />
                    </label>
                    <label className="block sm:contents">
                      <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground sm:hidden">Prezzo</span>
                      <input
                        className={cn(inputCls, "text-right", li.unit_price === null && "placeholder:text-[color:var(--rosa)]")}
                        inputMode="decimal"
                        placeholder="mancante"
                        title="Prezzo unitario"
                        {...warn(`line_items[${i}].unit_price`)}
                        value={li.unit_price === null ? "" : String(li.unit_price)}
                        onChange={(e) => patchItem(i, { unit_price: parseNum(e.target.value) })}
                      />
                    </label>
                    <span className="block sm:contents">
                      <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground sm:hidden">Totale</span>
                      <span className="block py-2 text-right text-sm text-muted-foreground">{fmt(li.total)}</span>
                    </span>
                  </div>
                  <button
                    onClick={() => patch({ line_items: draft.line_items.filter((_, j) => j !== i) })}
                    aria-label="Elimina riga"
                    className="col-start-2 row-start-1 justify-self-end rounded-full p-1.5 text-muted-foreground transition-colors hover:text-foreground sm:col-start-auto sm:row-start-auto"
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
                {...warn("tax")}
                value={draft.tax === null ? "" : String(draft.tax)}
                onChange={(e) => patch({ tax: parseNum(e.target.value) })}
              />
            </div>
            <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
              <span>Totale</span>
              <span title={doubt("total") ?? doubt("subtotal")} style={doubt("total") || doubt("subtotal") ? { color: WARN } : undefined}>{fmt(draft.total)}</span>
            </div>
          </section>

          {/* Note */}
          <section>
            <h2 className="font-mono text-[0.8rem] uppercase tracking-[0.12em] text-muted-foreground">Note</h2>
            <textarea
              className={cn(inputCls, "mt-3")}
              rows={3}
              placeholder="Condizioni, validità, articoli da confermare…"
              {...warn("notes")}
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

  return <PreviewFrame html={html} loading={loading} />;
}
