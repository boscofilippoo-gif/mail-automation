import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { api, type DocType, type Keyword } from "@/api";
import { cn } from "@/lib/utils";

const DOC_TYPES: DocType[] = ["preventivo", "fattura", "ordine"];

export function Keywords() {
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [term, setTerm] = useState("");
  const [docType, setDocType] = useState<DocType>("preventivo");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function reload() {
    api.listKeywords().then(setKeywords).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }
  useEffect(reload, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const t = term.trim();
    if (!t) return;
    try {
      await api.addKeyword(t, docType);
      setTerm("");
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore");
    }
  }

  async function toggle(k: Keyword) {
    await api.toggleKeyword(k.id, k.active === 0).catch(() => {});
    reload();
  }

  async function remove(id: number) {
    await api.deleteKeyword(id).catch(() => {});
    reload();
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Parole chiave</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        Aggiungi le parole da cercare nell'<strong>oggetto</strong> delle mail. Quando una mail
        recente le contiene, il sistema genera il documento del tipo scelto.
      </p>

      <form onSubmit={add} className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="es. preventivo"
          className="flex-1 rounded-xl border border-border bg-card px-4 py-2.5 text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-accent"
        />
        <select
          value={docType}
          onChange={(e) => setDocType(e.target.value as DocType)}
          className="rounded-xl border border-border bg-card px-4 py-2.5 capitalize text-foreground outline-none focus:border-accent"
        >
          {DOC_TYPES.map((t) => (
            <option key={t} value={t} className="bg-background capitalize">
              {t}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="inline-flex items-center justify-center gap-1.5 rounded-xl px-5 py-2.5 font-medium"
          style={{ background: "var(--azzurro)", color: "var(--nero)" }}
        >
          <Plus className="size-4" />
          Aggiungi
        </button>
      </form>
      {error && <p className="mt-3 text-sm" style={{ color: "var(--rosa)" }}>{error}</p>}

      <div className="mt-8 space-y-2">
        {loading ? (
          <p className="text-muted-foreground">Caricamento…</p>
        ) : keywords.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">
            Nessuna parola chiave. Aggiungine una qui sopra per iniziare.
          </p>
        ) : (
          keywords.map((k) => (
            <div
              key={k.id}
              className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <span className="font-medium">{k.term}</span>
                <span
                  className="rounded-full px-2.5 py-0.5 text-xs capitalize"
                  style={{
                    background: k.doc_type === "fattura" ? "color-mix(in oklab, var(--azzurro) 22%, transparent)" : "color-mix(in oklab, var(--rosa) 22%, transparent)",
                  }}
                >
                  {k.doc_type}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => toggle(k)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs transition-colors",
                    k.active ? "text-foreground" : "text-muted-foreground",
                  )}
                  style={k.active ? { background: "color-mix(in oklab, var(--azzurro) 18%, transparent)" } : undefined}
                >
                  {k.active ? "Attiva" : "Disattiva"}
                </button>
                <button
                  onClick={() => remove(k.id)}
                  className="rounded-full p-1.5 text-muted-foreground transition-colors hover:text-foreground"
                  aria-label="Elimina"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
