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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import PageTransition from "@/components/PageTransition";
import PageHeader from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";
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

/**
 * YouTube-style playlist cover: the first video's thumbnail with the video
 * count laid over it. Falls back to a placeholder for an empty list.
 */
function WatchlistCover({
  thumb,
  name,
  count,
  compact = false,
}: {
  thumb: string | null;
  name: string;
  count: number;
  compact?: boolean;
}) {
  return (
    <div className="relative aspect-video overflow-hidden bg-secondary">
      {thumb ? (
        <img
          src={thumb}
          alt={name}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-secondary to-muted">
          <ListVideo className={compact ? "h-6 w-6 text-muted-foreground/60" : "h-10 w-10 text-muted-foreground/60"} />
        </div>
      )}
      <span
        className={`absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-md bg-black/70 font-medium text-white backdrop-blur-md ${
          compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-xs"
        }`}
      >
        <ListVideo className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
        {count} video{count !== 1 ? "s" : ""}
      </span>
    </div>
  );
}

export default function WatchlistsPage() {
  const [newName, setNewName] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<WatchlistItem | null>(null);
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
      // Both views show a cover now, so the preview is always needed.
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
      setDeleteTarget(null);
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
      <div className="space-y-6">
        <PageHeader
          eyebrow="Your collections"
          title="Watchlists"
          meta={watchlists.length || undefined}
          actions={
            <>
            <div className="glass flex items-center rounded-full p-1">
              <button
                type="button"
                onClick={() => handleViewModeChange("list")}
                className={`relative rounded-full px-3 py-1.5 transition-colors ${
                  viewMode === "list"
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                title="List view"
              >
                <List className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => handleViewModeChange("cards")}
                className={`relative rounded-full px-3 py-1.5 transition-colors ${
                  viewMode === "cards"
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                title="Card view"
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
            </div>

            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4" /> New watchlist
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
            </>
          }
        />

        {isLoading && (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="aspect-[4/3] rounded-2xl" />
            ))}
          </div>
        )}

        {!isLoading && watchlists.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20">
              <ListVideo className="h-7 w-7 text-primary" />
            </div>
            <p className="display text-4xl text-foreground">No watchlists yet</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Create one to start organizing your videos
            </p>
          </div>
        )}

        {viewMode === "list" ? (
          <div className="space-y-2">
            {watchlists.map((wl, i) => (
              <motion.div
                key={wl.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: i * 0.04, ease: [0.22, 1, 0.36, 1] }}
                className="surface group flex cursor-pointer items-center gap-4 p-4 transition-all duration-300 hover:border-white/15 hover:bg-white/[0.04]"
                onClick={() => navigate(`/watchlists/${wl.id}`)}
              >
                <div className="w-36 shrink-0 overflow-hidden rounded-xl ring-1 ring-white/[0.08] sm:w-44">
                  <WatchlistCover
                    thumb={previewById[wl.id]?.videos[0]?.thumbnail_url || null}
                    name={wl.name}
                    count={wl.item_count}
                    compact
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-medium text-foreground">{wl.name}</h3>
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
                  className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
                  title="Rename watchlist"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteTarget(wl);
                  }}
                  className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  title="Delete watchlist"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {watchlists.map((wl, i) => {
              const thumb = previewById[wl.id]?.videos[0]?.thumbnail_url || null;

              return (
                <motion.div
                  key={wl.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: i * 0.05, ease: [0.22, 1, 0.36, 1] }}
                  className="group relative cursor-pointer"
                  onClick={() => navigate(`/watchlists/${wl.id}`)}
                >
                  {/* Stacked cards behind the cover read as "a collection". */}
                  <div className="absolute inset-x-4 -top-2 h-full rounded-2xl bg-white/[0.04] ring-1 ring-white/[0.05] transition-transform duration-500 group-hover:-translate-y-1" />
                  <div className="absolute inset-x-2 -top-1 h-full rounded-2xl bg-white/[0.06] ring-1 ring-white/[0.06] transition-transform duration-500 group-hover:-translate-y-0.5" />
                  <div className="relative overflow-hidden rounded-2xl bg-card ring-1 ring-white/[0.08] transition-all duration-500 group-hover:-translate-y-1 group-hover:ring-white/20 group-hover:shadow-[0_20px_50px_-15px_rgba(0,0,0,0.9)]">
                    <div className="relative">
                      <WatchlistCover thumb={thumb} name={wl.name} count={wl.item_count} />
                      {wl.item_count > 0 && (
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                          <span className="flex items-center gap-2 text-sm font-medium text-white">
                            <ListVideo className="h-4 w-4" /> View list
                          </span>
                        </div>
                      )}
                      <div className="absolute right-2 top-2 flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditId(wl.id);
                            setEditName(wl.name);
                          }}
                          className="rounded-full bg-black/60 p-2 text-white/80 backdrop-blur-md transition-colors hover:text-white"
                          title="Rename watchlist"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteTarget(wl);
                          }}
                          className="rounded-full bg-black/60 p-2 text-white/80 backdrop-blur-md transition-colors hover:text-destructive"
                          title="Delete watchlist"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="space-y-1 px-5 pb-5 pt-1">
                      <h3 className="display truncate text-2xl text-foreground">{wl.name}</h3>
                      <p className="text-xs text-muted-foreground">
                        {wl.item_count} video{wl.item_count !== 1 ? "s" : ""} · Created{" "}
                        {new Date(wl.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </motion.div>
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

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete watchlist?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `Delete "${deleteTarget.name}" watchlist. Videos in your library will not be deleted.`
                : "Delete this watchlist. Videos in your library will not be deleted."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
              }}
              disabled={deleteMutation.isPending || !deleteTarget}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageTransition>
  );
}
