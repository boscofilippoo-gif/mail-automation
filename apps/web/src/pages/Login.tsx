import { ArrowRight, FileText, Mails, ScanSearch } from "lucide-react";

import { loginWithGoogle } from "@/api";

export function Login() {
  return (
    <div className="flex min-h-[80vh] flex-col items-center justify-center text-center">
      <p
        className="mb-5 font-mono text-[11px] uppercase tracking-[0.22em]"
        style={{ color: "var(--azzurro)" }}
      >
        BORU studio · mail automation
      </p>
      <h1 className="max-w-2xl text-4xl font-semibold leading-[1.12] tracking-tight md:text-5xl">
        Dalle email ai documenti,{" "}
        <span style={{ color: "var(--rosa)" }}>in automatico.</span>
      </h1>
      <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
        Scegli una parola chiave nell'oggetto delle mail che ricevi — "ordine", "preventivo",
        "fattura". Ogni giorno il sistema le trova, ne legge il contenuto e ti genera il PDF
        pronto. Tu lo trovi qui.
      </p>

      <button
        onClick={loginWithGoogle}
        className="mt-10 inline-flex cursor-pointer items-center justify-center gap-2 rounded-full px-7 py-3.5 text-base font-medium transition-opacity duration-200 hover:opacity-85"
        style={{ background: "var(--azzurro)", color: "var(--nero)" }}
      >
        Accedi con Google
        <ArrowRight className="size-[18px]" />
      </button>
      <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
        accesso in sola lettura alla tua casella · nessuna mail viene modificata
      </p>

      <div className="mt-20 grid w-full max-w-3xl grid-cols-1 gap-4 text-left sm:grid-cols-3">
        <Step icon={ScanSearch} title="1 · Configura" text="Imposti le parole chiave da cercare nell'oggetto delle mail." />
        <Step icon={Mails} title="2 · Scansiona" text="Ogni giorno il sistema controlla la casella e trova le mail giuste." />
        <Step icon={FileText} title="3 · Genera" text="L'AI legge il contenuto e crea il PDF, che archiviamo per te." />
      </div>
    </div>
  );
}

function Step({
  icon: Icon,
  title,
  text,
}: {
  icon: typeof ScanSearch;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <Icon className="size-5" style={{ color: "var(--azzurro)" }} />
      <h3 className="mt-3 font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
        {title}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{text}</p>
    </div>
  );
}
