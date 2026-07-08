import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, FileText, Loader2, Mails, Send, Sparkles } from "lucide-react";

import { api, loginWithGoogle } from "@/api";

/** Login via email (magic link): funziona con qualsiasi provider. */
function MagicLinkForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setState("sending");
    try {
      await api.requestMagicLink(email.trim());
    } catch {
      /* risposta uniforme: si mostra comunque "controlla la posta" */
    }
    setState("sent");
  }

  if (state === "sent") {
    return (
      <p className="mt-4 max-w-sm rounded-2xl border border-border bg-card px-5 py-4 text-sm leading-relaxed text-muted-foreground">
        📬 <strong className="text-foreground">Controlla la posta</strong>: se l'indirizzo è
        corretto ti abbiamo mandato un link di accesso. Vale 15 minuti.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="mt-4 flex w-full max-w-sm items-center gap-2">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="oppure entra con la tua email…"
        className="min-w-0 flex-1 rounded-full border border-border bg-card px-5 py-3 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-accent"
      />
      <button
        type="submit"
        disabled={state === "sending" || !email.trim()}
        aria-label="Invia link di accesso"
        className="inline-flex shrink-0 items-center justify-center rounded-full border border-border p-3 transition-colors hover:border-accent disabled:opacity-50"
      >
        {state === "sending" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
      </button>
    </form>
  );
}

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
      <MagicLinkForm />
      <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
        funziona con qualsiasi casella · nessuna mail viene modificata
      </p>

      <div className="mt-20 grid w-full max-w-3xl grid-cols-1 gap-4 text-left sm:grid-cols-3">
        <Step icon={Mails} title="1 · Collega" text="Accedi con Gmail e collega il tuo listino prezzi: Google Sheet, PDF o CSV." />
        <Step icon={Sparkles} title="2 · Rileva" text="Ogni giorno l'AI trova le mail giuste da sola — o con le parole chiave che scegli tu." />
        <Step icon={FileText} title="3 · Genera" text="Il documento nasce già coi prezzi del listino, col tuo template. Lo modifichi e lo scarichi." />
      </div>

      <div className="mt-16 flex items-center gap-4 text-xs text-muted-foreground">
        <Link to="/privacy" className="transition-colors hover:text-foreground">Privacy</Link>
        <span aria-hidden>·</span>
        <Link to="/termini" className="transition-colors hover:text-foreground">Termini di servizio</Link>
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
