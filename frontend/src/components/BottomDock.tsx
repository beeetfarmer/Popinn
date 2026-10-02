import { Link, useLocation, useNavigate } from "react-router-dom";
import { Home, Film, Users, ListVideo, Search, User, Settings, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

const navItems = [
  { label: "Home", path: "/", icon: Home },
  { label: "Videos", path: "/videos", icon: Film },
  { label: "Artists", path: "/artists", icon: Users },
  { label: "Lists", path: "/watchlists", icon: ListVideo },
  { label: "Settings", path: "/settings", icon: Settings },
];

const spring = { type: "spring" as const, stiffness: 420, damping: 34 };

function DockItem({
  active,
  icon: Icon,
  label,
  labelClassName,
}: {
  active: boolean;
  icon: typeof Home;
  label: string;
  labelClassName?: string;
}) {
  return (
    <>
      {active && (
        <motion.span
          layoutId="dock-active"
          transition={spring}
          className="absolute inset-0 rounded-full bg-primary shadow-[0_8px_30px_-6px_hsl(var(--primary)/0.7)]"
        />
      )}
      <Icon className="relative h-[18px] w-[18px] shrink-0" strokeWidth={active ? 2.25 : 1.75} />
      <span className={cn("relative text-[10px] font-medium sm:text-[11px]", labelClassName)}>{label}</span>
    </>
  );
}

const itemClass = (active: boolean) =>
  cn(
    "relative flex shrink-0 flex-col items-center gap-0.5 rounded-full px-2 py-2 outline-none transition-colors duration-300 focus-visible:ring-2 focus-visible:ring-primary/60 min-[400px]:px-2.5 sm:px-3.5",
    active ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"
  );

export default function BottomDock() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Cmd/Ctrl+K or "/" opens search from anywhere, Escape closes it.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing =
        target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === "Escape" && searchOpen) {
        setSearchOpen(false);
        setQuery("");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchOpen]);

  useEffect(() => {
    if (searchOpen) inputRef.current?.focus();
  }, [searchOpen]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (q) {
      navigate(`/search?q=${encodeURIComponent(q)}`);
      setSearchOpen(false);
      setQuery("");
    }
  }

  return (
    <nav className="fixed bottom-4 left-1/2 z-40 w-max max-w-[calc(100vw-1rem)] -translate-x-1/2 sm:bottom-6">
      <AnimatePresence>
        {searchOpen && (
          <motion.form
            onSubmit={handleSearch}
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="glass mb-3 flex items-center gap-2 rounded-2xl px-4 py-3"
          >
            <Search className="h-4 w-4 shrink-0 text-primary" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Search artists & videos..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onBlur={() => {
                if (!query) setSearchOpen(false);
              }}
              className="w-full min-w-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none sm:min-w-[22rem]"
            />
            <kbd className="hidden rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline">
              Enter
            </kbd>
            <button
              type="button"
              aria-label="Close search"
              onClick={() => {
                setSearchOpen(false);
                setQuery("");
              }}
              className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </motion.form>
        )}
      </AnimatePresence>

      <div className="glass flex max-w-full items-center gap-0 overflow-x-auto rounded-full p-1.5 scrollbar-none sm:gap-1">
        <button
          type="button"
          onClick={() => setSearchOpen(!searchOpen)}
          className={cn(
            itemClass(location.pathname === "/search"),
            searchOpen && location.pathname !== "/search" && "bg-white/10 text-foreground"
          )}
          title="Search (⌘K)"
        >
          {/* Only the route gets the sliding pill; two holders of one layoutId
              would make it jump between them. */}
          <DockItem active={location.pathname === "/search"} icon={Search} label="Search" />
        </button>

        {navItems.map((item) => {
          const active =
            item.path === "/" ? location.pathname === "/" : location.pathname.startsWith(item.path);
          return (
            <Link key={item.path} to={item.path} className={itemClass(active)}>
              <DockItem active={active} icon={item.icon} label={item.label} />
            </Link>
          );
        })}

        <div className="mx-1 hidden h-7 w-px shrink-0 bg-white/10 sm:block" />

        <Link to="/profile" className={itemClass(location.pathname.startsWith("/profile"))}>
          <DockItem
            active={location.pathname.startsWith("/profile")}
            icon={User}
            label={user?.username || "Profile"}
            labelClassName="max-w-[4.5rem] truncate"
          />
        </Link>
      </div>
    </nav>
  );
}
