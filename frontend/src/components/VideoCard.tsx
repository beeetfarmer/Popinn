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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
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

export default function VideoCard({ video }: VideoCardProps) {
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState(video.title);
  const [editAlbum, setEditAlbum] = useState(video.album || "");
  const [editYear, setEditYear] = useState(video.year?.toString() || "");
  const [editGenre, setEditGenre] = useState(video.genre || "");

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
    onError: (err: any) => {
      if (err.message?.includes("already")) {
        toast.info("Already in that watchlist");
      } else {
        toast.error(err.message || "Failed to add");
      }
    },
  });

  const createAndAdd = useMutation({
    mutationFn: async () => {
      const wl = await api.post<WatchlistItem>("/watchlists/", { name: "Watch Later" });
      await api.post(`/watchlists/${wl.id}/videos`, { video_id: video.id });
      return wl;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watchlists"] });
      toast.success('Created "Watch Later" and added video');
    },
    onError: (err: any) => toast.error(err.message || "Failed"),
  });

  const editMutation = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {};
      if (editTitle.trim() !== video.title) body.title = editTitle.trim();
      if (editAlbum.trim() !== (video.album || "")) body.album = editAlbum.trim() || null;
      if (editYear.trim() !== (video.year?.toString() || "")) body.year = editYear.trim() ? parseInt(editYear.trim()) : null;
      if (editGenre.trim() !== (video.genre || "")) body.genre = editGenre.trim() || null;
      return api.patch(`/videos/${video.id}`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["videos"] });
      queryClient.invalidateQueries({ queryKey: ["search-videos"] });
      setEditOpen(false);
      toast.success("Video updated");
    },
    onError: (err: any) => toast.error(err.message || "Failed to update"),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/videos/${video.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["videos"] });
      queryClient.invalidateQueries({ queryKey: ["search-videos"] });
      toast.success("Video deleted");
    },
    onError: (err: any) => toast.error(err.message || "Failed to delete"),
  });

  function handleAddToWatchlist() {
    if (watchlists.length === 0) {
      createAndAdd.mutate();
    }
  }

  return (
    <>
      <div className="group relative card-hover">
        <Link to={`/video/${video.id}`} className="block">
          <div className="relative aspect-video overflow-hidden rounded-lg">
            <img
              src={video.thumbnail_url || "/placeholder.svg"}
              alt={video.title}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
              loading="lazy"
            />
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
              <DropdownMenuItem onClick={() => { setMenuOpen(false); setEditOpen(true); }}>
                <Pencil className="mr-2 h-4 w-4" /> Edit
              </DropdownMenuItem>

              {watchlists.length > 0 ? (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <ListPlus className="mr-2 h-4 w-4" /> Add to Watchlist
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-44">
                    {watchlists.map((wl) => (
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
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ) : (
                <DropdownMenuItem onClick={handleAddToWatchlist}>
                  <ListPlus className="mr-2 h-4 w-4" /> Add to Watchlist
                </DropdownMenuItem>
              )}

              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  if (confirm(`Delete "${video.title}"?`)) {
                    deleteMutation.mutate();
                  }
                }}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Video</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
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
    </>
  );
}
