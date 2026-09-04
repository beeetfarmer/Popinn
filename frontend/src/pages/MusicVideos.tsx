import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  fetchAllVideos,
  fetchVideoPage,
  type VideoQuery,
} from "@/lib/videos";
import { useScrollRestoration } from "@/hooks/useScrollRestoration";
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
// Larger than a page: with infinite scroll the cost of a request is a pause in
// scrolling, so fewer and bigger reads feel better than many small ones.
const SCROLL_CHUNK = 24;

interface BrowsingSettings {
  video_infinite_scroll: boolean;
}

export default function MusicVideosPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { startQueue } = useQueue();
  const isAdmin = user?.role === "admin";
  const queryClient = useQueryClient();
  // Page lives in the URL, not component state. This component unmounts when
  // you open a video, so local state would be lost and you would always come
  // back to page 1 -- the URL is the only thing browser history restores.
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  // Deliberately does NOT close over `page`. An identity that changes whenever
  // the page changes would re-fire any effect listing setPage as a dependency
  // -- including the filter reset below, which would then snap straight back to
  // page 1 and make the Next button look dead. The current page is read out of
  // the params inside the updater instead.
  const setPage = useCallback(
    (next: number | ((current: number) => number)) => {
      setSearchParams(
        (params) => {
          const updated = new URLSearchParams(params);
          const current = Math.max(1, Number(updated.get("page")) || 1);
          const value = typeof next === "function" ? next(current) : next;
          if (value <= 1) updated.delete("page");
          else updated.set("page", String(value));
          return updated;
        },
        // Paging is not a destination: replacing keeps the Back button going
        // to wherever the user actually came from rather than walking back
        // through every page they clicked.
        { replace: true }
      );
    },
    [setSearchParams]
  );
  const [sortBy, setSortBy] = useState("file_created_at");
  const [sortOrder, setSortOrder] = useState("desc");
  const [filterArtist, setFilterArtist] = useState("all");
  const [filterGenre, setFilterGenre] = useState("all");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteSelectedOpen, setDeleteSelectedOpen] = useState(false);
  const [queueLoading, setQueueLoading] = useState(false);

  const { data: browsing, isLoading: browsingLoading } =
    useQuery<BrowsingSettings>({
      queryKey: ["browsing-settings"],
      queryFn: () => api.get("/settings/browsing"),
    });
  const infiniteScroll = browsing?.video_infinite_scroll ?? false;
  // Both queries stay mounted and are switched with `enabled`, so the hook order
  // never changes. Waiting for the setting first avoids firing a paged request
  // that infinite scroll would immediately discard.
  const settingsReady = !browsingLoading;

  // Filtering and sorting are the server's job now. Doing them here only ever
  // worked on whatever subset had been downloaded, which is why the library
  // appeared to be 50 videos long.
  const query: VideoQuery = useMemo(
    () => ({
      artist_id: filterArtist,
      genre: filterGenre,
      sort_by: sortBy,
      sort_order: sortOrder,
    }),
    [filterArtist, filterGenre, sortBy, sortOrder]
  );

  const pagedQuery = useQuery({
    queryKey: ["videos", "paged", query, page],
    queryFn: () => fetchVideoPage(query, (page - 1) * PER_PAGE, PER_PAGE),
    enabled: settingsReady && !infiniteScroll,
    // Keeps the previous page on screen while the next loads, instead of
    // blanking the grid on every click.
    placeholderData: keepPreviousData,
  });

  const scrollQuery = useInfiniteQuery({
    queryKey: ["videos", "scroll", query],
    queryFn: ({ pageParam }) => fetchVideoPage(query, pageParam, SCROLL_CHUNK),
    initialPageParam: 0,
    getNextPageParam: (last) => {
      const loaded = last.skip + last.items.length;
      return loaded < last.total ? loaded : undefined;
    },
    enabled: settingsReady && infiniteScroll,
  });

  const { data: artists = [] } = useQuery<Artist[]>({
    queryKey: ["artists"],
    queryFn: () => api.get("/artists/?limit=2000"),
  });

  // Genres come from the server for the same reason as the video list: a filter
  // built from the current page would only offer the genres on that page.
  const { data: genres = [] } = useQuery<string[]>({
    queryKey: ["video-genres"],
    queryFn: () => api.get("/videos/genres"),
  });

  const visible: MusicVideo[] = useMemo(() => {
    if (infiniteScroll) {
      return scrollQuery.data?.pages.flatMap((p) => p.items) ?? [];
    }
    return pagedQuery.data?.items ?? [];
  }, [infiniteScroll, scrollQuery.data, pagedQuery.data]);

  const total = infiniteScroll
    ? scrollQuery.data?.pages[0]?.total ?? 0
    : pagedQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  const videosLoading = infiniteScroll
    ? scrollQuery.isLoading
    : pagedQuery.isLoading;
  const videosError = infiniteScroll ? scrollQuery.isError : pagedQuery.isError;
  const hasItems = visible.length > 0;

  useScrollRestoration(visible.length > 0);

  // Load the next chunk slightly before the sentinel is actually visible, so
  // scrolling does not stop dead while waiting for a response.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = scrollQuery;
  useEffect(() => {
    if (!infiniteScroll) return;
    const node = sentinelRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: "600px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [infiniteScroll, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Reset page when filters/sort change -- but not on mount, which would
  // immediately discard a page restored from the URL when coming back from a
  // video.
  const filtersInitialised = useRef(false);
  // setPage is deliberately reached through a ref rather than listed as a
  // dependency. React Router rebuilds setSearchParams whenever the params
  // change, so setPage cannot be referentially stable -- listing it here means
  // every page change re-runs this effect and resets straight back to page 1,
  // which makes the pager look broken.
  const setPageRef = useRef(setPage);
  setPageRef.current = setPage;
  useEffect(() => {
    if (!filtersInitialised.current) {
      filtersInitialised.current = true;
      return;
    }
    setPageRef.current(1);
  }, [filterArtist, filterGenre, sortBy, sortOrder]);

  // A page that no longer exists (last page emptied by a delete, or a stale URL)
  // would otherwise show an empty grid with no way back.
  useEffect(() => {
    if (infiniteScroll || pagedQuery.isLoading) return;
    if (page > totalPages) setPageRef.current(totalPages);
  }, [infiniteScroll, page, totalPages, pagedQuery.isLoading]);

  const bulkDelete = useMutation({
    mutationFn: () =>
      api.post("/videos/bulk-delete", { video_ids: Array.from(selected) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["videos"] });
      queryClient.invalidateQueries({ queryKey: ["artists"] });
      queryClient.invalidateQueries({ queryKey: ["video-genres"] });
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

  // Queues the whole filtered library, not just what is on screen. The page only
  // holds a slice now, so the full set has to be fetched to play it.
  async function startLibraryQueue(shuffleQueue: boolean) {
    if (total === 0) {
      toast.error("No videos available for playback");
      return;
    }
    setQueueLoading(true);
    try {
      const all = await fetchAllVideos(query);
      if (all.length === 0) {
        toast.error("No videos available for playback");
        return;
      }
      const queue = shuffleQueue
        ? [...all].sort(() => Math.random() - 0.5)
        : all;
      startQueue(queue, { startIndex: 0 });
      navigate(`/video/${queue[0].id}`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not build the play queue"
      );
    } finally {
      setQueueLoading(false);
    }
  }

  return (
    <PageTransition>
      <div>
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-foreground">Music Videos</h1>
          <span className="text-sm text-muted-foreground">({total})</span>
          <Button
            variant="outline"
            size="sm"
            disabled={queueLoading}
            onClick={() => startLibraryQueue(false)}
          >
            <Play className="mr-1 h-4 w-4" /> Play All
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={queueLoading}
            onClick={() => startLibraryQueue(true)}
          >
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
                  {selected.size === visible.length && visible.length > 0 ? (
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
              <SelectItem value="file_created_at">Date Added</SelectItem>
              <SelectItem value="added_at">Date Scanned</SelectItem>
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
        {/* A later infinite-scroll page failing must not blank the videos already
            on screen -- only report the error when nothing has loaded at all. */}
        {videosError && !hasItems && (
          <p className="py-8 text-center text-destructive">Failed to load videos</p>
        )}
        {hasItems && (
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

        {!videosLoading && !videosError && total === 0 && (
          <p className="py-12 text-center text-muted-foreground">No videos match your filters</p>
        )}

        {/* Infinite scroll: sentinel plus a live count, so it is clear whether
            more is coming or the end has been reached. */}
        {infiniteScroll && total > 0 && hasItems && (
          <>
            <div ref={sentinelRef} aria-hidden className="h-px" />
            <div className="mt-8 text-center text-sm text-muted-foreground">
              {isFetchingNextPage ? (
                "Loading more..."
              ) : videosError ? (
                <button
                  type="button"
                  onClick={() => fetchNextPage()}
                  className="text-primary underline underline-offset-4"
                >
                  Couldn't load more videos — tap to retry
                </button>
              ) : hasNextPage ? (
                `Showing ${visible.length} of ${total}`
              ) : (
                `All ${total} videos loaded`
              )}
            </div>
          </>
        )}

        {/* Pagination */}
        {!infiniteScroll && totalPages > 1 && (
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
              disabled={page >= totalPages}
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
