import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { api } from "@/lib/api";
import { fetchAllVideos } from "@/lib/videos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import PageTransition from "@/components/PageTransition";
import type { Artist, MusicVideo } from "@/data/mockData";

interface PlaybackHistoryItem {
  id: string;
  video_id: string;
  video_title: string;
  artist_id: string;
  artist_name: string;
  watched_seconds: number;
  counted_play: boolean;
  played_at: string;
}

type TopArtistMetric = "views" | "minutes";
type TopVideoMetric = "views" | "minutes";

function formatWatchTime(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`;
}

function formatViewCount(count: number): string {
  return `${count} view${count === 1 ? "" : "s"}`;
}

function parseDateInput(value: string): Date | null {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

export default function ProfileStatsRankingsPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [startDate, setStartDate] = useState(params.get("start") || "");
  const [endDate, setEndDate] = useState(params.get("end") || "");
  const [topArtistMetric, setTopArtistMetric] = useState<TopArtistMetric>(
    params.get("artist_metric") === "minutes" ? "minutes" : "views"
  );
  const [topVideoMetric, setTopVideoMetric] = useState<TopVideoMetric>(
    params.get("video_metric") === "minutes" ? "minutes" : "views"
  );

  const { data: playbackHistory = [], isLoading: playbackLoading } =
    useQuery<PlaybackHistoryItem[]>({
      queryKey: ["my-playback-history"],
      queryFn: () => api.get("/auth/me/plays?limit=2000"),
    });

  const { data: artists = [] } = useQuery<Artist[]>({
    queryKey: ["artists"],
    queryFn: () => api.get("/artists/?limit=2000"),
  });

  const { data: videos = [] } = useQuery<MusicVideo[]>({
    // Rankings are computed over the whole library, so this cannot be a single
    // capped page -- a cap here silently ranks only part of the collection.
    queryKey: ["videos", "all"],
    queryFn: () => fetchAllVideos(),
  });

  const filteredHistory = useMemo(() => {
    const start = parseDateInput(startDate);
    const end = parseDateInput(endDate);
    const startTs = start ? startOfDay(start).getTime() : null;
    const endTs = end ? endOfDay(end).getTime() : null;

    return playbackHistory.filter((entry) => {
      const playedAt = new Date(entry.played_at).getTime();
      if (Number.isNaN(playedAt)) return false;
      const startOk = startTs === null ? true : playedAt >= startTs;
      const endOk = endTs === null ? true : playedAt <= endTs;
      return startOk && endOk;
    });
  }, [playbackHistory, startDate, endDate]);

  const topArtists = useMemo(() => {
    const map = new Map<string, { id: string; name: string; views: number; watch_seconds: number }>();
    filteredHistory.forEach((entry) => {
      const existing = map.get(entry.artist_id);
      if (existing) {
        existing.views += entry.counted_play ? 1 : 0;
        existing.watch_seconds += entry.watched_seconds;
      } else {
        map.set(entry.artist_id, {
          id: entry.artist_id,
          name: entry.artist_name,
          views: entry.counted_play ? 1 : 0,
          watch_seconds: entry.watched_seconds,
        });
      }
    });
    return Array.from(map.values())
      .filter((artist) =>
        topArtistMetric === "views" ? artist.views > 0 : artist.watch_seconds > 0
      )
      .sort((a, b) =>
        topArtistMetric === "views"
          ? b.views - a.views || b.watch_seconds - a.watch_seconds
          : b.watch_seconds - a.watch_seconds || b.views - a.views
      );
  }, [filteredHistory, topArtistMetric]);

  const topVideos = useMemo(() => {
    const map = new Map<
      string,
      { id: string; title: string; artist_name: string; views: number; watch_seconds: number }
    >();
    filteredHistory.forEach((entry) => {
      const existing = map.get(entry.video_id);
      if (existing) {
        existing.views += entry.counted_play ? 1 : 0;
        existing.watch_seconds += entry.watched_seconds;
      } else {
        map.set(entry.video_id, {
          id: entry.video_id,
          title: entry.video_title,
          artist_name: entry.artist_name,
          views: entry.counted_play ? 1 : 0,
          watch_seconds: entry.watched_seconds,
        });
      }
    });
    return Array.from(map.values())
      .filter((video) =>
        topVideoMetric === "views" ? video.views > 0 : video.watch_seconds > 0
      )
      .sort((a, b) =>
        topVideoMetric === "views"
          ? b.views - a.views || b.watch_seconds - a.watch_seconds
          : b.watch_seconds - a.watch_seconds || b.views - a.views
      );
  }, [filteredHistory, topVideoMetric]);

  const artistImageMap = useMemo(
    () => new Map(artists.map((artist) => [artist.id, artist.image_url || null])),
    [artists]
  );

  const videoMap = useMemo(() => new Map(videos.map((video) => [video.id, video])), [videos]);

  return (
    <PageTransition>
      <div className="mx-auto max-w-6xl space-y-8 pt-4">
        <Link
          to="/profile"
          className="glass inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Profile
        </Link>

        <div className="flex items-center justify-between">
          <div>
            <p className="eyebrow mb-2">Your listening</p>
            <h1 className="display text-5xl text-foreground sm:text-6xl">Top rankings</h1>
          </div>
        </div>

        <section className="surface p-5 sm:p-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label>Start Date</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>End Date</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button
                variant="outline"
                onClick={() => {
                  setStartDate("");
                  setEndDate("");
                }}
              >
                Clear Date Filter
              </Button>
            </div>
          </div>
        </section>

        <section className="grid gap-3 lg:grid-cols-2">
          <div className="surface p-5 sm:p-6">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className="display text-2xl text-foreground">
                Top Artists ({topArtists.length})
              </h2>
              <Select
                value={topArtistMetric}
                onValueChange={(value) => setTopArtistMetric(value as TopArtistMetric)}
              >
                <SelectTrigger className="h-8 w-[150px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="views">Views</SelectItem>
                  <SelectItem value="minutes">Watch Minutes</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {playbackLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : topArtists.length === 0 ? (
              <p className="text-sm text-muted-foreground">No playback data for this range.</p>
            ) : (
              <div className="space-y-2">
                {topArtists.map((artist, index) => (
                  <div
                    key={artist.id}
                    className="group flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/[0.05]"
                    onClick={() => navigate(`/artist/${artist.id}`)}
                  >
                    <div className="h-11 w-11 shrink-0 overflow-hidden rounded-full bg-secondary ring-1 ring-white/10">
                      {artistImageMap.get(artist.id) ? (
                        <img
                          src={artistImageMap.get(artist.id) || ""}
                          alt={artist.name}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-muted-foreground">
                          {artist.name.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">{artist.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {topArtistMetric === "views"
                          ? formatViewCount(artist.views)
                          : formatWatchTime(artist.watch_seconds)}
                      </p>
                    </div>
                    <p className="display w-8 text-right text-2xl text-muted-foreground/60 transition-colors group-hover:text-primary">{index + 1}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="surface p-5 sm:p-6">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className="display text-2xl text-foreground">
                Top Music Videos ({topVideos.length})
              </h2>
              <Select
                value={topVideoMetric}
                onValueChange={(value) => setTopVideoMetric(value as TopVideoMetric)}
              >
                <SelectTrigger className="h-8 w-[150px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="views">Views</SelectItem>
                  <SelectItem value="minutes">Watch Minutes</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {playbackLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : topVideos.length === 0 ? (
              <p className="text-sm text-muted-foreground">No playback data for this range.</p>
            ) : (
              <div className="space-y-2">
                {topVideos.map((video, index) => {
                  const fullVideo = videoMap.get(video.id);
                  return (
                    <div
                      key={video.id}
                      className="group flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/[0.05]"
                      onClick={() => navigate(`/video/${video.id}`)}
                    >
                      <div className="h-12 w-20 shrink-0 overflow-hidden rounded-lg bg-secondary">
                        {fullVideo?.thumbnail_url ? (
                          <img
                            src={fullVideo.thumbnail_url}
                            alt={video.title}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[10px] font-semibold text-muted-foreground">
                            No image
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-foreground">{video.title}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {fullVideo?.artist_name || video.artist_name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {topVideoMetric === "views"
                            ? formatViewCount(video.views)
                            : formatWatchTime(video.watch_seconds)}
                        </p>
                      </div>
                      <p className="display w-8 text-right text-2xl text-muted-foreground/60 transition-colors group-hover:text-primary">{index + 1}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>
    </PageTransition>
  );
}
