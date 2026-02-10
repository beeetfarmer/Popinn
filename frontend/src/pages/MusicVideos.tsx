import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { MusicVideo, Artist } from "@/data/mockData";
import VideoCard from "@/components/VideoCard";
import PageTransition from "@/components/PageTransition";
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
} from "lucide-react";
import { toast } from "sonner";

const PER_PAGE = 12;

export default function MusicVideosPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState("added_at");
  const [sortOrder, setSortOrder] = useState("desc");
  const [filterArtist, setFilterArtist] = useState("all");
  const [filterGenre, setFilterGenre] = useState("all");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: videos = [] } = useQuery<MusicVideo[]>({
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
      let valA: any, valB: any;
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

  // Reset page when filters change
  useMemo(() => setPage(1), [filterArtist, filterGenre, sortBy, sortOrder]);

  const bulkDelete = useMutation({
    mutationFn: () =>
      api.post("/videos/bulk-delete", { video_ids: Array.from(selected) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["videos"] });
      queryClient.invalidateQueries({ queryKey: ["artists"] });
      toast.success(`Deleted ${selected.size} video${selected.size > 1 ? "s" : ""}`);
      setSelected(new Set());
      setSelectMode(false);
    },
    onError: (err: any) => toast.error(err.message || "Failed to delete"),
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

  return (
    <PageTransition>
      <div>
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-foreground">Music Videos</h1>
          <span className="text-sm text-muted-foreground">({filtered.length})</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {!selectMode ? (
              <Button variant="outline" size="sm" onClick={() => setSelectMode(true)}>
                <CheckSquare className="mr-1 h-4 w-4" /> Select
              </Button>
            ) : (
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
                  onClick={() => {
                    if (confirm(`Delete ${selected.size} video${selected.size > 1 ? "s" : ""}?`)) {
                      bulkDelete.mutate();
                    }
                  }}
                >
                  <Trash2 className="mr-1 h-4 w-4" />
                  Delete ({selected.size})
                </Button>
                <Button variant="ghost" size="sm" onClick={exitSelectMode}>
                  <X className="h-4 w-4" />
                </Button>
              </>
            )}
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
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {visible.map((v) => (
            <div key={v.id} className="relative">
              {selectMode && (
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
              {selectMode && selected.has(v.id) && (
                <div className="absolute inset-0 z-[5] rounded-lg ring-2 ring-primary pointer-events-none" />
              )}
              <VideoCard video={v} />
            </div>
          ))}
        </div>

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
    </PageTransition>
  );
}
