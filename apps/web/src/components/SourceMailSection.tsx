import { useState } from "react";
import { ChevronDown, ExternalLink, Mail } from "lucide-react";

import { api, gmailUrl, type SourceMail } from "@/api";
import { cn } from "@/lib/utils";

/**
 * Mail originale del cliente: collassabile, caricata da Gmail solo al primo click.
 * Condivisa tra la pagina di modifica documento e quella di smistamento.
 */
export function SourceMailSection({
  docId,
  sourceMessageId,
  showGmailLink,
  defaultOpen = false,
}: {
  docId: number;
  sourceMessageId: string | null;
  showGmailLink: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [mail, setMail] = useState<SourceMail | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  // carica al primo apri (o subito se defaultOpen)
  async function load() {
    if (mail || state === "loading") return;
    setState("loading");
    try {
      setMail(await api.getSource(docId));
      setState("idle");
    } catch {
      setState("error");
    }
  }
  if (defaultOpen && !mail && state === "idle") void load();

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) void load();
  }

  return (
    <section className="rounded-2xl border border-border bg-card">
      <button
        onClick={toggle}
        className="flex w-full items-center justify-between px-5 py-3.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <span className="inline-flex items-center gap-2">
          <Mail className="size-4" style={{ color: "var(--azzurro)" }} />
          Mail originale del cliente
        </span>
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="border-t border-border px-5 py-4 text-sm">
          {state === "loading" && <p className="text-muted-foreground">Caricamento…</p>}
          {state === "error" && (
            <p style={{ color: "var(--rosa)" }}>Mail originale non trovata (eliminata da Gmail?).</p>
          )}
          {mail && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{mail.subject || "(senza oggetto)"}</p>
                {sourceMessageId && showGmailLink && (
                  <a
                    href={gmailUrl(sourceMessageId)}
                    target="_blank"
                    rel="noopener"
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-accent hover:text-foreground"
                  >
                    <ExternalLink className="size-3" />
                    Apri in Gmail
                  </a>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {mail.from} · {mail.date}
              </p>
              {/* testo puro, mai HTML: bodyText è già estratto come plain text */}
              <pre className="mt-3 max-h-64 overflow-y-auto whitespace-pre-wrap font-sans text-sm leading-relaxed text-muted-foreground">
                {mail.bodyText || "(corpo vuoto)"}
              </pre>
            </>
          )}
        </div>
      )}
    </section>
  );
}
