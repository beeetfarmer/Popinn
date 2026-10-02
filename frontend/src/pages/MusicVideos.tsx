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
  SlidersHorizontal,
} from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { VideoGridSkeleton } from "@/components/Skeletons";
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
        <PageHeader
          eyebrow="Library"
          title="Music videos"
          meta={videosLoading ? undefined : total}
          actions={
            <>
              <Button disabled={queueLoading} onClick={() => startLibraryQueue(false)}>
                <Play className="h-4 w-4 fill-current" /> Play all
              </Button>
              <Button variant="outline" disabled={queueLoading} onClick={() => startLibraryQueue(true)}>
                <Shuffle className="h-4 w-4" /> Shuffle
              </Button>
              {isAdmin && !selectMode ? (
                <Button variant="ghost" onClick={() => setSelectMode(true)}>
                  <CheckSquare className="h-4 w-4" /> Select
                </Button>
              ) : isAdmin ? (
                <div className="glass flex items-center gap-1 rounded-full p-1">
                  <Button variant="ghost" size="sm" onClick={toggleAll}>
                    {selected.size === visible.length && visible.length > 0 ? (
                      <><CheckSquare className="h-4 w-4" /> Deselect all</>
                    ) : (
                      <><Square className="h-4 w-4" /> Select all</>
                    )}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={selected.size === 0 || bulkDelete.isPending}
                    onClick={() => setDeleteSelectedOpen(true)}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete ({selected.size})
                  </Button>
                  <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Exit selection" onClick={exitSelectMode}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : null}
            </>
          }
        />

        {/* Filters & Sort */}
        <div className="mb-8 flex flex-wrap items-center gap-2">
          <SlidersHorizontal className="mr-1 hidden h-4 w-4 text-muted-foreground sm:block" />
          <Select value={filterArtist} onValueChange={setFilterArtist}>
            <SelectTrigger className="w-auto min-w-[10rem]">
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
            <SelectTrigger className="w-auto min-w-[9rem]">
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
            <SelectTrigger className="w-auto min-w-[9rem]">
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
            <SelectTrigger className="w-auto min-w-[8rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="desc">Newest First</SelectItem>
              <SelectItem value="asc">Oldest First</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Video grid */}
        {videosLoading && <VideoGridSkeleton count={15} />}
        {/* A later infinite-scroll page failing must not blank the videos already
            on screen -- only report the error when nothing has loaded at all. */}
        {videosError && !hasItems && (
          <p className="py-8 text-center text-destructive">Failed to load videos</p>
        )}
        {hasItems && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {visible.map((v) => (
            <div key={v.id} className="relative">
              {isAdmin && selectMode && (
                <button
                  onClick={() => toggleSelect(v.id)}
                  aria-label={selected.has(v.id) ? "Deselect video" : "Select video"}
                  className="absolute left-2 top-2 z-10 rounded-full bg-black/60 p-1.5 backdrop-blur-md transition-transform hover:scale-110"
                >
                  {selected.has(v.id) ? (
                    <CheckSquare className="h-5 w-5 text-primary" />
                  ) : (
                    <Square className="h-5 w-5 text-muted-foreground" />
                  )}
                </button>
              )}
              {isAdmin && selectMode && selected.has(v.id) && (
                <div className="pointer-events-none absolute inset-x-0 top-0 z-[5] aspect-video rounded-xl bg-primary/10 ring-2 ring-primary" />
              )}
              <VideoCard video={v} />
            </div>
          ))}
          </div>
        )}

        {!videosLoading && !videosError && total === 0 && (
          <div className="py-24 text-center">
            <p className="display text-3xl text-foreground">Nothing here</p>
            <p className="mt-2 text-sm text-muted-foreground">No videos match your filters</p>
          </div>
        )}

        {/* Infinite scroll: sentinel plus a live count, so it is clear whether
            more is coming or the end has been reached. */}
        {infiniteScroll && total > 0 && hasItems && (
          <>
            <div ref={sentinelRef} aria-hidden className="h-px" />
            <div className="mt-12 flex justify-center text-sm text-muted-foreground">
              {isFetchingNextPage ? (
                <span className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                  Loading more...
                </span>
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
          <div className="glass mx-auto mt-12 flex w-fit items-center gap-2 rounded-full p-1.5">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Previous page"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="px-3 text-sm tabular-nums text-muted-foreground">
              Page <span className="text-foreground">{page}</span> of {totalPages}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Next page"
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
