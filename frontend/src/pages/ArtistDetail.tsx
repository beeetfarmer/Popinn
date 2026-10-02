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
import Reveal from "@/components/Reveal";
import SectionHeader from "@/components/SectionHeader";
import { ArtistGridSkeleton } from "@/components/Skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";
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

  // MusicBrainz asks for ~1 request/second, so "Search All" must pace itself
  // when it's the active provider; Spotify tolerates the concurrent burst.
  const { data: metadataRuntime } = useQuery<{ metadata_provider: "spotify" | "musicbrainz" }>({
    queryKey: ["runtime-metadata-provider"],
    queryFn: () => api.get("/settings/runtime"),
    enabled: isAdmin,
  });

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
      toast.error("Enter a track name to search");
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
        toast.info(`No matches for "${query}"`);
      }
    } catch (error: unknown) {
      setMetadataRows((prev) =>
        prev.map((item) =>
          item.videoId === videoId
            ? { ...item, spotifySearching: false, showMatchOptions: false }
            : item
        )
      );
      toast.error(getErrorMessage(error, "Failed to search for metadata"));
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
    toast.success("Metadata fetched");
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
      // MusicBrainz is rate-limited, so run its searches one at a time with a
      // pause between them; Spotify keeps the faster concurrent fan-out.
      const paced = metadataRuntime?.metadata_provider === "musicbrainz";
      const searchRow = async (row: MetadataRow) => {
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
      };

      let resultsByVideoId: { videoId: string; results: SpotifyTrackMatch[] }[];
      if (paced) {
        resultsByVideoId = [];
        for (let i = 0; i < metadataRows.length; i += 1) {
          if (i > 0) await new Promise((resolve) => setTimeout(resolve, 1100));
          resultsByVideoId.push(await searchRow(metadataRows[i]));
        }
      } else {
        resultsByVideoId = await Promise.all(metadataRows.map(searchRow));
      }

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
        toast.info(`No match for ${noMatchCount} video${noMatchCount !== 1 ? "s" : ""}.`);
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
    if (isLoading)
      return (
        <div className="flex flex-col items-center gap-6 pt-16 sm:flex-row sm:items-end">
          <Skeleton className="h-48 w-48 rounded-full" />
          <div className="space-y-3">
            <Skeleton className="h-14 w-72 rounded-xl" />
            <Skeleton className="h-4 w-96 max-w-full" />
          </div>
        </div>
      );
    if (isError) return <p className="py-24 text-center text-destructive">Failed to load artist</p>;
    return <p className="py-24 text-center text-muted-foreground">Artist not found</p>;
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
        {/* Banner: the artist photo, blurred wide, as stage lighting. */}
        <section className="relative -mt-4 ml-[calc(50%-50vw)] mr-[calc(50%-50vw)] overflow-hidden sm:-mt-6">
          {artist.image_url && (
            <img
              src={artist.image_url}
              alt=""
              aria-hidden
              className="absolute inset-0 h-full w-full scale-125 object-cover opacity-50 blur-3xl saturate-150"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-background/30 via-background/60 to-background" />
          <div className="relative mx-auto max-w-[1800px] px-4 pb-12 pt-6 sm:px-8 sm:pt-8">
            <Link
              to="/artists"
              className="glass mb-10 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" /> Artists
            </Link>

            <div className="flex flex-col items-center gap-8 text-center sm:flex-row sm:items-end sm:text-left">
              {/* Drag & drop image area */}
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                className={`group relative h-44 w-44 shrink-0 overflow-hidden rounded-full shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)] ring-4 transition-all sm:h-56 sm:w-56 ${
                  isAdmin ? "cursor-pointer" : ""
                } ${dragOver ? "ring-primary" : "ring-white/10 hover:ring-white/20"}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (isAdmin) setDragOver(true);
                }}
                onDragLeave={() => isAdmin && setDragOver(false)}
                onDrop={isAdmin ? handleDrop : undefined}
                onClick={isAdmin ? () => document.getElementById("artist-image-input")?.click() : undefined}
                title={isAdmin ? "Drag & drop or click to change artist image" : "Artist image"}
              >
                {artist.image_url ? (
                  <img
                    src={artist.image_url}
                    alt={artist.name}
                    className={`h-full w-full object-cover transition-opacity ${
                      dragOver || uploadImage.isPending ? "opacity-40" : ""
                    }`}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-secondary to-muted">
                    <span className="display text-7xl text-muted-foreground">
                      {artist.name.trim().charAt(0).toUpperCase()}
                    </span>
                  </div>
                )}
                {isAdmin && (
                  <>
                    <div
                      className={`absolute inset-0 flex flex-col items-center justify-center bg-black/50 backdrop-blur-sm transition-opacity ${
                        dragOver || uploadImage.isPending ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                      }`}
                    >
                      <Upload className="h-6 w-6 text-primary" />
                      <span className="mt-2 text-xs font-medium text-foreground">
                        {uploadImage.isPending ? "Uploading..." : "Change image"}
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
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
                className="min-w-0"
              >
                <p className="eyebrow mb-2">Artist</p>
                <div className="flex items-center justify-center gap-2 sm:justify-start">
                  <h1 className="display text-5xl leading-none text-foreground sm:text-7xl lg:text-8xl">{artist.name}</h1>
                  {isAdmin && (
                    <button
                      onClick={openEdit}
                      className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
                      title="Edit artist"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <p className="mt-4 text-sm text-muted-foreground">
                  <span className="text-foreground">{artist.videos.length}</span> music video{artist.videos.length !== 1 && "s"}
                  <span className="mx-2 opacity-40">·</span>
                  <span className="text-foreground">{artist.play_count || 0}</span> view{(artist.play_count || 0) !== 1 && "s"}
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-2 sm:justify-start">
                  <Button size="lg" onClick={() => startArtistQueue(false)}>
                    <Play className="h-4 w-4 fill-current" /> Play all
                  </Button>
                  <Button size="lg" variant="outline" onClick={() => startArtistQueue(true)}>
                    <Shuffle className="h-4 w-4" /> Shuffle
                  </Button>
                  {isAdmin && (
                    <Button size="lg" variant="ghost" onClick={openMetadataEditor}>
                      Edit MV metadata
                    </Button>
                  )}
                  {isAdmin && (
                    <Button
                      size="lg"
                      variant="ghost"
                      onClick={() => refreshMetadataMutation.mutate()}
                      disabled={refreshMetadataMutation.isPending}
                    >
                      {refreshMetadataMutation.isPending ? "Refreshing..." : "Refresh info"}
                    </Button>
                  )}
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* Bio */}
        {(parsedBio.body || parsedBio.lastfmUrl) && (
          <Reveal className="mb-14 max-w-3xl">
            <p className="eyebrow mb-3">About</p>
            <p className="whitespace-pre-line text-[15px] leading-relaxed text-foreground/80">
              {parsedBio.body || "No artist bio available."}
            </p>
            {parsedBio.lastfmUrl && (
              <p className="mt-3 text-xs text-muted-foreground">
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
          </Reveal>
        )}

        <SectionHeader eyebrow="Discography" title="Music videos" />
        <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {shownVideos.map((v) => (
            <VideoCard key={v.id} video={v} />
          ))}
        </div>
        {infiniteScroll && artist.videos.length > 0 && (
          <>
            <div ref={sentinelRef} aria-hidden className="h-px" />
            <div className="mt-10 text-center text-sm text-muted-foreground">
              {canShowMore
                ? `Showing ${shownVideos.length} of ${artist.videos.length}`
                : `All ${artist.videos.length} videos loaded`}
            </div>
          </>
        )}
        {!infiniteScroll && artist.videos.length > PER_PAGE && (
          <div className="glass mx-auto mt-10 flex w-fit items-center gap-2 rounded-full p-1.5">
            <Button
              variant="ghost"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <span className="px-3 text-sm tabular-nums text-muted-foreground">
              Page <span className="text-foreground">{page}</span> of {totalPages}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </Button>
          </div>
        )}
        <section className="mt-20 space-y-3">
          <div className="flex items-end justify-between">
            <div>
              <p className="eyebrow mb-1.5">Similar on Last.fm</p>
              <h2 className="display text-3xl text-foreground sm:text-4xl">Fans also like</h2>
            </div>
            {artistRecommendations?.has_more && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setArtistRecPage((prev) => prev + 1)}
              >
                See more
              </Button>
            )}
          </div>
          {artistRecommendationsLoading ? (
            <ArtistGridSkeleton count={6} />
          ) : artistRecommendations && artistRecommendations.items.length > 0 ? (
            <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-4 pt-2 scrollbar-none">
              {artistRecommendations.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigate(`/artist/${item.id}`)}
                  className="group w-44 shrink-0 snap-start rounded-2xl p-3 text-center outline-none"
                >
                  <div className="mx-auto mb-3 h-36 w-36 overflow-hidden rounded-full bg-secondary ring-1 ring-white/10 transition-all duration-500 group-hover:ring-2 group-hover:ring-primary/70">
                    {item.image_url ? (
                      <img
                        src={item.image_url}
                        alt={item.name}
                        className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
                        loading="lazy"
                      />
                    ) : (
                      <div className="display flex h-full w-full items-center justify-center text-5xl text-muted-foreground">
                        {item.name.slice(0, 1).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <p className="truncate text-sm font-medium text-foreground transition-colors group-hover:text-primary">{item.name}</p>
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
              <div className="rounded-xl border border-white/10 p-3">
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
                        className="w-full rounded-xl border border-white/10 px-2 py-1.5 text-left transition-colors hover:bg-white/[0.06]"
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
                  Match each music video with a track to autofill title, album, release year, and genre.
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
                    <div key={row.videoId} className="rounded-2xl border border-white/10 p-3">
                      <p className="text-xs text-muted-foreground">
                        Original MV Name: <span className="font-medium text-foreground">{row.originalTitle}</span>
                      </p>
                      <div className="mt-2 flex gap-2">
                        <Input
                          value={row.spotifyQuery}
                          onChange={(e) => updateMetadataRow(row.videoId, "spotifyQuery", e.target.value)}
                          placeholder="Search for a track..."
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
                              className="w-full rounded-xl border border-white/10 px-2 py-1.5 text-left transition-colors hover:bg-white/[0.06]"
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
