import { useState, useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
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
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useQueue } from "@/contexts/QueueContext";

const PER_PAGE = 10;
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
  const [metadataOpen, setMetadataOpen] = useState(false);
  const [metadataRows, setMetadataRows] = useState<MetadataRow[]>([]);
  const [metadataSaving, setMetadataSaving] = useState(false);
  const [searchAllRunning, setSearchAllRunning] = useState(false);
  const [page, setPage] = useState(1);

  const { data: artist, isLoading, isError } = useQuery<ArtistDetailType>({
    queryKey: ["artist", id],
    queryFn: () => api.get(`/artists/${id}`),
    enabled: !!id,
  });

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
    onError: (err: any) => toast.error(err.message || "Failed to upload image"),
  });

  const editMutation = useMutation({
    mutationFn: () => {
      if (!isAdmin) throw new Error("Admin access required");
      const body: Record<string, unknown> = {};
      if (editName.trim() && editName.trim() !== artist?.name) body.name = editName.trim();
      if (editBio.trim() !== (artist?.bio || "")) body.bio = editBio.trim() || null;
      return api.patch(`/artists/${id}`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["artist", id] });
      queryClient.invalidateQueries({ queryKey: ["artists"] });
      setEditOpen(false);
      toast.success("Artist updated");
    },
    onError: (err: any) => toast.error(err.message || "Failed to update"),
  });

  function openEdit() {
    if (artist) {
      setEditName(artist.name);
      setEditBio(parseArtistBio(artist.bio).body);
      setEditOpen(true);
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
    } catch (err: any) {
      setMetadataRows((prev) =>
        prev.map((item) =>
          item.videoId === videoId
            ? { ...item, spotifySearching: false, showMatchOptions: false }
            : item
        )
      );
      toast.error(err.message || "Failed to search Spotify");
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
    } catch (err: any) {
      toast.error(err.message || "Failed to save music video metadata");
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
  const paginatedVideos = artist.videos.slice(start, start + PER_PAGE);
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
                <Button size="sm" variant="secondary" onClick={openMetadataEditor}>
                  Edit MV Metadata
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Videos */}
        <h2 className="mb-4 mt-10 text-xl font-bold text-foreground">Music Videos</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {paginatedVideos.map((v) => (
            <VideoCard key={v.id} video={v} />
          ))}
        </div>
        {artist.videos.length > PER_PAGE && (
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
              <Button
                onClick={() => editMutation.mutate()}
                className="w-full"
                disabled={editMutation.isPending || !editName.trim()}
              >
                {editMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

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
