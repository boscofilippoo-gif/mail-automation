import { ArrowRight, FileText, Mails, Sparkles } from "lucide-react";

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
        L'AI legge le mail che ricevi e riconosce da sola preventivi, ordini e fatture. Prende i
        prezzi dal tuo listino, genera il PDF col tuo template e lo archivia qui — pronto da
        modificare e inviare.
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
        <Step icon={Mails} title="1 · Collega" text="Accedi con Gmail e collega il tuo listino prezzi: Google Sheet, PDF o CSV." />
        <Step icon={Sparkles} title="2 · Rileva" text="Ogni giorno l'AI trova le mail giuste da sola — o con le parole chiave che scegli tu." />
        <Step icon={FileText} title="3 · Genera" text="Il documento nasce già coi prezzi del listino, col tuo template. Lo modifichi e lo scarichi." />
      </div>
    </div>
  );
}

function Step({
  icon: Icon,
  title,
  text,
}: {
  icon: typeof Mails;
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
