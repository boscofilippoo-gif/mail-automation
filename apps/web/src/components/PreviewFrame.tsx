import { useEffect, useState } from "react";
import { Eye, Loader2, X } from "lucide-react";

/**
 * Anteprima A4 del documento. Su schermi larghi è la colonna destra appiccicata;
 * su mobile diventa un bottone flottante "Anteprima" che apre un pannello a
 * tutto schermo (il form lunghissimo non spinge più il foglio in fondo alla pagina).
 */
export function PreviewFrame({ html, loading, title = "Anteprima" }: { html: string; loading: boolean; title?: string }) {
  const [open, setOpen] = useState(false);

  // blocca lo scroll della pagina mentre il pannello mobile è aperto
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const sheet = (
    <div className="aspect-[210/297] w-full overflow-hidden rounded-xl border border-border bg-white shadow-[0_20px_60px_-30px_rgba(0,0,0,0.6)]">
      {html ? (
        <iframe sandbox="" srcDoc={html} title={title} className="h-full w-full border-0" />
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-black/40">Anteprima in caricamento…</div>
      )}
    </div>
  );

  return (
    <>
      {/* desktop: colonna destra */}
      <div className="hidden lg:sticky lg:top-24 lg:block lg:self-start">
        <h2 className="flex items-center gap-2 font-mono text-[0.8rem] uppercase tracking-[0.12em] text-muted-foreground">
          {title}
          {loading && <Loader2 className="size-3 animate-spin" />}
        </h2>
        <div className="mt-4">{sheet}</div>
      </div>

      {/* mobile: bottone flottante + pannello */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-20 right-4 z-30 inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium shadow-[0_12px_40px_-12px_rgba(0,0,0,0.7)] lg:hidden"
        style={{ background: "var(--azzurro)", color: "var(--nero)" }}
      >
        {loading ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
        {title}
      </button>
      {open && (
        <div className="fixed inset-0 z-40 flex flex-col bg-background lg:hidden" role="dialog" aria-label={title}>
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="font-mono text-[0.8rem] uppercase tracking-[0.12em] text-muted-foreground">{title}</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Chiudi anteprima"
              className="inline-flex size-9 items-center justify-center rounded-full border border-border"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="flex-1 overflow-auto p-4">{sheet}</div>
        </div>
      )}
    </>
  );
}
