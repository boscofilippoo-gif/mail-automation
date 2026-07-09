import { useEffect, useState } from "react";
import { useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import { ArrowRight, Check, Copy, Forward, Mail, ShieldCheck } from "lucide-react";

import { api, connectGmail, type Me } from "@/api";
import { cn } from "@/lib/utils";

/**
 * Scelta della modalità casella dopo il primo login:
 * - Gmail diretto: bozze nel thread, ma avviso Google e solo Gmail
 * - Inoltro: alias personale, qualsiasi provider, zero avvisi
 */
export function Onboarding() {
  const navigate = useNavigate();
  const { refreshMe } = useOutletContext<{ me: Me | null; refreshMe: () => Promise<Me | null> }>();
  const [params] = useSearchParams();
  const [step, setStep] = useState<"choose" | "inoltro">("choose");
  const [address, setAddress] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(
    params.get("error") === "account-google-diverso"
      ? "Hai autorizzato un account Google diverso da quello del tuo profilo. Riprova con lo stesso account."
      : null,
  );

  /** Sceglie inoltro: imposta la modalità e mostra alias + istruzioni. */
  async function chooseInoltro() {
    setError(null);
    try {
      await api.setMailMode("inoltro");
      // aggiorna SUBITO il profilo in App: senza, il guard di navigazione vede
      // ancora mailMode null e "Vai alla dashboard" rimbalza sull'onboarding
      await refreshMe();
      const a = await api.getInboundAddress();
      setAddress(a.address);
      setPending(a.pendingConfirmation);
      setStep("inoltro");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore");
    }
  }

  // polling del codice di conferma Gmail mentre l'utente configura l'inoltro
  useEffect(() => {
    if (step !== "inoltro") return;
    const t = setInterval(() => {
      api.getInboundAddress().then((a) => setPending(a.pendingConfirmation)).catch(() => {});
    }, 5000);
    return () => clearInterval(t);
  }, [step]);

  function copyAddress() {
    if (!address) return;
    void navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  if (step === "inoltro") {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight">Configura l'inoltro</h1>
        <p className="mt-2 text-muted-foreground">
          Questo è il tuo indirizzo personale: le mail che vi inoltri vengono elaborate
          automaticamente. Si configura una volta sola, poi funziona da solo.
        </p>

        <div className="mt-6 flex items-center gap-2 rounded-2xl border border-border bg-card p-4">
          <code className="min-w-0 flex-1 truncate text-sm" style={{ color: "var(--azzurro)" }}>
            {address}
          </code>
          <button
            onClick={copyAddress}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-xs transition-colors hover:border-accent"
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? "Copiato" : "Copia"}
          </button>
        </div>

        {/* codice di conferma Gmail: arriva qui e lo mostriamo live */}
        <div
          className="mt-4 rounded-2xl border p-4 text-sm"
          style={{ borderColor: pending ? "var(--azzurro)" : "var(--border)" }}
        >
          {pending ? (
            <>
              <p className="font-semibold" style={{ color: "var(--azzurro)" }}>
                📬 Codice di conferma ricevuto da Gmail:
              </p>
              <p className="mt-1 break-all font-mono text-lg">{pending}</p>
              <p className="mt-1 text-muted-foreground">
                Incollalo nella schermata di Gmail per completare l'attivazione, poi{" "}
                <button onClick={() => { void api.confirmationDone(); setPending(null); }} className="underline decoration-dotted underline-offset-4 hover:text-foreground">
                  segna come fatto
                </button>
                .
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">
              In attesa del codice di conferma… (se configuri Gmail, il codice apparirà qui da solo)
            </p>
          )}
        </div>

        <div className="mt-8 space-y-4 text-sm leading-relaxed text-muted-foreground">
          <div>
            <h3 className="font-semibold text-foreground">Da Gmail</h3>
            <p>
              Impostazioni → Visualizza tutte le impostazioni → <strong>Inoltro e POP/IMAP</strong> →
              "Aggiungi un indirizzo di inoltro" → incolla l'indirizzo qui sopra → il codice di
              conferma apparirà in questa pagina. Consiglio: usa un <strong>filtro</strong> ("crea
              filtro → inoltra a") per inoltrare solo le mail di lavoro.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Da Outlook</h3>
            <p>
              Impostazioni → Posta → <strong>Inoltro</strong> → attiva e incolla l'indirizzo (oppure
              usa una Regola per inoltrare solo certe mail).
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Altri provider (Aruba, Register, PEC…)</h3>
            <p>Cerca "inoltro automatico" nelle impostazioni della webmail e incolla l'indirizzo.</p>
          </div>
        </div>

        <button
          onClick={() => navigate("/dashboard")}
          className="mt-8 inline-flex items-center gap-2 rounded-full px-6 py-3 font-medium"
          style={{ background: "var(--azzurro)", color: "var(--nero)" }}
        >
          Vai alla dashboard
          <ArrowRight className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Come vuoi collegare la tua posta?</h1>
      <p className="mt-2 text-muted-foreground">Puoi cambiare idea in qualsiasi momento.</p>
      {error && <p className="mt-3 text-sm" style={{ color: "var(--rosa)" }}>{error}</p>}

      <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-2">
        <button
          onClick={connectGmail}
          className={cn(
            "group flex cursor-pointer flex-col rounded-2xl border border-border bg-card p-6 text-left",
            "transition-[border-color,transform,background-color] duration-200 hover:-translate-y-1 hover:border-accent-2 hover:bg-foreground/[0.05]",
          )}
        >
          <Mail className="size-6" style={{ color: "var(--rosa)" }} />
          <h2 className="mt-4 font-semibold">Collega Gmail (accesso diretto)</h2>
          <ul className="mt-3 space-y-1.5 text-sm leading-relaxed text-muted-foreground">
            <li>✓ Legge la casella da sola, zero configurazione</li>
            <li>✓ Bozze di risposta pronte dentro Gmail</li>
            <li>– Solo Gmail · richiede un'autorizzazione extra di Google</li>
          </ul>
          <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium transition-transform group-hover:translate-x-1" style={{ color: "var(--rosa)" }}>
            Scegli Gmail <ArrowRight className="size-4" />
          </span>
        </button>

        <button
          onClick={chooseInoltro}
          className={cn(
            "group flex cursor-pointer flex-col rounded-2xl border border-border bg-card p-6 text-left",
            "transition-[border-color,transform,background-color] duration-200 hover:-translate-y-1 hover:border-accent hover:bg-foreground/[0.05]",
          )}
        >
          <Forward className="size-6" style={{ color: "var(--azzurro)" }} />
          <h2 className="mt-4 flex items-center gap-2 font-semibold">
            Inoltro automatico
            <ShieldCheck className="size-4" style={{ color: "var(--azzurro)" }} />
          </h2>
          <ul className="mt-3 space-y-1.5 text-sm leading-relaxed text-muted-foreground">
            <li>✓ Funziona con qualsiasi casella: Outlook, Aruba, PEC…</li>
            <li>✓ Nessun avviso di sicurezza, nessuna autorizzazione extra</li>
            <li>– Richiede 2 minuti di configurazione guidata, una volta</li>
          </ul>
          <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium transition-transform group-hover:translate-x-1" style={{ color: "var(--azzurro)" }}>
            Scegli inoltro <ArrowRight className="size-4" />
          </span>
        </button>
      </div>
    </div>
  );
}
