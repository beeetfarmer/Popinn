import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MoreVertical, Pencil, Trash2, ListPlus, Play } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import type { MusicVideo } from "@/data/mockData";
import { toast } from "sonner";

interface WatchlistItem {
  id: string;
  name: string;
  item_count: number;
  created_at: string;
}

interface VideoCardProps {
  video: MusicVideo;
}

interface SpotifyTrackMatch {
  spotify_track_id: string;
  title: string;
  album: string | null;
  year: number | null;
  genre: string | null;
  artist_name: string | null;
  artist_names: string[];
}

const VIDEO_HOVER_PREVIEW_ENABLED_KEY = "videoHoverPreviewEnabled";

function getStoredHoverPreviewEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const value = window.localStorage.getItem(VIDEO_HOVER_PREVIEW_ENABLED_KEY);
    if (value === null) return true;
    return value === "1";
  } catch {
    return true;
  }
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export default function VideoCard({ video }: VideoCardProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [isHovered, setIsHovered] = useState(false);
  const [hoverPreviewEnabled] = useState(getStoredHoverPreviewEnabled);
  const [menuOpen, setMenuOpen] = useState(false);
  const [createWatchlistOpen, setCreateWatchlistOpen] = useState(false);
  const [deleteVideoOpen, setDeleteVideoOpen] = useState(false);
  const [newWatchlistName, setNewWatchlistName] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState(video.title);
  const [editAlbum, setEditAlbum] = useState(video.album || "");
  const [editYear, setEditYear] = useState(video.year?.toString() || "");
  const [editGenre, setEditGenre] = useState(video.genre || "");
  const [spotifyQuery, setSpotifyQuery] = useState(video.title);
  const [spotifySearching, setSpotifySearching] = useState(false);
  const [spotifyResults, setSpotifyResults] = useState<SpotifyTrackMatch[]>([]);
  // The 360p preview clip, never the original: brushing the mouse across a
  // grid otherwise starts streaming several full-resolution files at once.
  const hoverPreviewUrl = video.preview_url || null;
  const showHoverPreview = hoverPreviewEnabled && isHovered && !!hoverPreviewUrl;

  const { data: watchlists = [] } = useQuery<WatchlistItem[]>({
    queryKey: ["watchlists"],
    queryFn: () => api.get("/watchlists/"),
    enabled: menuOpen,
  });

  const addToWatchlist = useMutation({
    mutationFn: async (watchlistId: string) => {
      await api.post(`/watchlists/${watchlistId}/videos`, { video_id: video.id });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watchlists"] });
      toast.success("Added to watchlist");
    },
    onError: (error: unknown) => {
      const message = getErrorMessage(error, "Failed to add");
      if (message.toLowerCase().includes("already")) {
        toast.info("Already in that watchlist");
      } else {
        toast.error(message);
      }
    },
  });

  const createWatchlistAndAdd = useMutation({
    mutationFn: async (name: string) => {
      const wl = await api.post<WatchlistItem>("/watchlists/", { name });
      await api.post(`/watchlists/${wl.id}/videos`, { video_id: video.id });
      return wl;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watchlists"] });
      setCreateWatchlistOpen(false);
      setNewWatchlistName("");
      toast.success("Created watchlist and added video");
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Failed")),
  });

  const editMutation = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {};
      if (editTitle.trim() !== video.title) body.title = editTitle.trim();
      if (editAlbum.trim() !== (video.album || "")) body.album = editAlbum.trim() || null;
      if (editYear.trim() !== (video.year?.toString() || "")) {
        if (!editYear.trim()) {
          body.year = null;
        } else {
          const parsedYear = parseInt(editYear.trim(), 10);
          body.year = Number.isNaN(parsedYear) ? null : parsedYear;
        }
      }
      if (editGenre.trim() !== (video.genre || "")) body.genre = editGenre.trim() || null;
      return api.patch(`/videos/${video.id}`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["videos"] });
      queryClient.invalidateQueries({ queryKey: ["search-videos"] });
      setEditOpen(false);
      toast.success("Video updated");
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Failed to update")),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/videos/${video.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["videos"] });
      queryClient.invalidateQueries({ queryKey: ["search-videos"] });
      setDeleteVideoOpen(false);
      toast.success("Video deleted");
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Failed to delete")),
  });

  function handleCreateWatchlistAndAdd() {
    const name = newWatchlistName.trim();
    if (!name) {
      toast.error("Enter a watchlist name");
      return;
    }
    createWatchlistAndAdd.mutate(name);
  }

  function openEditDialog() {
    setEditTitle(video.title);
    setEditAlbum(video.album || "");
    setEditYear(video.year?.toString() || "");
    setEditGenre(video.genre || "");
    setSpotifyQuery(video.title);
    setSpotifyResults([]);
    setEditOpen(true);
  }

  async function searchSpotify() {
    const q = spotifyQuery.trim();
    if (!q) {
      toast.error("Enter a track name to search");
      return;
    }
    setSpotifySearching(true);
    try {
      const res = await api.get<SpotifyTrackMatch[]>(
        `/videos/spotify/search?q=${encodeURIComponent(q)}&artist_name=${encodeURIComponent(video.artist_name)}&limit=8`
      );
      setSpotifyResults(res);
      if (res.length === 0) {
        toast.info("No metadata matches found");
      }
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Failed to search for metadata"));
    } finally {
      setSpotifySearching(false);
    }
  }

  function applySpotifyTrack(match: SpotifyTrackMatch) {
    setEditTitle(match.title || editTitle);
    setEditAlbum(match.album || "");
    setEditYear(match.year ? String(match.year) : "");
    setEditGenre(match.genre || "");
    setSpotifyQuery(match.title || spotifyQuery);
    toast.success("Metadata fetched");
  }

  return (
    <>
      <div
        className="group relative card-hover"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <Link to={`/video/${video.id}`} className="block">
          <div className="relative aspect-video overflow-hidden rounded-lg">
            {showHoverPreview ? (
              <video
                src={hoverPreviewUrl || undefined}
                muted
                playsInline
                autoPlay
                loop
                preload="metadata"
                className="h-full w-full object-cover"
              />
            ) : (
              <img
                src={video.thumbnail_url || "/placeholder.svg"}
                alt={video.title}
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                loading="lazy"
              />
            )}
            <div className="absolute inset-0 flex items-center justify-center bg-background/40 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
              <Play className="h-12 w-12 text-primary" fill="hsl(25 90% 55%)" />
            </div>
            <span className="absolute bottom-2 right-2 rounded bg-background/80 px-1.5 py-0.5 text-xs font-medium text-foreground">
              {video.duration_display}
            </span>
          </div>
          <div className="mt-2 pr-8">
            <h3 className="truncate text-sm font-semibold text-foreground">{video.title}</h3>
            <p className="truncate text-xs text-muted-foreground">{video.artist_name}</p>
          </div>
        </Link>

        {/* 3-dot menu */}
        <div className="absolute right-0 top-[calc(100%-2rem)]">
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
                <MoreVertical className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {isAdmin && (
                <DropdownMenuItem onClick={() => { setMenuOpen(false); openEditDialog(); }}>
                  <Pencil className="mr-2 h-4 w-4" /> Edit
                </DropdownMenuItem>
              )}

              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <ListPlus className="mr-2 h-4 w-4" /> Add to Watchlist
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-52">
                  {watchlists.length > 0 ? (
                    watchlists.map((wl) => (
                      <DropdownMenuItem
                        key={wl.id}
                        onClick={() => addToWatchlist.mutate(wl.id)}
                      >
                        <ListPlus className="mr-2 h-4 w-4" />
                        {wl.name}
                        <span className="ml-auto text-xs text-muted-foreground">
                          {wl.item_count}
                        </span>
                      </DropdownMenuItem>
                    ))
                  ) : (
                    <DropdownMenuItem disabled>
                      No watchlists yet
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => {
                      setMenuOpen(false);
                      setCreateWatchlistOpen(true);
                    }}
                  >
                    <ListPlus className="mr-2 h-4 w-4" />
                    Create New Watchlist
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              {isAdmin && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => {
                      setMenuOpen(false);
                      setDeleteVideoOpen(true);
                    }}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="mr-2 h-4 w-4" /> Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Edit dialog */}
      <Dialog open={editOpen && isAdmin} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Video</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border border-border p-3">
              <label className="mb-1 block text-sm font-medium text-foreground">Match metadata</label>
              <div className="flex gap-2">
                <Input
                  value={spotifyQuery}
                  onChange={(e) => setSpotifyQuery(e.target.value)}
                  placeholder="Search for a track..."
                />
                <Button
                  variant="secondary"
                  onClick={searchSpotify}
                  disabled={spotifySearching || !spotifyQuery.trim()}
                >
                  {spotifySearching ? "Searching..." : "Search"}
                </Button>
              </div>
              {spotifyResults.length > 0 && (
                <div className="mt-2 max-h-44 space-y-1 overflow-y-auto pr-1">
                  {spotifyResults.map((item) => (
                    <button
                      key={item.spotify_track_id}
                      type="button"
                      onClick={() => applySpotifyTrack(item)}
                      className="w-full rounded-md border border-border px-2 py-1.5 text-left transition-colors hover:bg-secondary"
                    >
                      <p className="truncate text-xs font-semibold text-foreground">{item.title}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {(item.artist_names && item.artist_names.length > 0 ? item.artist_names.join(", ") : item.artist_name) || "Unknown artist"}
                        {item.album ? ` · ${item.album}` : ""}
                        {item.year ? ` · ${item.year}` : ""}
                      </p>
                      {item.genre && (
                        <p className="truncate text-[11px] text-muted-foreground">Genre: {item.genre}</p>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Title</label>
              <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Album</label>
              <Input value={editAlbum} onChange={(e) => setEditAlbum(e.target.value)} placeholder="Album name" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">Year</label>
                <Input type="number" value={editYear} onChange={(e) => setEditYear(e.target.value)} placeholder="2024" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">Genre</label>
                <Input value={editGenre} onChange={(e) => setEditGenre(e.target.value)} placeholder="Genre" />
              </div>
            </div>
            <Button
              onClick={() => editMutation.mutate()}
              className="w-full"
              disabled={editMutation.isPending || !editTitle.trim()}
            >
              {editMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteVideoOpen} onOpenChange={setDeleteVideoOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete video?</AlertDialogTitle>
            <AlertDialogDescription>
              Delete "{video.title}" from the library. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Create watchlist dialog */}
      <Dialog
        open={createWatchlistOpen}
        onOpenChange={(open) => {
          setCreateWatchlistOpen(open);
          if (!open) setNewWatchlistName("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Watchlist</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={newWatchlistName}
              onChange={(e) => setNewWatchlistName(e.target.value)}
              placeholder="Watchlist name"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleCreateWatchlistAndAdd();
                }
              }}
            />
            <Button
              onClick={handleCreateWatchlistAndAdd}
              className="w-full"
              disabled={createWatchlistAndAdd.isPending || !newWatchlistName.trim()}
            >
              {createWatchlistAndAdd.isPending ? "Creating..." : "Create & Add"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
