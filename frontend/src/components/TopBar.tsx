import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Music, Search, LogOut, User } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function TopBar() {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (q) {
      navigate(`/search?q=${encodeURIComponent(q)}`);
    }
  }

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-border bg-background/80 px-4 backdrop-blur-md sm:px-6">
      {/* Logo */}
      <div className="flex items-center gap-2">
        <Music className="h-6 w-6 text-primary" />
        <span className="text-lg font-bold text-gradient hidden sm:inline">Popinn</span>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="mx-auto flex w-full max-w-md items-center">
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search artists & videos..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-9 w-full rounded-full border border-border bg-secondary/50 pl-9 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </form>

      {/* User menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-2 rounded-full border border-border bg-secondary/50 px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/20">
              <User className="h-3.5 w-3.5 text-primary" />
            </div>
            <span className="hidden sm:inline">{user?.username}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onClick={() => navigate("/profile")}>
            <User className="mr-2 h-4 w-4" /> Profile
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleLogout}>
            <LogOut className="mr-2 h-4 w-4" /> Logout
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
