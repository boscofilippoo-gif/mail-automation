import { Link } from "react-router-dom";
import { ArrowLeft, Mails } from "lucide-react";

/**
 * Layout per le pagine legali (privacy, termini): accessibili anche senza login.
 * Testo su fondo porcellana per leggibilità, coerente col brand.
 */
export function LegalLayout({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <Mails className="size-5" style={{ color: "var(--azzurro)" }} />
            Mail Automation
          </Link>
          <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="size-4" />
            Torna all'app
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-14">
        <h1 className="font-title text-3xl font-semibold tracking-tight md:text-4xl">{title}</h1>
        <p className="mt-2 font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
          Ultimo aggiornamento: {updated}
        </p>
        <div className="legal-body mt-10 space-y-6 leading-relaxed text-muted-foreground">{children}</div>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-4 gap-y-1 px-6 py-8 text-sm text-muted-foreground">
          <Link to="/privacy" className="transition-colors hover:text-foreground">Privacy</Link>
          <Link to="/termini" className="transition-colors hover:text-foreground">Termini di servizio</Link>
          <span className="ml-auto">© {new Date().getFullYear()} BORU studio</span>
        </div>
      </footer>
    </div>
  );
}

/** Titolo di sezione riutilizzabile nelle pagine legali. */
export function LegalSection({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-foreground">
        {n}. {title}
      </h2>
      <div className="mt-2 space-y-3">{children}</div>
    </section>
  );
}
