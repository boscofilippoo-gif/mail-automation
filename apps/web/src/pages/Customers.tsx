import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronRight, Search, Users } from "lucide-react";

import { api, type Customer, type CustomerSort } from "@/api";

const PAGE = 50;
const eur = (n: number, c = "EUR") => new Intl.NumberFormat("it-IT", { style: "currency", currency: c, maximumFractionDigits: 0 }).format(n);
const selectCls =
  "rounded-full border border-border bg-card px-3.5 py-1.5 text-sm text-foreground outline-none focus:border-accent";

/** Elenco clienti: nasce da solo dai documenti, si cerca e si ordina. */
export function Customers() {
  const [sp, setSp] = useSearchParams();
  const q = sp.get("q") ?? "";
  const sort = (["name", "recent", "total"].includes(sp.get("sort") ?? "") ? sp.get("sort") : "recent") as CustomerSort;
  const [qDraft, setQDraft] = useState(q);
  const [items, setItems] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  function setParam(k: string, v: string) {
    const next = new URLSearchParams(sp);
    if (v) next.set(k, v); else next.delete(k);
    setSp(next, { replace: true });
  }
  useEffect(() => {
    if (qDraft === q) return;
    const t = setTimeout(() => setParam("q", qDraft), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qDraft]);

  useEffect(() => {
    setLoading(true);
    api.listCustomers({ q: q || undefined, sort, limit: PAGE, offset: 0 })
      .then((p) => { setItems(p.items); setTotal(p.total); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [q, sort]);

  async function loadMore() {
    const p = await api.listCustomers({ q: q || undefined, sort, limit: PAGE, offset: items.length }).catch(() => null);
    if (!p) return;
    setItems((cur) => [...cur, ...p.items.filter((c) => !cur.some((x) => x.id === c.id))]);
    setTotal(p.total);
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Clienti</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        Le schede nascono da sole dai documenti: stessa P.IVA, stessa email o stesso nome finiscono nella
        stessa cartella. Puoi correggere i dati e unire i doppioni.
      </p>

      <div className="mt-8 flex flex-wrap items-center gap-2">
        <label className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={qDraft}
            onChange={(e) => setQDraft(e.target.value)}
            placeholder="Cerca nome, P.IVA, email…"
            className="w-full rounded-full border border-border bg-card py-1.5 pl-9 pr-3.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-accent"
          />
        </label>
        <select className={selectCls} value={sort} onChange={(e) => setParam("sort", e.target.value)}>
          <option value="recent">Ultimo documento</option>
          <option value="name">Nome</option>
          <option value="total">Fatturato</option>
        </select>
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {items.length < total ? `${items.length} di ${total}` : `${total} ${total === 1 ? "cliente" : "clienti"}`}
        </span>
      </div>

      {!loading && items.length === 0 && (
        <div className="mt-8 rounded-2xl border border-dashed border-border p-12 text-center">
          <Users className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-4 text-muted-foreground">
            {q ? "Nessun cliente corrisponde alla ricerca." : "Ancora nessun cliente: la prima scheda nasce col primo documento."}
          </p>
        </div>
      )}

      {items.length > 0 && (
        <div className="mt-6 overflow-hidden rounded-2xl border border-border">
          {/* intestazione (solo da sm) */}
          <div className="hidden grid-cols-[1fr_repeat(3,minmax(0,130px))_110px_24px] gap-3 border-b border-border px-5 py-2.5 font-mono text-xs uppercase tracking-wider text-muted-foreground sm:grid">
            <span>Cliente</span><span className="text-right">Preventivi</span><span className="text-right">Ordini</span><span className="text-right">Fatture</span><span className="text-right">Ultimo</span><span />
          </div>
          {items.map((c) => (
            <Link
              key={c.id}
              to={`/customers/${c.id}`}
              className="grid grid-cols-[1fr_24px] items-center gap-3 border-b border-border/60 px-5 py-3.5 transition-colors last:border-0 hover:bg-foreground/[0.03] sm:grid-cols-[1fr_repeat(3,minmax(0,130px))_110px_24px]"
            >
              <span className="min-w-0">
                <span className="block truncate font-semibold">{c.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {[c.vat && `P.IVA ${c.vat}`, c.email].filter(Boolean).join(" · ") || "—"}
                </span>
                {/* mobile: i tre numeri in riga */}
                <span className="mt-1 flex gap-3 text-xs text-muted-foreground sm:hidden">
                  <span>P {c.n_preventivo}</span><span>O {c.n_ordine}</span><span>F {c.n_fattura} · {eur(c.sum_fattura)}</span>
                </span>
              </span>
              <Stat n={c.n_preventivo} sum={c.sum_preventivo} />
              <Stat n={c.n_ordine} sum={c.sum_ordine} />
              <Stat n={c.n_fattura} sum={c.sum_fattura} strong />
              <span className="hidden text-right font-mono text-xs text-muted-foreground sm:block">
                {c.last_doc_at ? new Date(c.last_doc_at + "Z").toLocaleDateString("it-IT") : "—"}
              </span>
              <ChevronRight className="size-4 text-muted-foreground" />
            </Link>
          ))}
        </div>
      )}
      {items.length < total && (
        <div className="mt-6 flex justify-center">
          <button onClick={loadMore} className="rounded-full border border-border px-5 py-2 text-sm transition-colors hover:border-accent">
            Carica altri ({total - items.length} rimanenti)
          </button>
        </div>
      )}
    </div>
  );
}

function Stat({ n, sum, strong }: { n: number; sum: number; strong?: boolean }) {
  return (
    <span className="hidden text-right sm:block">
      {n === 0 ? (
        <span className="text-muted-foreground/50">—</span>
      ) : (
        <>
          <span className={strong ? "font-semibold" : ""}>{eur(sum)}</span>
          <span className="block text-xs text-muted-foreground">{n} {n === 1 ? "doc." : "doc."}</span>
        </>
      )}
    </span>
  );
}
