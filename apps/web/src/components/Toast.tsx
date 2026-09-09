import { useEffect, useState } from "react";
import { AlertTriangle, Check } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Toast leggeri, senza provider: `toast.success("…")` da qualsiasi punto,
 * <Toaster /> montato una volta in App. Spariscono da soli dopo 3,5 s.
 */
type Kind = "success" | "error";
interface Item {
  id: number;
  kind: Kind;
  text: string;
}

const listeners = new Set<(t: Item) => void>();
let seq = 0;

function emit(kind: Kind, text: string) {
  const t = { id: ++seq, kind, text };
  listeners.forEach((l) => l(t));
}

export const toast = {
  success: (text: string) => emit("success", text),
  error: (text: string) => emit("error", text),
};

export function Toaster() {
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    const onToast = (t: Item) => {
      setItems((cur) => [...cur, t]);
      setTimeout(() => setItems((cur) => cur.filter((x) => x.id !== t.id)), 3500);
    };
    listeners.add(onToast);
    return () => {
      listeners.delete(onToast);
    };
  }, []);

  if (items.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2 px-4" aria-live="polite">
      {items.map((t) => (
        <div
          key={t.id}
          className={cn(
            "pointer-events-auto inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm shadow-[0_12px_40px_-12px_rgba(0,0,0,0.7)]",
            "animate-[toast-in_.2s_ease-out]",
          )}
          style={{
            background: "var(--nero)",
            borderColor: t.kind === "success" ? "var(--azzurro)" : "var(--rosa)",
            color: "var(--porcellana)",
          }}
        >
          {t.kind === "success" ? (
            <Check className="size-4" style={{ color: "var(--azzurro)" }} />
          ) : (
            <AlertTriangle className="size-4" style={{ color: "var(--rosa)" }} />
          )}
          {t.text}
        </div>
      ))}
    </div>
  );
}
