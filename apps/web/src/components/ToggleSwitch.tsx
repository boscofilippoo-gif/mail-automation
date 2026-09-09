import { cn } from "@/lib/utils";

/**
 * Interruttore on/off (null = stato non ancora caricato → disabilitato).
 * Geometria esplicita: binario 44×24, pallino 20 con 2px di margine, corsa 20px.
 * `p-0` e `left-0.5` evitano che il padding di default del <button> sposti il pallino.
 */
export function ToggleSwitch({ checked, onToggle }: { checked: boolean | null; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked ?? false}
      onClick={onToggle}
      disabled={checked === null}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full border p-0 transition-colors disabled:opacity-50",
        checked ? "border-transparent" : "border-border bg-foreground/10",
      )}
      style={checked ? { background: "var(--accent)" } : undefined}
    >
      <span
        aria-hidden
        className={cn(
          "absolute left-0.5 top-0.5 block size-5 rounded-full transition-transform",
          checked ? "translate-x-5" : "translate-x-0",
        )}
        style={{ background: checked ? "var(--nero)" : "var(--foreground)" }}
      />
    </button>
  );
}
