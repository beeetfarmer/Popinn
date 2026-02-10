import { Link, useLocation, useNavigate } from "react-router-dom";
import { Home, Film, Users, ListVideo, Search, User, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

const navItems = [
  { label: "Home", path: "/", icon: Home },
  { label: "Videos", path: "/videos", icon: Film },
  { label: "Artists", path: "/artists", icon: Users },
  { label: "Lists", path: "/watchlists", icon: ListVideo },
  { label: "Settings", path: "/settings", icon: Settings },
];

export default function BottomDock() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");

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
    <nav className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2">
      {/* Search overlay */}
      {searchOpen && (
        <form
          onSubmit={handleSearch}
          className="mb-2 flex items-center rounded-full border border-white/20 bg-white/10 px-4 py-2 shadow-lg shadow-black/20 backdrop-blur-xl min-w-[20rem]"
        >
          <Search className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            type="text"
            autoFocus
            placeholder="Search artists & videos..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onBlur={() => { if (!query) setSearchOpen(false); }}
            className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <button
            type="button"
            onClick={() => { setSearchOpen(false); setQuery(""); }}
            className="ml-2 text-xs text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
        </form>
      )}

      <div className="flex items-center justify-center gap-0.5 rounded-full border border-white/20 bg-white/10 px-1.5 py-1.5 shadow-lg shadow-black/20 backdrop-blur-xl sm:gap-1 sm:px-2">
        {/* Search button */}
        <button
          onClick={() => setSearchOpen(!searchOpen)}
          className={cn(
            "flex flex-col items-center gap-0.5 rounded-full px-2.5 py-1.5 text-xs font-medium transition-all sm:px-3",
            searchOpen || location.pathname === "/search"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Search className="h-4 w-4 sm:h-5 sm:w-5" />
          <span className="text-[10px] sm:text-xs">Search</span>
        </button>

        {navItems.map((item) => {
          const active =
            item.path === "/"
              ? location.pathname === "/"
              : location.pathname.startsWith(item.path);
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex flex-col items-center gap-0.5 rounded-full px-2.5 py-1.5 text-xs font-medium transition-all sm:px-3",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <item.icon className="h-4 w-4 sm:h-5 sm:w-5" />
              <span className="text-[10px] sm:text-xs">{item.label}</span>
            </Link>
          );
        })}

        {/* Profile — shows username */}
        <Link
          to="/profile"
          className={cn(
            "flex flex-col items-center gap-0.5 rounded-full px-2.5 py-1.5 text-xs font-medium transition-all sm:px-3",
            location.pathname.startsWith("/profile")
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <User className="h-4 w-4 sm:h-5 sm:w-5" />
          <span className="max-w-[4rem] truncate text-[10px] sm:text-xs">
            {user?.username || "Profile"}
          </span>
        </Link>
      </div>
    </nav>
  );
}
