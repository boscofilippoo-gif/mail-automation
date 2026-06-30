import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { LogOut, Mails } from "lucide-react";

import { api, type Me } from "@/api";
import { cn } from "@/lib/utils";

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    api
      .me()
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setLoading(false));
  }, [location.pathname]);

  // protezione client-side: le pagine interne richiedono sessione
  useEffect(() => {
    const isProtected = location.pathname !== "/";
    if (!loading && !me && isProtected) navigate("/", { replace: true });
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
          <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
            <Link to="/dashboard" className="flex items-center gap-2 font-semibold tracking-tight">
              <Mails className="size-5" style={{ color: "var(--azzurro)" }} />
              Mail Automation
            </Link>
            <nav className="flex items-center gap-1">
              <TabLink to="/dashboard">Documenti</TabLink>
              <TabLink to="/keywords">Parole chiave</TabLink>
              <button
                onClick={handleLogout}
                className="ml-2 inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                <LogOut className="size-4" />
                Esci
              </button>
            </nav>
          </div>
        </header>
      )}
      <main className="mx-auto max-w-5xl px-6 py-10">
        <Outlet context={{ me }} />
      </main>
    </div>
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
