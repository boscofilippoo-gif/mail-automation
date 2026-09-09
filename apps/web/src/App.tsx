import { useCallback, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { FileText, LogOut, Settings2, SlidersHorizontal, Table2, Users } from "lucide-react";
import { Logo } from "@/components/Logo";

import { api, type Me } from "@/api";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/Toast";
import { ThemeToggle } from "@/components/ThemeToggle";

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const location = useLocation();
  const navigate = useNavigate();

  /** Ricarica il profilo: le pagine lo chiamano dopo azioni che cambiano lo
   *  stato lato server (es. scelta modalità), così il guard di navigazione
   *  non ragiona su dati stantii. */
  const refreshMe = useCallback(async (): Promise<Me | null> => {
    try {
      const m = await api.me();
      setMe(m);
      return m;
    } catch {
      setMe(null);
      return null;
    }
  }, []);

  useEffect(() => {
    void refreshMe().finally(() => setLoading(false));
  }, [location.pathname, refreshMe]);

  // protezione client-side: le pagine interne richiedono sessione;
  // chi non ha ancora scelto la modalità casella passa dall'onboarding
  useEffect(() => {
    const isProtected = location.pathname !== "/";
    if (loading) return;
    if (!me && isProtected) {
      navigate("/", { replace: true });
    } else if (me && !me.mailMode && isProtected && location.pathname !== "/onboarding") {
      navigate("/onboarding", { replace: true });
    }
  }, [loading, me, location.pathname, navigate]);

  async function handleLogout() {
    await api.logout().catch(() => {});
    setMe(null);
    navigate("/", { replace: true });
  }

  const showNav = Boolean(me) && location.pathname !== "/";

  return (
    <div className="min-h-screen bg-background text-foreground">
      {showNav && (
        <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6 sm:py-4">
            <Link to="/dashboard" className="flex items-center" aria-label="BORU mail, vai ai documenti">
              <Logo className="h-6 w-auto sm:h-7" />
            </Link>
            <nav className="flex items-center gap-1">
              {/* le schede stanno qui da sm in su; su mobile passano nella barra in basso */}
              <div className="hidden items-center gap-1 sm:flex">
                <TabLink to="/dashboard">Documenti</TabLink>
                <TabLink to="/customers">Clienti</TabLink>
                <TabLink to="/keywords">Regole</TabLink>
                <TabLink to="/listino">Listino</TabLink>
                <TabLink to="/settings">Impostazioni</TabLink>
              </div>
              <ThemeToggle className="ml-2 inline-flex size-8 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:text-foreground" />
              <button
                onClick={handleLogout}
                aria-label="Esci"
                className="ml-1 inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground sm:px-3.5"
              >
                <LogOut className="size-4" />
                <span className="hidden sm:inline">Esci</span>
              </button>
            </nav>
          </div>
        </header>
      )}
      <main className={cn("mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10", showNav && "pb-24 sm:pb-10")}>
        <Outlet context={{ me, refreshMe }} />
      </main>
      {showNav && <MobileTabBar />}
      <Toaster />
    </div>
  );
}

/** Barra schede fissa in basso, solo mobile: pollice, non mouse. */
function MobileTabBar() {
  const items = [
    { to: "/dashboard", label: "Documenti", Icon: FileText },
    { to: "/customers", label: "Clienti", Icon: Users },
    { to: "/keywords", label: "Regole", Icon: SlidersHorizontal },
    { to: "/listino", label: "Listino", Icon: Table2 },
    { to: "/settings", label: "Impostazioni", Icon: Settings2 },
  ];
  return (
    <nav
      aria-label="Navigazione principale"
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
    >
      {items.map(({ to, label, Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            cn(
              "flex flex-col items-center gap-1 py-2.5 text-[11px] transition-colors",
              isActive ? "text-foreground" : "text-muted-foreground",
            )
          }
        >
          {({ isActive }) => (
            <>
              <Icon className="size-5" style={isActive ? { color: "var(--accent)" } : undefined} />
              {label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

function TabLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          "rounded-full px-4 py-1.5 text-sm transition-colors",
          isActive ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:text-foreground",
        )
      }
    >
      {children}
    </NavLink>
  );
}
