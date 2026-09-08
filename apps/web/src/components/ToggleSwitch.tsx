import { cn } from "@/lib/utils";

/** Interruttore on/off (null = stato non ancora caricato → disabilitato). */
export function ToggleSwitch({ checked, onToggle }: { checked: boolean | null; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked ?? false}
      onClick={onToggle}
      disabled={checked === null}
      className={cn(
        "relative h-7 w-12 shrink-0 rounded-full border transition-colors disabled:opacity-50",
        checked ? "border-transparent" : "border-border bg-transparent",
      )}
      style={checked ? { background: "var(--azzurro)" } : undefined}
    >
      <span
        className={cn(
          "absolute top-0.5 size-[22px] rounded-full bg-foreground transition-transform",
          checked ? "translate-x-[22px]" : "translate-x-0.5",
        )}
        style={checked ? { background: "var(--nero)" } : undefined}
      />
    </button>
  );
}
