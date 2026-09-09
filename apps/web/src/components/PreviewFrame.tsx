import { useEffect, useRef, useState } from "react";
import { Eye, Loader2, X } from "lucide-react";

/**
 * Anteprima A4 del documento. Su schermi larghi è la colonna destra appiccicata;
 * su mobile diventa un bottone flottante "Anteprima" che apre un pannello a
 * tutto schermo (il form lunghissimo non spinge più il foglio in fondo alla pagina).
 */
/** Larghezza di una pagina A4 a 96 dpi: il PDF viene reso a questa misura. */
const A4_WIDTH_PX = 794;

/**
 * Foglio A4 intero: l'iframe è largo 794px e viene scalato al contenitore,
 * così si vede tutta la pagina in piccolo invece della sola parte alta.
 */
function A4Sheet({ html, title }: { html: string; title: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const update = () => setScale(el.clientWidth / A4_WIDTH_PX);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div
      ref={box}
      className="relative aspect-[210/297] w-full overflow-hidden rounded-xl border border-border bg-white shadow-[0_20px_60px_-30px_rgba(0,0,0,0.6)]"
    >
      {html ? (
        <iframe
          sandbox=""
          srcDoc={html}
          title={title}
          className="absolute left-0 top-0 origin-top-left border-0"
          style={{ width: A4_WIDTH_PX, height: A4_WIDTH_PX * (297 / 210), transform: `scale(${scale})` }}
        />
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-black/40">Anteprima in caricamento…</div>
      )}
    </div>
  );
}

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

  const sheet = <A4Sheet html={html} title={title} />;

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
