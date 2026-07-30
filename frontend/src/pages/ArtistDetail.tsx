import { useState, useCallback, useEffect, useRef } from "react";
import {
  useParams,
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useScrollRestoration } from "@/hooks/useScrollRestoration";
import type { ArtistDetail as ArtistDetailType } from "@/data/mockData";
import VideoCard from "@/components/VideoCard";
import PageTransition from "@/components/PageTransition";
import { ArrowLeft, Upload, Pencil, Play, Shuffle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
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
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useQueue } from "@/contexts/QueueContext";

const PER_PAGE = 10;
// How many cards infinite scroll adds at a time. The artist payload already
// contains every video, so this only limits how many are mounted at once --
// which is the part that makes a large artist page slow.
const SCROLL_CHUNK = 24;
const LASTFM_ATTRIBUTION_FOOTER_REGEX =
  /\n*\s*Artist information powered by Last\.fm\s*\n*Last\.fm:\s*(https?:\/\/www\.last\.fm\/music\/\S+)\s*$/i;

interface SpotifyTrackMatch {
  spotify_track_id: string;
  title: string;
  album: string | null;
  year: number | null;
  genre: string | null;
  artist_name: string | null;
  artist_names: string[];
}

interface MetadataRow {
  videoId: string;
  originalTitle: string;
  originalAlbum: string;
  originalYear: string;
  originalGenre: string;
  title: string;
  album: string;
  year: string;
  genre: string;
  spotifyQuery: string;
  spotifySearching: boolean;
  spotifyResults: SpotifyTrackMatch[];
  showMatchOptions: boolean;
}

interface RecommendedArtistItem {
  id: string;
  name: string;
  bio: string | null;
  image_url: string | null;
  video_count: number;
  play_count: number;
  created_at: string | null;
  lastfm_match: number | null;
}

interface ArtistRecommendationsPage {
  items: RecommendedArtistItem[];
  offset: number;
  limit: number;
  has_more: boolean;
}

interface LastfmArtistSearchItem {
  name: string;
  image_url: string | null;
  url: string | null;
}

interface BrowsingSettings {
  video_infinite_scroll: boolean;
}

function getResponsiveRecommendationLimit(): number {
  if (typeof window === "undefined") return 6;
  if (window.innerWidth < 640) return 2;
  if (window.innerWidth < 1024) return 4;
  return 6;
}

function parseArtistBio(rawBio: string | null | undefined): { body: string; lastfmUrl: string | null } {
  const text = rawBio || "";
  const match = text.match(LASTFM_ATTRIBUTION_FOOTER_REGEX);
  const lastfmUrl = match?.[1] || null;
  const body = text.replace(LASTFM_ATTRIBUTION_FOOTER_REGEX, "").trim();
  return { body, lastfmUrl };
}

function getCookie(name: string): string | null {
  const match = document.cookie
    .split("; ")
    .find((part) => part.startsWith(`${name}=`));
  if (!match) return null;
  return decodeURIComponent(match.split("=")[1] || "");
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export default function ArtistDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { startQueue } = useQueue();
  const isAdmin = user?.role === "admin";
  const queryClient = useQueryClient();
  const [dragOver, setDragOver] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editBio, setEditBio] = useState("");
  const [editLastfmArtistName, setEditLastfmArtistName] = useState("");
  const [lastfmSearchQuery, setLastfmSearchQuery] = useState("");
  const [lastfmSearching, setLastfmSearching] = useState(false);
  const [lastfmSearchResults, setLastfmSearchResults] = useState<LastfmArtistSearchItem[]>([]);
  const [lastfmUrlInput, setLastfmUrlInput] = useState("");
  const [applyingLastfmUrl, setApplyingLastfmUrl] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [metadataOpen, setMetadataOpen] = useState(false);
  const [metadataRows, setMetadataRows] = useState<MetadataRow[]>([]);
  const [metadataSaving, setMetadataSaving] = useState(false);
  const [searchAllRunning, setSearchAllRunning] = useState(false);
  const [artistRecPage, setArtistRecPage] = useState(1);
  const [artistRecBaseLimit, setArtistRecBaseLimit] = useState(
    getResponsiveRecommendationLimit
  );
  // Same reasoning as the videos list: opening a video unmounts this page, so
  // the page number has to live in the URL to survive coming back. setPage must
  // not close over `page`, or effects depending on it re-fire on every change.
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
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
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const { data: artist, isLoading, isError } = useQuery<ArtistDetailType>({
    queryKey: ["artist", id],
    queryFn: () => api.get(`/artists/${id}`),
    enabled: !!id,
  });

  const { data: browsing } = useQuery<BrowsingSettings>({
    queryKey: ["browsing-settings"],
    queryFn: () => api.get("/settings/browsing"),
  });
  const infiniteScroll = browsing?.video_infinite_scroll ?? false;

  // How many cards are mounted, kept per history entry so returning from a video
  // shows the same stretch of the list rather than snapping back to the first
  // chunk. Scroll position alone is not enough: without the count the page is
  // too short to scroll back down to.
  const location = useLocation();
  // Two keys for the same reason as scroll restoration: an in-app back link is
  // a push, so it lands on a new history entry with nothing stored against it.
  // The path fallback is what makes returning to this artist keep its place.
  const shownEntryKey = `popinn:shown:key:${location.key}`;
  const shownPathKey = `popinn:shown:path:${location.pathname}`;
  const [visibleCount, setVisibleCount] = useState(() => {
    try {
      const saved = Number(
        sessionStorage.getItem(shownEntryKey) ??
          sessionStorage.getItem(shownPathKey)
      );
      return Number.isFinite(saved) && saved >= SCROLL_CHUNK ? saved : SCROLL_CHUNK;
    } catch {
      return SCROLL_CHUNK;
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(shownEntryKey, String(visibleCount));
      sessionStorage.setItem(shownPathKey, String(visibleCount));
    } catch {
      // Not worth breaking the page over a storage quota.
    }
  }, [shownEntryKey, shownPathKey, visibleCount]);
  useEffect(() => {
    setVisibleCount(SCROLL_CHUNK);
  }, [id]);

  const totalArtistVideos = artist?.videos.length ?? 0;
  const canShowMore = infiniteScroll && visibleCount < totalArtistVideos;
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!canShowMore) return;
    const node = sentinelRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((current) =>
            Math.min(current + SCROLL_CHUNK, totalArtistVideos)
          );
        }
      },
      { rootMargin: "600px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [canShowMore, totalArtistVideos]);

  useScrollRestoration(totalArtistVideos > 0);
  const recommendationLimit = artistRecPage * artistRecBaseLimit;
  const { data: artistRecommendations, isLoading: artistRecommendationsLoading } =
    useQuery<ArtistRecommendationsPage>({
      queryKey: ["artist-recommendations", id, recommendationLimit],
      queryFn: () =>
        api.get(
          `/artists/${id}/recommendations?offset=0&limit=${recommendationLimit}`
        ),
      enabled: !!id,
      staleTime: 120_000,
    });

  useEffect(() => {
    function onResize() {
      setArtistRecBaseLimit(getResponsiveRecommendationLimit());
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    setArtistRecPage(1);
  }, [id, artistRecBaseLimit]);

  const uploadImage = useMutation({
    mutationFn: async (file: File) => {
      if (!isAdmin) throw new Error("Admin access required");
      const formData = new FormData();
      formData.append("file", file);
      const csrf = getCookie("popinn_csrf_token");
      const res = await fetch(`/api/v1/artists/${id}/image`, {
        method: "PUT",
        headers: csrf ? { "X-CSRF-Token": csrf } : {},
        credentials: "include",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Upload failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["artist", id] });
      queryClient.invalidateQueries({ queryKey: ["artists"] });
      toast.success("Artist image updated");
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Failed to upload image")),
  });

  const editMutation = useMutation({
    mutationFn: () => {
      if (!isAdmin) throw new Error("Admin access required");
      const body: Record<string, unknown> = {};
      if (editName.trim() && editName.trim() !== artist?.name) body.name = editName.trim();
      if (editBio.trim() !== (artist?.bio || "")) body.bio = editBio.trim() || null;
      if ((editLastfmArtistName.trim() || null) !== (artist?.lastfm_artist_name || null)) {
        body.lastfm_artist_name = editLastfmArtistName.trim() || null;
      }
      return api.patch(`/artists/${id}`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["artist", id] });
      queryClient.invalidateQueries({ queryKey: ["artists"] });
      setEditOpen(false);
      toast.success("Artist updated");
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Failed to update")),
  });

  const refreshMetadataMutation = useMutation({
    mutationFn: () => api.post(`/artists/${id}/refresh-metadata`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["artist", id] });
      queryClient.invalidateQueries({ queryKey: ["artists"] });
      toast.success("Artist info refresh completed");
    },
    onError: (error: unknown) =>
      toast.error(getErrorMessage(error, "Failed to refresh artist metadata")),
  });

  const resetMetadataMutation = useMutation({
    mutationFn: () => api.post(`/artists/${id}/reset-metadata`),
    onSuccess: (updated: { bio: string | null; lastfm_artist_name: string | null }) => {
      queryClient.invalidateQueries({ queryKey: ["artist", id] });
      queryClient.invalidateQueries({ queryKey: ["artists"] });
      // Keep the open dialog consistent with what the server now holds.
      setEditBio(parseArtistBio(updated.bio).body);
      setEditLastfmArtistName(updated.lastfm_artist_name || "");
      setLastfmSearchQuery(updated.lastfm_artist_name || artist?.name || "");
      setLastfmSearchResults([]);
      setLastfmUrlInput("");
      setResetOpen(false);
      toast.success("Artist bio and image reset");
    },
    onError: (error: unknown) =>
      toast.error(getErrorMessage(error, "Failed to reset artist")),
  });

  function openEdit() {
    if (artist) {
      setEditName(artist.name);
      setEditBio(parseArtistBio(artist.bio).body);
      setEditLastfmArtistName(artist.lastfm_artist_name || "");
      setLastfmSearchQuery(artist.lastfm_artist_name || artist.name);
      setLastfmSearchResults([]);
      setLastfmUrlInput(parseArtistBio(artist.bio).lastfmUrl || "");
      setEditOpen(true);
    }
  }

  async function searchLastfmArtists() {
    if (!isAdmin) return;
    const query = lastfmSearchQuery.trim();
    if (!query) {
      toast.error("Enter an artist name to search Last.fm");
      return;
    }
    setLastfmSearching(true);
    try {
      const results = await api.get<LastfmArtistSearchItem[]>(
        `/artists/lastfm/search?q=${encodeURIComponent(query)}&limit=8`
      );
      setLastfmSearchResults(results);
      if (results.length === 0) {
        toast.info("No Last.fm matches found");
      }
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Failed to search Last.fm"));
    } finally {
      setLastfmSearching(false);
    }
  }

  async function applyLastfmArtistMatch(artistName: string) {
    if (!isAdmin) return;
    try {
      const updated = await api.post<{
        lastfm_artist_name: string | null;
        bio: string | null;
      }>(`/artists/${id}/lastfm/apply`, {
        lastfm_artist_name: artistName,
      });
      const matchedName = updated.lastfm_artist_name || artistName;
      setEditLastfmArtistName(matchedName);
      setLastfmSearchQuery(matchedName);
      setEditBio(parseArtistBio(updated.bio).body);
      queryClient.invalidateQueries({ queryKey: ["artist", id] });
      queryClient.invalidateQueries({ queryKey: ["artists"] });
      toast.success("Last.fm match applied");
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Failed to apply Last.fm artist"));
    }
  }

  // Pasting the artist's Last.fm page is the reliable way to pin down an artist
  // that search cannot disambiguate. The name is extracted server-side, which is
  // also where the URL is validated.
  async function applyLastfmUrl() {
    if (!isAdmin) return;
    const url = lastfmUrlInput.trim();
    if (!url) {
      toast.error("Paste a Last.fm artist link first");
      return;
    }
    setApplyingLastfmUrl(true);
    try {
      const updated = await api.post<{
        lastfm_artist_name: string | null;
        bio: string | null;
      }>(`/artists/${id}/lastfm/apply`, { lastfm_url: url });
      const matchedName = updated.lastfm_artist_name || "";
      setEditLastfmArtistName(matchedName);
      setLastfmSearchQuery(matchedName);
      setEditBio(parseArtistBio(updated.bio).body);
      queryClient.invalidateQueries({ queryKey: ["artist", id] });
      queryClient.invalidateQueries({ queryKey: ["artists"] });
      toast.success(
        matchedName
          ? `Applied Last.fm artist "${matchedName}"`
          : "Last.fm link applied"
      );
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Failed to apply Last.fm link"));
    } finally {
      setApplyingLastfmUrl(false);
    }
  }

  function openMetadataEditor() {
    if (!artist) return;
    setMetadataRows(
      artist.videos.map((video) => ({
        videoId: video.id,
        originalTitle: video.title,
        originalAlbum: video.album || "",
        originalYear: video.year ? String(video.year) : "",
        originalGenre: video.genre || "",
        title: video.title,
        album: video.album || "",
        year: video.year ? String(video.year) : "",
        genre: video.genre || "",
        spotifyQuery: video.title,
        spotifySearching: false,
        spotifyResults: [],
        showMatchOptions: false,
      }))
    );
    setMetadataOpen(true);
  }

  function updateMetadataRow(
    videoId: string,
    field: "title" | "album" | "year" | "genre" | "spotifyQuery",
    value: string
  ) {
    setMetadataRows((prev) =>
      prev.map((row) =>
        row.videoId === videoId
          ? field === "spotifyQuery"
            ? { ...row, spotifyQuery: value, showMatchOptions: false, spotifyResults: [] }
            : { ...row, [field]: value }
          : row
      )
    );
  }

  async function searchSpotifyForRow(videoId: string) {
    const row = metadataRows.find((item) => item.videoId === videoId);
    if (!row) return;
    const query = row.spotifyQuery.trim() || row.title.trim();
    if (!query) {
      toast.error("Enter a track name to search Spotify");
      return;
    }

    setMetadataRows((prev) =>
      prev.map((item) =>
        item.videoId === videoId ? { ...item, spotifySearching: true } : item
      )
    );
    try {
      const results = await api.get<SpotifyTrackMatch[]>(
        `/videos/spotify/search?q=${encodeURIComponent(query)}&artist_name=${encodeURIComponent(artist.name)}&limit=8`
      );
      setMetadataRows((prev) =>
        prev.map((item) =>
          item.videoId === videoId
            ? {
                ...item,
                spotifySearching: false,
                spotifyResults: results,
                showMatchOptions: true,
              }
            : item
        )
      );
      if (results.length === 0) {
        toast.info(`No Spotify matches for "${query}"`);
      }
    } catch (error: unknown) {
      setMetadataRows((prev) =>
        prev.map((item) =>
          item.videoId === videoId
            ? { ...item, spotifySearching: false, showMatchOptions: false }
            : item
        )
      );
      toast.error(getErrorMessage(error, "Failed to search Spotify"));
    }
  }

  function applySpotifyMatch(videoId: string, match: SpotifyTrackMatch) {
    setMetadataRows((prev) =>
      prev.map((item) =>
        item.videoId === videoId
          ? {
              ...item,
              title: match.title || item.title,
              album: match.album || "",
              year: match.year ? String(match.year) : "",
              genre: match.genre || "",
              spotifyQuery: match.title || item.spotifyQuery,
            }
          : item
      )
    );
    toast.success("Metadata fetched from Spotify");
  }

  async function saveMetadataChanges() {
    if (!artist) return;
    const updates = metadataRows
      .map((row) => {
        const body: Record<string, unknown> = {};
        if (row.title.trim() !== row.originalTitle) body.title = row.title.trim();
        if (row.album.trim() !== row.originalAlbum) body.album = row.album.trim() || null;
        if (row.genre.trim() !== row.originalGenre) body.genre = row.genre.trim() || null;
        if (row.year.trim() !== row.originalYear) {
          if (!row.year.trim()) {
            body.year = null;
          } else {
            const parsedYear = parseInt(row.year.trim(), 10);
            body.year = Number.isNaN(parsedYear) ? null : parsedYear;
          }
        }
        return { videoId: row.videoId, body };
      })
      .filter((item) => Object.keys(item.body).length > 0);

    if (updates.length === 0) {
      toast.info("No metadata changes to save");
      return;
    }

    setMetadataSaving(true);
    try {
      await Promise.all(
        updates.map((item) => api.patch(`/videos/${item.videoId}`, item.body))
      );
      queryClient.invalidateQueries({ queryKey: ["artist", id] });
      queryClient.invalidateQueries({ queryKey: ["artists"] });
      queryClient.invalidateQueries({ queryKey: ["videos"] });
      queryClient.invalidateQueries({ queryKey: ["search-videos"] });
      setMetadataOpen(false);
      toast.success(`Updated ${updates.length} music video${updates.length !== 1 ? "s" : ""}`);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Failed to save music video metadata"));
    } finally {
      setMetadataSaving(false);
    }
  }

  async function searchSpotifyForAllRows() {
    if (!artist || metadataRows.length === 0) return;
    setSearchAllRunning(true);
    setMetadataRows((prev) => prev.map((row) => ({ ...row, spotifySearching: true })));

    try {
      const resultsByVideoId = await Promise.all(
        metadataRows.map(async (row) => {
          const query = row.spotifyQuery.trim() || row.title.trim();
          if (!query) {
            return { videoId: row.videoId, results: [] as SpotifyTrackMatch[] };
          }
          try {
            const results = await api.get<SpotifyTrackMatch[]>(
              `/videos/spotify/search?q=${encodeURIComponent(query)}&artist_name=${encodeURIComponent(artist.name)}&limit=8`
            );
            return { videoId: row.videoId, results };
          } catch {
            return { videoId: row.videoId, results: [] as SpotifyTrackMatch[] };
          }
        })
      );

      const resultMap = new Map(resultsByVideoId.map((item) => [item.videoId, item.results]));
      const updatedRows = metadataRows.map((row) => {
        const results = resultMap.get(row.videoId) || [];
        const first = results[0];
        if (!first) {
          return {
            ...row,
            spotifySearching: false,
            spotifyResults: results,
            showMatchOptions: false,
          };
        }
        return {
          ...row,
          title: first.title || row.title,
          album: first.album || "",
          year: first.year ? String(first.year) : "",
          genre: first.genre || "",
          spotifyQuery: first.title || row.spotifyQuery,
          spotifySearching: false,
          spotifyResults: results,
          showMatchOptions: false,
        };
      });
      const filledCount = updatedRows.filter((row) => row.spotifyResults.length > 0).length;
      const noMatchCount = updatedRows.length - filledCount;

      setMetadataRows(updatedRows);

      toast.success(`Search all complete. Filled ${filledCount} video${filledCount !== 1 ? "s" : ""}.`);
      if (noMatchCount > 0) {
        toast.info(`No Spotify match for ${noMatchCount} video${noMatchCount !== 1 ? "s" : ""}.`);
      }
    } finally {
      setSearchAllRunning(false);
    }
  }

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith("image/")) {
        uploadImage.mutate(file);
      } else {
        toast.error("Please drop an image file");
      }
    },
    [uploadImage]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) uploadImage.mutate(file);
      e.target.value = "";
    },
    [uploadImage]
  );

  if (!artist) {
    if (isLoading) return <p className="text-muted-foreground">Loading artist...</p>;
    if (isError) return <p className="text-destructive">Failed to load artist</p>;
    return <p className="text-muted-foreground">Artist not found</p>;
  }

  const totalPages = Math.max(1, Math.ceil(artist.videos.length / PER_PAGE));
  const start = (page - 1) * PER_PAGE;
  const shownVideos = infiniteScroll
    ? artist.videos.slice(0, visibleCount)
    : artist.videos.slice(start, start + PER_PAGE);
  const parsedBio = parseArtistBio(artist.bio);

  function startArtistQueue(shuffleQueue: boolean) {
    if (artist.videos.length === 0) {
      toast.error("No videos available for this artist");
      return;
    }
    const queue = shuffleQueue
      ? [...artist.videos].sort(() => Math.random() - 0.5)
      : artist.videos;
    startQueue(queue, { startIndex: 0 });
    navigate(`/video/${queue[0].id}`);
  }

  return (
    <PageTransition>
      <div>
        <Link
          to="/artists"
          className="mb-6 inline-flex items-center gap-1 text-sm text-primary hover:text-primary/80"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Artists
        </Link>

        {/* Header */}
        <div className="mt-4 flex flex-col items-center gap-6 sm:flex-row sm:items-start">
          {/* Drag & drop image area */}
          <div
            className={`relative h-40 w-40 shrink-0 overflow-hidden rounded-full border-2 transition-colors cursor-pointer ${
              dragOver
                ? "border-primary bg-primary/10"
                : "border-primary hover:border-primary/70"
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              if (isAdmin) setDragOver(true);
            }}
            onDragLeave={() => isAdmin && setDragOver(false)}
            onDrop={isAdmin ? handleDrop : undefined}
            onClick={isAdmin ? () => document.getElementById("artist-image-input")?.click() : undefined}
            title={isAdmin ? "Drag & drop or click to change artist image" : "Artist image"}
          >
            <img
              src={artist.image_url || "/placeholder.svg"}
              alt={artist.name}
              className={`h-full w-full object-cover transition-opacity ${
                dragOver || uploadImage.isPending ? "opacity-40" : ""
              }`}
            />
            {isAdmin && (
              <>
                <div
                  className={`absolute inset-0 flex flex-col items-center justify-center transition-opacity ${
                    dragOver || uploadImage.isPending ? "opacity-100" : "opacity-0 hover:opacity-100"
                  }`}
                >
                  <div className="rounded-full bg-background/80 p-2">
                    <Upload className="h-5 w-5 text-primary" />
                  </div>
                  <span className="mt-1 text-xs font-medium text-foreground">
                    {uploadImage.isPending ? "Uploading..." : "Change Image"}
                  </span>
                </div>
                <input
                  id="artist-image-input"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileSelect}
                />
              </>
            )}
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-bold text-foreground">{artist.name}</h1>
              {isAdmin && (
                <button
                  onClick={openEdit}
                  className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  title="Edit artist"
                >
                  <Pencil className="h-4 w-4" />
                </button>
              )}
            </div>
            <p className="mt-2 max-w-xl whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
              {parsedBio.body || "No artist bio available."}
            </p>
            {parsedBio.lastfmUrl && (
              <p className="mt-2 text-xs text-muted-foreground">
                Artist information powered by Last.fm ·{" "}
                <a
                  href={parsedBio.lastfmUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline"
                >
                  Last.fm artist page
                </a>
              </p>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              {artist.videos.length} music video{artist.videos.length !== 1 && "s"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {artist.play_count || 0} view{(artist.play_count || 0) !== 1 && "s"}
            </p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="outline" onClick={() => startArtistQueue(false)}>
                <Play className="mr-1 h-4 w-4" /> Play All
              </Button>
              <Button size="sm" variant="outline" onClick={() => startArtistQueue(true)}>
                <Shuffle className="mr-1 h-4 w-4" /> Shuffle
              </Button>
              {isAdmin && (
                <Button size="sm" variant="outline" onClick={openMetadataEditor}>
                  Edit MV Metadata
                </Button>
              )}
              {isAdmin && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => refreshMetadataMutation.mutate()}
                  disabled={refreshMetadataMutation.isPending}
                >
                  {refreshMetadataMutation.isPending ? "Refreshing..." : "Refresh Info"}
                </Button>
              )}
            </div>
          </div>
        </div>

        <h2 className="mb-4 mt-10 text-xl font-bold text-foreground">Music Videos</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {shownVideos.map((v) => (
            <VideoCard key={v.id} video={v} />
          ))}
        </div>
        {infiniteScroll && artist.videos.length > 0 && (
          <>
            <div ref={sentinelRef} aria-hidden className="h-px" />
            <div className="mt-6 text-center text-sm text-muted-foreground">
              {canShowMore
                ? `Showing ${shownVideos.length} of ${artist.videos.length}`
                : `All ${artist.videos.length} videos loaded`}
            </div>
          </>
        )}
        {!infiniteScroll && artist.videos.length > PER_PAGE && (
          <div className="mt-6 flex items-center justify-center gap-3">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </Button>
          </div>
        )}
        <section className="mt-10 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-foreground">
              Recommended Artists (Last.fm)
            </h2>
            {artistRecommendations?.has_more && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setArtistRecPage((prev) => prev + 1)}
              >
                See more
              </Button>
            )}
          </div>
          {artistRecommendationsLoading ? (
            <p className="text-sm text-muted-foreground">Loading recommendations...</p>
          ) : artistRecommendations && artistRecommendations.items.length > 0 ? (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {artistRecommendations.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigate(`/artist/${item.id}`)}
                  className="w-64 shrink-0 rounded-xl p-4 text-center transition-colors hover:bg-secondary/40"
                >
                  <div className="mx-auto mb-3 h-40 w-40 overflow-hidden rounded-full bg-secondary">
                    {item.image_url ? (
                      <img
                        src={item.image_url}
                        alt={item.name}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xl font-semibold text-muted-foreground">
                        {item.name.slice(0, 1).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <p className="truncate text-sm font-semibold text-foreground">{item.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.video_count} video{item.video_count !== 1 ? "s" : ""}
                  </p>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No recommended artists from your library for this artist yet.
            </p>
          )}
        </section>
        {/* Edit dialog */}
        <Dialog open={editOpen && isAdmin} onOpenChange={setEditOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Artist</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">Name</label>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">Bio</label>
                <Textarea
                  value={editBio}
                  onChange={(e) => setEditBio(e.target.value)}
                  rows={4}
                  placeholder="Artist biography..."
                />
              </div>
              <div className="rounded-md border border-border p-3">
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Match Artist from Last.fm
                </label>
                <div className="flex gap-2">
                  <Input
                    value={lastfmSearchQuery}
                    onChange={(e) => setLastfmSearchQuery(e.target.value)}
                    placeholder="Search Last.fm artist..."
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={searchLastfmArtists}
                    disabled={lastfmSearching || !lastfmSearchQuery.trim()}
                  >
                    {lastfmSearching ? "Searching..." : "Search"}
                  </Button>
                </div>
                {lastfmSearchResults.length > 0 && (
                  <div className="mt-2 max-h-44 space-y-1 overflow-y-auto pr-1">
                    {lastfmSearchResults.map((item) => (
                      <button
                        key={item.url || item.name}
                        type="button"
                        onClick={() => applyLastfmArtistMatch(item.name)}
                        className="w-full rounded-md border border-border px-2 py-1.5 text-left transition-colors hover:bg-secondary"
                      >
                        <p className="truncate text-xs font-semibold text-foreground">{item.name}</p>
                        {item.url && (
                          <p className="truncate text-[11px] text-muted-foreground">{item.url}</p>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                <p className="mt-2 text-xs text-muted-foreground">
                  Matched artist: {editLastfmArtistName || "Not set"}
                </p>

                <div className="mt-3 border-t border-border pt-3">
                  <label className="mb-1 block text-sm font-medium text-foreground">
                    Or paste a Last.fm artist link
                  </label>
                  <div className="flex gap-2">
                    <Input
                      value={lastfmUrlInput}
                      onChange={(e) => setLastfmUrlInput(e.target.value)}
                      placeholder="https://www.last.fm/music/Artist"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={applyLastfmUrl}
                      disabled={applyingLastfmUrl || !lastfmUrlInput.trim()}
                    >
                      {applyingLastfmUrl ? "Applying..." : "Apply"}
                    </Button>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Refreshes the bio and image from that exact artist page.
                  </p>
                </div>
              </div>
              <Button
                onClick={() => editMutation.mutate()}
                className="w-full"
                disabled={editMutation.isPending || !editName.trim()}
              >
                {editMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
              <Button
                variant="outline"
                onClick={() => refreshMetadataMutation.mutate()}
                className="w-full"
                disabled={refreshMetadataMutation.isPending}
              >
                {refreshMetadataMutation.isPending
                  ? "Refreshing Info..."
                  : "Refresh Info"}
              </Button>
              <Button
                variant="outline"
                onClick={() => setResetOpen(true)}
                className="w-full text-destructive hover:text-destructive"
                disabled={resetMetadataMutation.isPending}
              >
                {resetMetadataMutation.isPending
                  ? "Resetting..."
                  : "Reset Bio & Image"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reset bio and image?</AlertDialogTitle>
              <AlertDialogDescription>
                This clears the bio, the image and the matched Last.fm artist for
                {" "}
                {artist.name}, deletes any image you uploaded, then looks the
                artist up on Last.fm again by folder name. Your local edits
                cannot be recovered.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={resetMetadataMutation.isPending}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => resetMetadataMutation.mutate()}
                disabled={resetMetadataMutation.isPending}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {resetMetadataMutation.isPending ? "Resetting..." : "Reset"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Dialog open={metadataOpen && isAdmin} onOpenChange={setMetadataOpen}>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>Edit MV Metadata</DialogTitle>
            </DialogHeader>
            {metadataRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No music videos for this artist.</p>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Match each music video with a Spotify track to autofill title, album, release year, and genre.
                </p>
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={searchSpotifyForAllRows}
                    disabled={searchAllRunning}
                  >
                    {searchAllRunning ? "Searching All..." : "Search All"}
                  </Button>
                </div>
                <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-1">
                  {metadataRows.map((row) => (
                    <div key={row.videoId} className="rounded-lg border border-border p-3">
                      <p className="text-xs text-muted-foreground">
                        Original MV Name: <span className="font-medium text-foreground">{row.originalTitle}</span>
                      </p>
                      <div className="mt-2 flex gap-2">
                        <Input
                          value={row.spotifyQuery}
                          onChange={(e) => updateMetadataRow(row.videoId, "spotifyQuery", e.target.value)}
                          placeholder="Search Spotify track..."
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => searchSpotifyForRow(row.videoId)}
                          disabled={row.spotifySearching}
                        >
                          {row.spotifySearching ? "Searching..." : "Search"}
                        </Button>
                      </div>
                      {row.showMatchOptions && row.spotifyResults.length > 0 && (
                        <div className="mt-2 max-h-36 space-y-1 overflow-y-auto pr-1">
                          {row.spotifyResults.map((item) => (
                            <button
                              key={item.spotify_track_id}
                              type="button"
                              onClick={() => applySpotifyMatch(row.videoId, item)}
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
                      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <Input
                          value={row.title}
                          onChange={(e) => updateMetadataRow(row.videoId, "title", e.target.value)}
                          placeholder="Title"
                        />
                        <Input
                          value={row.album}
                          onChange={(e) => updateMetadataRow(row.videoId, "album", e.target.value)}
                          placeholder="Album"
                        />
                        <Input
                          type="number"
                          value={row.year}
                          onChange={(e) => updateMetadataRow(row.videoId, "year", e.target.value)}
                          placeholder="Release Year"
                        />
                        <Input
                          value={row.genre}
                          onChange={(e) => updateMetadataRow(row.videoId, "genre", e.target.value)}
                          placeholder="Genre"
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <Button
                  onClick={saveMetadataChanges}
                  disabled={metadataSaving}
                  className="w-full"
                >
                  {metadataSaving ? "Saving..." : "Save Metadata"}
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </PageTransition>
  );
}
