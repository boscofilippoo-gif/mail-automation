import { useEffect, useMemo, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import { ArrowLeft, Check, Download, FileSpreadsheet, Loader2 } from "lucide-react";

import { api, type ExtractedDocument, type Me, type SortState } from "@/api";
import { SourceMailSection } from "@/components/SourceMailSection";

const UNASSIGNED = "__unassigned__";

/**
 * Schermata di smistamento: la mail dell'ordine + i prodotti raggruppati per
 * fornitore (Excel di destinazione). L'utente sposta i prodotti tra i gruppi,
 * corregge le quantità e i non-riconosciuti, poi conferma e scarica gli Excel.
 */
export function SortDocument() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { me } = useOutletContext<{ me: Me | null }>();
  const inoltro = me?.mailMode === "inoltro";
  const docId = Number(id);

  const [data, setData] = useState<ExtractedDocument | null>(null);
  const [templates, setTemplates] = useState<{ breweryKey: string; name: string }[]>([]);
  // assegnazione corrente: itemIndex → breweryKey (o UNASSIGNED)
  const [assign, setAssign] = useState<Record<number, string>>({});
  const [sourceMessageId, setSourceMessageId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSort(docId)
      .then((s: SortState) => {
        setData(s.data);
        setTemplates(s.templates);
        const a: Record<number, string> = {};
        s.data.line_items.forEach((_, i) => (a[i] = UNASSIGNED));
        for (const x of s.assignments) a[x.itemIndex] = x.breweryKey;
        setAssign(a);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Errore"))
      .finally(() => setLoading(false));
    api.getDocument(docId).then((d) => setSourceMessageId(d.sourceMessageId ?? null)).catch(() => {});
  }, [docId]);

  /** Sposta un prodotto in un fornitore (o tra i non assegnati). */
  function move(itemIndex: number, breweryKey: string) {
    setSaved(false);
    setAssign((prev) => ({ ...prev, [itemIndex]: breweryKey }));
  }

  /** Corregge la quantità di una riga d'ordine. */
  function setQty(itemIndex: number, qty: number) {
    setSaved(false);
    setData((prev) =>
      prev
        ? {
            ...prev,
            line_items: prev.line_items.map((li, i) => (i === itemIndex ? { ...li, quantity: qty } : li)),
          }
        : prev,
    );
  }

  /** Salva lo smistamento (assegnazioni + quantità corrette). */
  async function confirm() {
    if (!data) return;
    setSaving(true);
    setError(null);
    try {
      const assignments = Object.entries(assign)
        .filter(([, key]) => key !== UNASSIGNED)
        .map(([i, key]) => ({ itemIndex: Number(i), breweryKey: key, row: 0 })); // row la ricalcola il server
      await api.saveSort(docId, assignments, data);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Salvataggio non riuscito");
    } finally {
      setSaving(false);
    }
  }

  // raggruppa gli itemIndex per fornitore (+ gruppo non assegnati)
  const groups = useMemo(() => {
    const g = new Map<string, number[]>();
    for (const t of templates) g.set(t.breweryKey, []);
    g.set(UNASSIGNED, []);
    Object.entries(assign).forEach(([i, key]) => {
      const idx = Number(i);
      (g.get(key) ?? g.get(UNASSIGNED)!).push(idx);
    });
    return g;
  }, [assign, templates]);

  if (loading) return <p className="text-muted-foreground">Caricamento…</p>;
  if (!data) return <p style={{ color: "var(--rosa)" }}>{error ?? "Documento non disponibile."}</p>;

  const unassignedCount = groups.get(UNASSIGNED)?.length ?? 0;

  return (
    <div>
      <button
        onClick={() => navigate("/dashboard")}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Torna ai documenti
      </button>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Smista l'ordine tra i fornitori</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Controlla dove va ogni prodotto. Sposta le righe tra i fornitori, correggi le quantità
            se serve, poi conferma e scarica gli Excel pronti da inviare.
          </p>
        </div>
        <button
          onClick={confirm}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 font-medium disabled:opacity-60"
          style={{ background: "var(--azzurro)", color: "var(--nero)" }}
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : saved ? <Check className="size-4" /> : null}
          {saving ? "Salvataggio…" : saved ? "Salvato" : "Conferma smistamento"}
        </button>
      </div>
      {error && <p className="mt-3 text-sm" style={{ color: "var(--rosa)" }}>{error}</p>}

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[380px_1fr]">
        {/* colonna sinistra: mail originale */}
        <div className="lg:sticky lg:top-24 lg:self-start">
          <SourceMailSection
            docId={docId}
            sourceMessageId={sourceMessageId}
            showGmailLink={!inoltro}
            defaultOpen
          />
        </div>

        {/* colonna destra: gruppi per fornitore + non assegnati */}
        <div className="space-y-5">
          {templates.map((t) => {
            const items = groups.get(t.breweryKey) ?? [];
            return (
              <div key={t.breweryKey} className="rounded-2xl border border-border bg-card p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="flex items-center gap-2 font-semibold">
                    <FileSpreadsheet className="size-4" style={{ color: "var(--azzurro)" }} />
                    {t.name}
                    <span className="text-sm font-normal text-muted-foreground">
                      · {items.length} {items.length === 1 ? "prodotto" : "prodotti"}
                    </span>
                  </h2>
                  {items.length > 0 && saved && (
                    <a
                      href={api.xlsxUrlFor(docId, t.breweryKey)}
                      className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium"
                      style={{ background: "var(--azzurro)", color: "var(--nero)" }}
                    >
                      <Download className="size-3.5" />
                      Scarica Excel
                    </a>
                  )}
                </div>
                {items.length === 0 ? (
                  <p className="mt-3 text-sm text-muted-foreground">Nessun prodotto assegnato a questo fornitore.</p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {items.map((i) => (
                      <ProductRow
                        key={i}
                        idx={i}
                        item={data.line_items[i]!}
                        currentKey={t.breweryKey}
                        templates={templates}
                        onMove={move}
                        onQty={setQty}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* non assegnati */}
          <div
            className="rounded-2xl border p-5"
            style={{ borderColor: unassignedCount ? "var(--rosa)" : "var(--border)" }}
          >
            <h2 className="font-semibold">
              Da assegnare
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {unassignedCount === 0 ? "· tutto smistato ✓" : `· ${unassignedCount} senza fornitore`}
              </span>
            </h2>
            {unassignedCount > 0 && (
              <div className="mt-3 space-y-2">
                {(groups.get(UNASSIGNED) ?? []).map((i) => (
                  <ProductRow
                    key={i}
                    idx={i}
                    item={data.line_items[i]!}
                    currentKey={UNASSIGNED}
                    templates={templates}
                    onMove={move}
                    onQty={setQty}
                  />
                ))}
              </div>
            )}
          </div>

          {!saved && (
            <p className="text-xs text-muted-foreground">
              💡 I bottoni "Scarica Excel" compaiono dopo aver premuto <strong>Conferma smistamento</strong>.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Vuoi dividere una quantità tra due fornitori? Sdoppia la riga nell'{" "}
            <button
              onClick={() => navigate(`/documents/${docId}/edit`)}
              className="underline decoration-dotted underline-offset-4 hover:text-foreground"
            >
              editor del documento
            </button>
            , poi torna qui.
          </p>
        </div>
      </div>
    </div>
  );
}

const rowNameOf = (key: string, templates: { breweryKey: string; name: string }[]) =>
  templates.find((t) => t.breweryKey === key)?.name ?? key;

/** Una riga prodotto: descrizione, quantità editabile, selettore fornitore. */
function ProductRow({
  idx,
  item,
  currentKey,
  templates,
  onMove,
  onQty,
}: {
  idx: number;
  item: { description: string; quantity: number };
  currentKey: string;
  templates: { breweryKey: string; name: string }[];
  onMove: (i: number, key: string) => void;
  onQty: (i: number, qty: number) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 rounded-xl border border-border bg-background/40 p-3 sm:grid-cols-[1fr_auto_auto] sm:items-center">
      <span className="truncate text-sm" title={item.description}>
        {item.description}
      </span>
      <input
        type="number"
        min={0}
        value={item.quantity}
        onChange={(e) => onQty(idx, Number(e.target.value) || 0)}
        className="w-20 rounded-lg border border-border bg-card px-2 py-1 text-sm outline-none focus:border-accent"
        aria-label="Quantità"
      />
      <select
        value={currentKey}
        onChange={(e) => onMove(idx, e.target.value)}
        className="rounded-lg border border-border bg-card px-2 py-1 text-sm outline-none focus:border-accent"
        aria-label="Fornitore"
      >
        {templates.map((t) => (
          <option key={t.breweryKey} value={t.breweryKey}>
            {rowNameOf(t.breweryKey, templates)}
          </option>
        ))}
        <option value={UNASSIGNED}>— da assegnare —</option>
      </select>
    </div>
  );
}
