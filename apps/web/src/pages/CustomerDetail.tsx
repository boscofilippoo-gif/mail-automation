import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Check, Eye, GitMerge, HelpCircle, Loader2, Pencil, Trash2 } from "lucide-react";

import { api, type Customer, type CustomerDetail as Detail, type CustomerDocument, type DocType } from "@/api";
import { cn } from "@/lib/utils";
import { toast } from "@/components/Toast";

const inputCls =
  "w-full rounded-xl border border-border bg-card px-3.5 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/50 focus:border-accent";
const DOC_LABEL: Record<DocType, string> = { preventivo: "Preventivi", ordine: "Ordini", fattura: "Fatture" };
const STATUS_LABEL = { da_inviare: "Da inviare", bozza: "Bozza in Gmail", inviato: "Inviato" } as const;
const eur = (n: number | null, c = "EUR") =>
  n === null ? "—" : new Intl.NumberFormat("it-IT", { style: "currency", currency: c }).format(n);

/** La "cartella" del cliente: anagrafica correggibile, i tre numeri, tutti i suoi documenti. */
export function CustomerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Pick<Customer, "name" | "vat" | "email" | "address" | "notes"> | null>(null);
  const [saving, setSaving] = useState(false);

  function load() {
    api.getCustomer(Number(id))
      .then((d) => { setDetail(d); setForm({ name: d.customer.name, vat: d.customer.vat, email: d.customer.email, address: d.customer.address, notes: d.customer.notes }); })
      .catch((e) => setError(e.message));
  }
  useEffect(load, [id]);

  async function save() {
    if (!form) return;
    setSaving(true);
    try {
      await api.updateCustomer(Number(id), form);
      toast.success("Scheda aggiornata: i prossimi documenti useranno questi dati");
      setEditing(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore nel salvataggio");
    } finally {
      setSaving(false);
    }
  }

  if (error) return <p className="text-muted-foreground">{error}</p>;
  if (!detail || !form) return <p className="text-muted-foreground">Caricamento…</p>;
  const c = detail.customer;
  const byType = (t: DocType) => detail.documents.filter((d) => d.type === t);

  return (
    <div>
      <button onClick={() => navigate("/customers")} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="size-4" /> Clienti
      </button>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
              <input className={cn(inputCls, "sm:col-span-2 text-lg font-semibold")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nome cliente" />
              <input className={inputCls} value={form.vat ?? ""} onChange={(e) => setForm({ ...form, vat: e.target.value || null })} placeholder="P.IVA / CF" />
              <input className={inputCls} value={form.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value || null })} placeholder="Email" />
              <input className={cn(inputCls, "sm:col-span-2")} value={form.address ?? ""} onChange={(e) => setForm({ ...form, address: e.target.value || null })} placeholder="Indirizzo" />
              <textarea className={cn(inputCls, "sm:col-span-2")} rows={2} value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value || null })} placeholder="Note interne (non finiscono nei documenti)" />
            </div>
          ) : (
            <>
              <h1 className="truncate text-2xl font-semibold tracking-tight">{c.name}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {[c.vat && `P.IVA ${c.vat}`, c.email, c.address].filter(Boolean).join(" · ") || "Nessun dato anagrafico: aggiungilo con Modifica."}
              </p>
              {c.notes && <p className="mt-2 max-w-2xl whitespace-pre-line text-sm text-muted-foreground/80">{c.notes}</p>}
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {editing ? (
            <>
              <button onClick={() => { setEditing(false); load(); }} className="rounded-full border border-border px-4 py-2 text-sm">Annulla</button>
              <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-medium disabled:opacity-60" style={{ background: "var(--azzurro)", color: "var(--nero)" }}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Salva
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setEditing(true)} className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm transition-colors hover:border-accent">
                <Pencil className="size-4" /> Modifica
              </button>
              <MergeButton customer={c} onMerged={(into) => navigate(`/customers/${into}`)} />
              {c.doc_count === 0 && <DeleteButton id={c.id} onDeleted={() => navigate("/customers")} />}
            </>
          )}
        </div>
      </div>

      {/* i tre numeri */}
      <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Preventivi" n={c.n_preventivo} sum={c.sum_preventivo} accent="var(--rosa)" />
        <StatCard label="Ordini" n={c.n_ordine} sum={c.sum_ordine} accent="var(--rosa)" />
        <StatCard label="Fatture" n={c.n_fattura} sum={c.sum_fattura} accent="var(--azzurro)" strong />
      </div>

      {/* documenti per tipo */}
      {detail.documents.length === 0 ? (
        <p className="mt-10 text-muted-foreground">Nessun documento agganciato a questa scheda.</p>
      ) : (
        (["fattura", "ordine", "preventivo"] as DocType[]).map((t) => {
          const docs = byType(t);
          if (docs.length === 0) return null;
          return (
            <section key={t} className="mt-10">
              <h2 className="font-mono text-[0.8rem] uppercase tracking-[0.12em] text-muted-foreground">
                {DOC_LABEL[t]} <span className="normal-case tracking-normal text-muted-foreground/70">· {docs.length}</span>
              </h2>
              <div className="mt-3 overflow-hidden rounded-2xl border border-border">
                {docs.map((d, i) => <DocRow key={d.id} d={d} first={i === 0} />)}
              </div>
            </section>
          );
        })
      )}
      {detail.documentsTotal > detail.documents.length && (
        <p className="mt-4 text-sm text-muted-foreground">
          Mostrati {detail.documents.length} di {detail.documentsTotal} documenti. Per l'archivio completo usa i filtri della{" "}
          <Link to="/dashboard" className="underline decoration-dotted underline-offset-4">dashboard</Link>.
        </p>
      )}
    </div>
  );
}

function StatCard({ label, n, sum, accent, strong }: { label: string; n: number; sum: number; accent: string; strong?: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("mt-2 text-2xl tracking-tight", strong ? "font-semibold" : "font-medium")} style={n ? { color: accent } : undefined}>
        {n === 0 ? "—" : eur(sum)}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{n === 0 ? "nessun documento" : `${n} ${n === 1 ? "documento" : "documenti"}`}</p>
    </div>
  );
}

function DocRow({ d, first }: { d: CustomerDocument; first: boolean }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm", !first && "border-t border-border/60")}>
      <span className="font-mono text-xs text-muted-foreground">{new Date(d.createdAt + "Z").toLocaleDateString("it-IT")}</span>
      <span className="min-w-0 flex-1 truncate">
        {d.documentNumber ? <span className="font-medium">N. {d.documentNumber}</span> : <span className="text-muted-foreground">senza numero</span>}
        {d.subject && <span className="text-muted-foreground"> · {d.subject}</span>}
      </span>
      {d.review > 0 && (
        <Link to={`/documents/${d.id}/edit`} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs" style={{ background: "color-mix(in oklab, #e2b53f 28%, transparent)" }}>
          <HelpCircle className="size-3" /> {d.review} da controllare
        </Link>
      )}
      <span className="rounded-full px-2.5 py-0.5 text-xs" style={{ background: "color-mix(in oklab, var(--foreground) 10%, transparent)" }}>
        {STATUS_LABEL[d.sentStatus]}
      </span>
      <span className="w-28 text-right font-medium">{eur(d.total, d.currency)}</span>
      <span className="flex gap-1">
        <a href={api.pdfUrl(d.id)} target="_blank" rel="noopener" title="Anteprima PDF" className="rounded-lg border border-border p-1.5 transition-colors hover:border-accent"><Eye className="size-4" /></a>
        <Link to={`/documents/${d.id}/edit`} title="Modifica" className="rounded-lg border border-border p-1.5 transition-colors hover:border-accent"><Pencil className="size-4" /></Link>
      </span>
    </div>
  );
}

/** "Unisci a…": sceglie un'altra scheda; i documenti passano di là, questa sparisce. */
function MergeButton({ customer, onMerged }: { customer: Customer; onMerged: (intoId: number) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<Customer[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      api.listCustomers({ q: q || undefined, sort: "name", limit: 20 })
        .then((p) => setOptions(p.items.filter((c) => c.id !== customer.id)))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [open, q, customer.id]);

  async function merge(into: Customer) {
    if (!confirm(`Unire "${customer.name}" in "${into.name}"? I ${customer.doc_count} documenti passeranno a "${into.name}" e questa scheda verrà eliminata.`)) return;
    setBusy(true);
    try {
      await api.mergeCustomer(customer.id, into.id);
      toast.success(`Schede unite in "${into.name}"`);
      onMerged(into.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unione non riuscita");
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm transition-colors hover:border-accent">
        <GitMerge className="size-4" /> Unisci a…
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-72 rounded-xl border border-border p-2 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.8)]" style={{ background: "var(--background)" }}>
          <input autoFocus className={inputCls} placeholder="Cerca la scheda di destinazione…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="mt-2 max-h-56 overflow-auto">
            {options.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">Nessun'altra scheda.</p>}
            {options.map((o) => (
              <button key={o.id} disabled={busy} onClick={() => merge(o)} className="flex w-full flex-col items-start rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-foreground/[0.06] disabled:opacity-50">
                <span className="font-medium">{o.name}</span>
                <span className="text-xs text-muted-foreground">{[o.vat && `P.IVA ${o.vat}`, o.email, `${o.doc_count} doc.`].filter(Boolean).join(" · ")}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DeleteButton({ id, onDeleted }: { id: number; onDeleted: () => void }) {
  async function remove() {
    if (!confirm("Eliminare questa scheda vuota?")) return;
    try {
      await api.deleteCustomer(id);
      toast.success("Scheda eliminata");
      onDeleted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore");
    }
  }
  return (
    <button onClick={remove} className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm transition-colors hover:border-[var(--rosa)] hover:text-[var(--rosa)]">
      <Trash2 className="size-4" /> Elimina
    </button>
  );
}
