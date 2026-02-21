import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueries, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import PageTransition from "@/components/PageTransition";
import { Plus, ListVideo, Trash2, Pencil, LayoutGrid, List } from "lucide-react";
import { toast } from "sonner";
import type { MusicVideo } from "@/data/mockData";

const WATCHLIST_VIEW_MODE_KEY = "popinn.watchlists.viewMode";

interface WatchlistItem {
  id: string;
  name: string;
  item_count: number;
  created_at: string;
}

interface WatchlistDetailData {
  id: string;
  name: string;
  item_count: number;
  created_at: string;
  videos: MusicVideo[];
}

function seededIndex(seed: string, modulo: number): number {
  if (modulo <= 0) return 0;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % modulo;
}

export default function WatchlistsPage() {
  const [newName, setNewName] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "cards">(() => {
    try {
      const stored = localStorage.getItem(WATCHLIST_VIEW_MODE_KEY);
      return stored === "cards" ? "cards" : "list";
    } catch {
      return "list";
    }
  });
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: watchlists = [], isLoading } = useQuery<WatchlistItem[]>({
    queryKey: ["watchlists"],
    queryFn: () => api.get("/watchlists/"),
  });

  const previewQueries = useQueries({
    queries: watchlists.map((wl) => ({
      queryKey: ["watchlist-preview", wl.id],
      queryFn: () => api.get<WatchlistDetailData>(`/watchlists/${wl.id}`),
      enabled: viewMode === "cards",
      staleTime: 30_000,
    })),
  });

  const previewById = useMemo(() => {
    const map: Record<string, WatchlistDetailData | undefined> = {};
    watchlists.forEach((wl, i) => {
      map[wl.id] = previewQueries[i]?.data;
    });
    return map;
  }, [watchlists, previewQueries]);

  const daySeed = useMemo(
    () => Math.floor(Date.now() / 86_400_000).toString(),
    []
  );

  const createMutation = useMutation({
    mutationFn: (name: string) => api.post("/watchlists/", { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watchlists"] });
      setNewName("");
      setOpen(false);
      toast.success("Watchlist created");
    },
    onError: () => toast.error("Failed to create watchlist"),
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.patch(`/watchlists/${id}`, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watchlists"] });
      setEditId(null);
      toast.success("Watchlist renamed");
    },
    onError: () => toast.error("Failed to rename watchlist"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/watchlists/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watchlists"] });
      toast.success("Watchlist deleted");
    },
    onError: () => toast.error("Failed to delete watchlist"),
  });

  function handleViewModeChange(mode: "list" | "cards") {
    setViewMode(mode);
    try {
      localStorage.setItem(WATCHLIST_VIEW_MODE_KEY, mode);
    } catch {
      // Ignore storage errors; UI should still work for current session.
    }
  }

  function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    createMutation.mutate(name);
  }

  function handleRename() {
    const name = editName.trim();
    if (!name || !editId) return;
    renameMutation.mutate({ id: editId, name });
  }

  return (
    <PageTransition>
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-foreground">Watchlists</h1>
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-md border border-border bg-card p-0.5">
              <button
                type="button"
                onClick={() => handleViewModeChange("list")}
                className={`rounded px-2 py-1 transition-colors ${
                  viewMode === "list"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                title="List view"
              >
                <List className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => handleViewModeChange("cards")}
                className={`rounded px-2 py-1 transition-colors ${
                  viewMode === "cards"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                title="Card view"
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
            </div>

            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="mr-1 h-4 w-4" /> New Watchlist
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Watchlist</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <Input
                    placeholder="Watchlist name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  />
                  <Button
                    onClick={handleCreate}
                    className="w-full"
                    disabled={createMutation.isPending}
                  >
                    Create
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {isLoading && <p className="text-muted-foreground">Loading...</p>}

        {!isLoading && watchlists.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <ListVideo className="mb-4 h-12 w-12 text-muted-foreground/50" />
            <p className="text-lg font-medium text-foreground">No watchlists yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create one to start organizing your videos
            </p>
          </div>
        )}

        {viewMode === "list" ? (
          <div className="space-y-3">
            {watchlists.map((wl) => (
              <div
                key={wl.id}
                className="flex cursor-pointer items-center gap-4 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/30"
                onClick={() => navigate(`/watchlists/${wl.id}`)}
              >
                <ListVideo className="h-8 w-8 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-foreground">{wl.name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {wl.item_count} video{wl.item_count !== 1 ? "s" : ""} · Created{" "}
                    {new Date(wl.created_at).toLocaleDateString()}
                  </p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditId(wl.id);
                    setEditName(wl.name);
                  }}
                  className="rounded p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  title="Rename watchlist"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Delete "${wl.name}"?`)) {
                      deleteMutation.mutate(wl.id);
                    }
                  }}
                  className="rounded p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  title="Delete watchlist"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {watchlists.map((wl) => {
              const videos = previewById[wl.id]?.videos || [];
              const randomVideo = videos.length > 0
                ? videos[seededIndex(`${wl.id}-${daySeed}`, videos.length)]
                : null;
              const thumb = randomVideo?.thumbnail_url || null;

              return (
                <div
                  key={wl.id}
                  className="group cursor-pointer overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-primary/40"
                  onClick={() => navigate(`/watchlists/${wl.id}`)}
                >
                  <div className="relative aspect-video bg-secondary">
                    {thumb ? (
                      <img
                        src={thumb}
                        alt={wl.name}
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <ListVideo className="h-10 w-10 text-muted-foreground/60" />
                      </div>
                    )}
                    <div className="absolute right-2 top-2 flex gap-1.5">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditId(wl.id);
                          setEditName(wl.name);
                        }}
                        className="rounded bg-background/80 p-1.5 text-muted-foreground transition-colors hover:text-foreground"
                        title="Rename watchlist"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Delete "${wl.name}"?`)) {
                            deleteMutation.mutate(wl.id);
                          }
                        }}
                        className="rounded bg-background/80 p-1.5 text-muted-foreground transition-colors hover:text-destructive"
                        title="Delete watchlist"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1 p-4">
                    <h3 className="truncate font-semibold text-foreground">{wl.name}</h3>
                    <p className="text-xs text-muted-foreground">
                      {wl.item_count} video{wl.item_count !== 1 ? "s" : ""} · Created{" "}
                      {new Date(wl.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Rename dialog */}
      <Dialog open={!!editId} onOpenChange={(open) => { if (!open) setEditId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Watchlist</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleRename()}
              autoFocus
            />
            <Button
              onClick={handleRename}
              className="w-full"
              disabled={renameMutation.isPending || !editName.trim()}
            >
              {renameMutation.isPending ? "Saving..." : "Rename"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </PageTransition>
  );
}
