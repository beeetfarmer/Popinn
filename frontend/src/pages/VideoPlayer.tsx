import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, Link, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { MusicVideo } from "@/data/mockData";
import PageTransition from "@/components/PageTransition";
import { ArrowLeft, Calendar, Disc, Tag, User, Clock, AlertCircle, Loader2, ListOrdered, SkipBack, SkipForward, GripVertical } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useQueue } from "@/contexts/QueueContext";
import Hls from "hls.js";

interface SubtitleTrack {
  id: string;
  video_id: string;
  language: string;
  format: string;
  url: string;
}

interface VideoPlayRecord {
  id: string;
  watched_seconds: number;
  video_duration_seconds: number | null;
  counted_play: boolean;
  played_at: string;
}

interface VideoPlayStats {
  play_count: number;
  total_watched_seconds: number;
  history: VideoPlayRecord[];
}

interface VideoRecommendationItem {
  video: MusicVideo;
  lastfm_match: number | null;
}

interface VideoRecommendationsPage {
  items: VideoRecommendationItem[];
  offset: number;
  limit: number;
  has_more: boolean;
}

interface ViewThresholdSettings {
  view_threshold_percent: number;
}

type VideoRecommendationSource = "lastfm" | "genre";

const VIDEO_RECOMMENDATION_SOURCE_KEY = "videoRecommendationSource";

function getVideoRecommendationSource(): VideoRecommendationSource {
  if (typeof window === "undefined") return "lastfm";
  try {
    const value = window.localStorage.getItem(VIDEO_RECOMMENDATION_SOURCE_KEY);
    return value === "genre" ? "genre" : "lastfm";
  } catch {
    return "lastfm";
  }
}

function getResponsiveRecommendationLimit(): number {
  if (typeof window === "undefined") return 6;
  if (window.innerWidth < 640) return 2;
  if (window.innerWidth < 1024) return 4;
  return 6;
}

function formatSeconds(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatPlaybackTotal(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds < 60) {
    return `${seconds} sec`;
  }
  return `${Math.floor(seconds / 60)} min`;
}

export default function VideoPlayer() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  // Back used to be a hardcoded link to /videos, which threw away wherever the
  // user actually came from -- an artist page, a search, a watchlist. Going
  // back through history returns them there, and restores that page's URL
  // state (list pagination) with it. location.key is "default" only when this
  // is the first entry in the stack (opened directly, or a fresh tab), where
  // there is nothing to go back to.
  const handleBack = useCallback(() => {
    if (location.key !== "default") navigate(-1);
    else navigate("/videos");
  }, [location.key, navigate]);
  const {
    queue,
    currentIndex,
    hasPrevious,
    hasNext,
    startQueue,
    setCurrentByVideoId,
    playNext,
    playPrevious,
    playAtIndex,
    moveQueueItem,
  } = useQueue();
  const [videoError, setVideoError] = useState(false);
  const [videoLoading, setVideoLoading] = useState(true);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [dragFromIndex, setDragFromIndex] = useState<number | null>(null);
  const [recommendationPage, setRecommendationPage] = useState(1);
  const [recommendationBaseLimit, setRecommendationBaseLimit] = useState(
    getResponsiveRecommendationLimit
  );
  const [recommendationSource] = useState<VideoRecommendationSource>(
    getVideoRecommendationSource
  );
  const playClockStartedAtRef = useRef<number | null>(null);
  const watchedSecondsRef = useRef(0);
  const submittingPlayRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const { data: video } = useQuery<MusicVideo>({
    queryKey: ["video", id],
    queryFn: () => api.get(`/videos/${id}`),
    enabled: !!id,
  });

  const { data: subtitles = [] } = useQuery<SubtitleTrack[]>({
    queryKey: ["subtitles", id],
    queryFn: () => api.get(`/videos/${id}/subtitles`),
    enabled: !!id,
  });
  const videoElementKey = `${id || "video"}:${subtitles.map((s) => s.id).join(",")}`;
  const isHlsSource = /\.m3u8(\?|$)/i.test(sourceUrl || "");

  const { data: playStats, refetch: refetchPlayStats } = useQuery<VideoPlayStats>({
    queryKey: ["video-play-stats", id],
    queryFn: () => api.get(`/videos/${id}/plays`),
    enabled: !!id,
  });
  const { data: viewThreshold } = useQuery<ViewThresholdSettings>({
    queryKey: ["view-threshold"],
    queryFn: () => api.get("/settings/view-threshold"),
  });
  const viewThresholdPercent = viewThreshold?.view_threshold_percent ?? 20;
  const recommendationLimit = recommendationPage * recommendationBaseLimit;
  const { data: recommendations, isLoading: recommendationsLoading } =
    useQuery<VideoRecommendationsPage>({
      queryKey: ["video-recommendations", id, recommendationLimit, recommendationSource],
      queryFn: () =>
        api.get(
          `/videos/${id}/recommendations?offset=0&limit=${recommendationLimit}&source=${recommendationSource}`
        ),
      enabled: !!id,
      staleTime: 120_000,
    });
  const recommendationHeading =
    recommendationSource === "genre"
      ? "Recommended Music Videos (Genre)"
      : "Recommended Music Videos (Last.fm)";

  const pausePlayClock = useCallback(() => {
    if (playClockStartedAtRef.current === null) return;
    watchedSecondsRef.current += (performance.now() - playClockStartedAtRef.current) / 1000;
    playClockStartedAtRef.current = null;
  }, []);

  const startPlayClock = useCallback(() => {
    if (playClockStartedAtRef.current !== null) return;
    playClockStartedAtRef.current = performance.now();
  }, []);

  const submitPlaySession = useCallback(async () => {
    pausePlayClock();
    if (!id || submittingPlayRef.current) return;
    if (watchedSecondsRef.current < 1) return;

    submittingPlayRef.current = true;
    const watched = watchedSecondsRef.current;
    watchedSecondsRef.current = 0;

    try {
      await api.post(`/videos/${id}/plays`, {
        watched_seconds: watched,
        video_duration_seconds: video?.duration ?? null,
      });
      await refetchPlayStats();
    } catch {
      // Ignore analytics submission failures; playback should remain unaffected.
    } finally {
      submittingPlayRef.current = false;
    }
  }, [id, pausePlayClock, refetchPlayStats, video?.duration]);

  useEffect(() => {
    if (!video) return;
    setSourceUrl(video.playback_url || video.video_url);
    setVideoError(false);
    setVideoLoading(true);
  }, [video]);

  // When transcoding is enabled the backend serves an HLS playlist, which only
  // Safari can play from a plain src. Everywhere else hls.js has to drive the
  // element, so the src attribute is left off for HLS and set here instead.
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl || !sourceUrl || !isHlsSource) return;

    if (videoEl.canPlayType("application/vnd.apple.mpegurl")) {
      videoEl.src = sourceUrl;
      return;
    }

    if (!Hls.isSupported()) {
      setVideoError(true);
      setVideoLoading(false);
      return;
    }

    const hls = new Hls({ enableWorker: true });
    hls.loadSource(sourceUrl);
    hls.attachMedia(videoEl);
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) {
        setVideoError(true);
        setVideoLoading(false);
      }
    });

    return () => hls.destroy();
  }, [sourceUrl, isHlsSource, videoElementKey]);

  useEffect(() => {
    if (!video || !id) return;
    if (queue.length === 0) {
      startQueue([video], { startIndex: 0 });
      return;
    }
    const inQueue = queue.some((item) => item.id === id);
    if (inQueue) {
      setCurrentByVideoId(id);
    } else {
      startQueue([video], { startIndex: 0 });
    }
  }, [id, video, queue, startQueue, setCurrentByVideoId]);

  useEffect(() => {
    playClockStartedAtRef.current = null;
    watchedSecondsRef.current = 0;
    submittingPlayRef.current = false;
  }, [id]);

  useEffect(() => {
    return () => {
      void submitPlaySession();
    };
  }, [submitPlaySession]);

  useEffect(() => {
    function onResize() {
      setRecommendationBaseLimit(getResponsiveRecommendationLimit());
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    setRecommendationPage(1);
  }, [id, recommendationBaseLimit]);

  useEffect(() => {
    if (!subtitles.length) return;
    const videoEl = videoRef.current;
    if (!videoEl) return;

    const timer = window.setTimeout(() => {
      try {
        const textTracks = videoEl.textTracks;
        if (!textTracks || textTracks.length === 0) return;
        for (let i = 0; i < textTracks.length; i += 1) {
          textTracks[i].mode = i === 0 ? "showing" : "disabled";
        }
      } catch {
        // Ignore browser-specific text track errors.
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, [id, subtitles]);

  if (!video) {
    return <p className="text-muted-foreground">Loading...</p>;
  }

  function goPreviousInQueue() {
    const previous = playPrevious();
    if (previous) navigate(`/video/${previous.id}`);
  }

  function goNextInQueue() {
    const next = playNext();
    if (next) navigate(`/video/${next.id}`);
  }

  function playQueueIndex(index: number) {
    const selected = playAtIndex(index);
    if (selected) navigate(`/video/${selected.id}`);
  }

  function playRecommendedVideo(selected: MusicVideo) {
    const recommendedVideos = (recommendations?.items || []).map((item) => item.video);
    const queueVideos = [
      selected,
      ...recommendedVideos.filter((videoItem) => videoItem.id !== selected.id),
    ];
    startQueue(queueVideos, { startIndex: 0 });
    navigate(`/video/${selected.id}`);
  }

  return (
    <PageTransition>
      <div className="mx-auto max-w-6xl lg:flex lg:items-start lg:gap-6">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={handleBack}
            className="mb-4 inline-flex items-center gap-1 text-sm text-primary hover:text-primary/80"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>

          {/* Player */}
          <div className="relative aspect-video overflow-hidden rounded-xl border border-border bg-card">
            {sourceUrl ? (
              <>
                {videoLoading && !videoError && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/50">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                )}
                {videoError ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80">
                    <AlertCircle className="mb-2 h-10 w-10 text-destructive" />
                    <span className="text-sm font-medium text-destructive">Failed to load video</span>
                  </div>
                ) : null}
                <video
                  key={videoElementKey}
                  ref={videoRef}
                  // HLS sources are attached in the effect above (via hls.js or
                  // natively on Safari); setting src here would race with it.
                  src={isHlsSource ? undefined : sourceUrl}
                  poster={video.thumbnail_url || undefined}
                  controls
                  autoPlay
                  preload="metadata"
                  className="h-full w-full"
                  onPlay={startPlayClock}
                  onPause={pausePlayClock}
                  onEnded={async () => {
                    await submitPlaySession();
                    const next = playNext();
                    if (next) navigate(`/video/${next.id}`);
                  }}
                  onLoadedData={() => setVideoLoading(false)}
                  onError={() => {
                    pausePlayClock();
                    if (sourceUrl !== video.video_url && video.video_url) {
                      setSourceUrl(video.video_url);
                      setVideoError(false);
                      setVideoLoading(true);
                      return;
                    }
                    setVideoError(true);
                    setVideoLoading(false);
                  }}
                  crossOrigin="use-credentials"
                >
                  {subtitles.map((sub, i) => (
                    <track
                      key={sub.id}
                      kind="subtitles"
                      src={sub.url}
                      srcLang={sub.language}
                      label={sub.language === "und" ? `Subtitle ${i + 1}` : sub.language}
                      default={i === 0}
                    />
                  ))}
                </video>
              </>
            ) : (
              <>
                <img
                  src={video.thumbnail_url || "/placeholder.svg"}
                  alt={video.title}
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 flex items-center justify-center bg-background/50">
                  <span className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
                    No video file
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Info */}
          <div className="mt-6 space-y-4">
            <h1 className="text-2xl font-bold text-foreground">{video.title}</h1>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <InfoItem icon={User} label="Artist">
                <Link to={`/artist/${video.artist_id}`} className="text-primary hover:underline">
                  {video.artist_name}
                </Link>
              </InfoItem>
              {video.album && <InfoItem icon={Disc} label="Album">{video.album}</InfoItem>}
              {video.genre && <InfoItem icon={Tag} label="Genre">{video.genre}</InfoItem>}
              {video.year && <InfoItem icon={Calendar} label="Year">{video.year}</InfoItem>}
              <InfoItem icon={Clock} label="Duration">{video.duration_display}</InfoItem>
              <InfoItem icon={User} label="Number of Views">
                {(playStats?.play_count || 0).toString()}
              </InfoItem>
              <InfoItem icon={Clock} label="Playback Time">
                {formatPlaybackTotal(playStats?.total_watched_seconds || 0)}
              </InfoItem>
            </div>

            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setHistoryOpen(true)}
              >
                View Playback History
              </Button>
            </div>

            <section className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-foreground">
                  {recommendationHeading}
                </h2>
                {recommendations?.has_more && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setRecommendationPage((prev) => prev + 1)}
                  >
                    See more
                  </Button>
                )}
              </div>
              {recommendationsLoading ? (
                <p className="text-sm text-muted-foreground">Loading recommendations...</p>
              ) : recommendations && recommendations.items.length > 0 ? (
                <div className="flex gap-3 overflow-x-auto pb-2">
                  {recommendations.items.map((item) => (
                    <button
                      key={item.video.id}
                      type="button"
                      onClick={() => playRecommendedVideo(item.video)}
                      className="w-52 shrink-0 overflow-hidden rounded-lg border border-border bg-card text-left transition-colors hover:border-primary/40"
                    >
                      <div className="relative aspect-video bg-secondary">
                        <img
                          src={item.video.thumbnail_url || "/placeholder.svg"}
                          alt={item.video.title}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      </div>
                      <div className="space-y-0.5 p-3">
                        <p className="line-clamp-2 text-sm font-semibold text-foreground">
                          {item.video.title}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {item.video.artist_name}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No recommendations available yet.
                </p>
              )}
            </section>
          </div>
        </div>

        {queue.length > 1 && (
          <aside className="mt-5 rounded-xl border border-border bg-card p-4 lg:sticky lg:top-4 lg:mt-0 lg:w-96">
            <div className="mb-3 flex items-center gap-2">
              <ListOrdered className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">Queue</h2>
              <span className="text-xs text-muted-foreground">({queue.length})</span>
            </div>
            <div className="mb-3 flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!hasPrevious}
                onClick={goPreviousInQueue}
              >
                <SkipBack className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!hasNext}
                onClick={goNextInQueue}
              >
                <SkipForward className="h-4 w-4" />
              </Button>
            </div>
            <div className="max-h-[64vh] space-y-2 overflow-y-auto pr-1">
              {queue.map((item, index) => (
                <div
                  key={item.id}
                  draggable
                  onDragStart={() => setDragFromIndex(index)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragFromIndex !== null) {
                      moveQueueItem(dragFromIndex, index);
                      setDragFromIndex(null);
                    }
                  }}
                  onDragEnd={() => setDragFromIndex(null)}
                  onClick={() => playQueueIndex(index)}
                  className={`flex cursor-pointer items-center gap-2 rounded-md p-1 transition-colors ${
                    index === currentIndex ? "bg-secondary/80" : "hover:bg-secondary/60"
                  }`}
                >
                  <div className="relative h-16 w-28 shrink-0 overflow-hidden rounded-md bg-secondary">
                    <img
                      src={item.thumbnail_url || "/placeholder.svg"}
                      alt={item.title}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                    <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1 py-0.5 text-[10px] font-medium text-white">
                      {item.duration_display}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-xs font-semibold text-foreground">
                      {item.title}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {item.artist_name}
                    </p>
                    {index === currentIndex && (
                      <p className="mt-0.5 text-[10px] font-semibold text-primary">Now playing</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 pr-1 text-muted-foreground">
                    <span className="w-4 text-[10px]">{index + 1}</span>
                    <GripVertical className="h-3.5 w-3.5" />
                  </div>
                </div>
              ))}
            </div>
          </aside>
        )}
      </div>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Playback History</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Includes every playback session. Views require at least {viewThresholdPercent}% watched.
          </p>
          {!playStats || playStats.history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No playback history yet.</p>
          ) : (
            <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
              {playStats.history.map((play) => (
                <div
                  key={play.id}
                  className="rounded-md border border-border px-3 py-2"
                >
                  <p className="text-sm font-medium text-foreground">
                    {formatSeconds(play.watched_seconds)} watched
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {play.counted_play ? "Counts as a view" : "History only"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(play.played_at).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </PageTransition>
  );
}

function InfoItem({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className="text-sm font-medium text-foreground">{children}</div>
    </div>
  );
}
