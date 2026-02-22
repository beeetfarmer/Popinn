import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { MusicVideo, Artist } from "@/data/mockData";
import VideoCard from "@/components/VideoCard";
import PageTransition from "@/components/PageTransition";
import { useAuth } from "@/contexts/AuthContext";
import { useQueue } from "@/contexts/QueueContext";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChevronLeft,
  ChevronRight,
  CheckSquare,
  Square,
  Trash2,
  X,
  Play,
  Shuffle,
} from "lucide-react";
import { toast } from "sonner";
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

const PER_PAGE = 12;

export default function MusicVideosPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { startQueue } = useQueue();
  const isAdmin = user?.role === "admin";
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState("added_at");
  const [sortOrder, setSortOrder] = useState("desc");
  const [filterArtist, setFilterArtist] = useState("all");
  const [filterGenre, setFilterGenre] = useState("all");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteSelectedOpen, setDeleteSelectedOpen] = useState(false);

  const { data: videos = [], isLoading: videosLoading, isError: videosError } = useQuery<MusicVideo[]>({
    queryKey: ["videos"],
    queryFn: () => api.get("/videos/"),
  });

  const { data: artists = [] } = useQuery<Artist[]>({
    queryKey: ["artists"],
    queryFn: () => api.get("/artists/"),
  });

  const genres = useMemo(() => {
    const set = new Set<string>();
    videos.forEach((v) => { if (v.genre) set.add(v.genre); });
    return Array.from(set).sort();
  }, [videos]);

  const filtered = useMemo(() => {
    let list = [...videos];

    if (filterArtist !== "all") {
      list = list.filter((v) => v.artist_id === filterArtist);
    }
    if (filterGenre !== "all") {
      list = list.filter((v) => v.genre === filterGenre);
    }

    list.sort((a, b) => {
      let valA: string | number;
      let valB: string | number;
      switch (sortBy) {
        case "title":
          valA = a.title.toLowerCase();
          valB = b.title.toLowerCase();
          break;
        case "year":
          valA = a.year || 0;
          valB = b.year || 0;
          break;
        case "album":
          valA = (a.album || "").toLowerCase();
          valB = (b.album || "").toLowerCase();
          break;
        default:
          valA = a.added_at || "";
          valB = b.added_at || "";
      }
      if (valA < valB) return sortOrder === "asc" ? -1 : 1;
      if (valA > valB) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });

    return list;
  }, [videos, filterArtist, filterGenre, sortBy, sortOrder]);

  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const visible = useMemo(
    () => filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE),
    [filtered, page]
  );

  // Reset page when filters/sort change.
  useEffect(() => {
    setPage(1);
  }, [filterArtist, filterGenre, sortBy, sortOrder]);

  const bulkDelete = useMutation({
    mutationFn: () =>
      api.post("/videos/bulk-delete", { video_ids: Array.from(selected) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["videos"] });
      queryClient.invalidateQueries({ queryKey: ["artists"] });
      toast.success(`Deleted ${selected.size} video${selected.size > 1 ? "s" : ""}`);
      setSelected(new Set());
      setSelectMode(false);
      setDeleteSelectedOpen(false);
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Failed to delete"),
  });

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === visible.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visible.map((v) => v.id)));
    }
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
  }

  function startLibraryQueue(shuffleQueue: boolean) {
    if (filtered.length === 0) {
      toast.error("No videos available for playback");
      return;
    }
    const queue = shuffleQueue ? [...filtered].sort(() => Math.random() - 0.5) : filtered;
    startQueue(queue, { startIndex: 0 });
    navigate(`/video/${queue[0].id}`);
  }

  return (
    <PageTransition>
      <div>
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-foreground">Music Videos</h1>
          <span className="text-sm text-muted-foreground">({filtered.length})</span>
          <Button variant="outline" size="sm" onClick={() => startLibraryQueue(false)}>
            <Play className="mr-1 h-4 w-4" /> Play All
          </Button>
          <Button variant="outline" size="sm" onClick={() => startLibraryQueue(true)}>
            <Shuffle className="mr-1 h-4 w-4" /> Shuffle
          </Button>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {isAdmin && !selectMode ? (
              <Button variant="outline" size="sm" onClick={() => setSelectMode(true)}>
                <CheckSquare className="mr-1 h-4 w-4" /> Select
              </Button>
            ) : isAdmin ? (
              <>
                <Button variant="outline" size="sm" onClick={toggleAll}>
                  {selected.size === visible.length ? (
                    <><CheckSquare className="mr-1 h-4 w-4" /> Deselect All</>
                  ) : (
                    <><Square className="mr-1 h-4 w-4" /> Select All</>
                  )}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={selected.size === 0 || bulkDelete.isPending}
                  onClick={() => setDeleteSelectedOpen(true)}
                >
                  <Trash2 className="mr-1 h-4 w-4" />
                  Delete ({selected.size})
                </Button>
                <Button variant="ghost" size="sm" onClick={exitSelectMode}>
                  <X className="h-4 w-4" />
                </Button>
              </>
            ) : null}
          </div>
        </div>

        {/* Filters & Sort */}
        <div className="mb-6 flex flex-wrap gap-3">
          <Select value={filterArtist} onValueChange={setFilterArtist}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All Artists" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Artists</SelectItem>
              {artists.map((a) => (
                <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filterGenre} onValueChange={setFilterGenre}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="All Genres" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Genres</SelectItem>
              {genres.map((g) => (
                <SelectItem key={g} value={g}>{g}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="added_at">Date Added</SelectItem>
              <SelectItem value="title">Title</SelectItem>
              <SelectItem value="year">Year</SelectItem>
              <SelectItem value="album">Album</SelectItem>
            </SelectContent>
          </Select>

          <Select value={sortOrder} onValueChange={setSortOrder}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="desc">Newest First</SelectItem>
              <SelectItem value="asc">Oldest First</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Video grid */}
        {videosLoading && (
          <p className="py-8 text-center text-muted-foreground">Loading videos...</p>
        )}
        {videosError && (
          <p className="py-8 text-center text-destructive">Failed to load videos</p>
        )}
        {!videosLoading && !videosError && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {visible.map((v) => (
            <div key={v.id} className="relative">
              {isAdmin && selectMode && (
                <button
                  onClick={() => toggleSelect(v.id)}
                  className="absolute left-2 top-2 z-10 rounded bg-background/80 p-1"
                >
                  {selected.has(v.id) ? (
                    <CheckSquare className="h-5 w-5 text-primary" />
                  ) : (
                    <Square className="h-5 w-5 text-muted-foreground" />
                  )}
                </button>
              )}
              {isAdmin && selectMode && selected.has(v.id) && (
                <div className="absolute inset-0 z-[5] rounded-lg ring-2 ring-primary pointer-events-none" />
              )}
              <VideoCard video={v} />
            </div>
          ))}
          </div>
        )}

        {filtered.length === 0 && (
          <p className="py-12 text-center text-muted-foreground">No videos match your filters</p>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-8 flex items-center justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page === totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      <AlertDialog open={deleteSelectedOpen} onOpenChange={setDeleteSelectedOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete selected videos?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete {selected.size} video{selected.size !== 1 ? "s" : ""} from the library.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDelete.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => bulkDelete.mutate()}
              disabled={bulkDelete.isPending || selected.size === 0}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {bulkDelete.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageTransition>
  );
}
