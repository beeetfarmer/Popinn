import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, Link, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { MusicVideo } from "@/data/mockData";
import PageTransition from "@/components/PageTransition";
import { ArrowLeft, Calendar, Disc, Tag, User, Clock, AlertCircle, Loader2, ListOrdered, SkipBack, SkipForward, GripVertical, Eye, Timer, History, Play } from "lucide-react";
import { motion } from "framer-motion";
import { Skeleton } from "@/components/ui/skeleton";
import { VideoCardSkeleton } from "@/components/Skeletons";
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
    return (
      <div className="mx-auto max-w-[1600px] pt-14">
        <Skeleton className="aspect-video w-full rounded-2xl" />
        <Skeleton className="mt-8 h-12 w-2/3 rounded-xl" />
        <Skeleton className="mt-3 h-4 w-1/3" />
      </div>
    );
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
      {/* Ambient light: the artwork, blurred huge, glowing behind the player.
          Absolute and full-bleed rather than fixed: a fixed layer inside the
          animated page wrapper is clipped to that wrapper mid-transition. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 -z-10 h-[110vh] w-screen -translate-x-1/2 overflow-hidden [mask-image:linear-gradient(to_bottom,black_30%,transparent)]"
      >
        <img
          key={video.id}
          src={video.thumbnail_url || undefined}
          alt=""
          className="h-full w-full scale-125 animate-fade-up object-cover opacity-25 blur-[100px] brightness-75 saturate-150"
        />
      </div>

      <div className="relative mx-auto max-w-[1600px] lg:flex lg:items-start lg:justify-center lg:gap-8">
        {/* Column width is capped so the player's height always clears the
            floating dock -- otherwise the dock sits on top of the seek bar. */}
        <div className="mx-auto min-w-0 max-w-[calc((100vh-12rem)*16/9)] flex-1 lg:mx-0">
          <button
            type="button"
            onClick={handleBack}
            className="glass mb-5 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>

          {/* Player */}
          <div className="relative aspect-video overflow-hidden rounded-2xl bg-black shadow-[0_40px_120px_-30px_rgba(0,0,0,0.95)] ring-1 ring-white/10">
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
                <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-sm">
                  <span className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground">
                    No video file
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Info */}
          <motion.div
            key={video.id}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="mt-8 space-y-6"
          >
            <div>
              <Link
                to={`/artist/${video.artist_id}`}
                className="eyebrow inline-flex items-center gap-2 text-primary transition-colors hover:text-primary/80"
              >
                <User className="h-3.5 w-3.5" />
                {video.artist_name}
              </Link>
              <h1 className="display mt-2 text-4xl leading-[1.05] text-foreground sm:text-5xl lg:text-6xl">
                {video.title}
              </h1>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {video.album && <InfoItem icon={Disc} label="Album">{video.album}</InfoItem>}
              {video.genre && <InfoItem icon={Tag} label="Genre">{video.genre}</InfoItem>}
              {video.year && <InfoItem icon={Calendar} label="Year">{video.year}</InfoItem>}
              <InfoItem icon={Clock} label="Duration">{video.duration_display}</InfoItem>
              <InfoItem icon={Eye} label="Views">
                {(playStats?.play_count || 0).toString()}
              </InfoItem>
              <InfoItem icon={Timer} label="Watched">
                {formatPlaybackTotal(playStats?.total_watched_seconds || 0)}
              </InfoItem>
              <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>
                <History className="h-4 w-4" /> Playback history
              </Button>
            </div>
          </motion.div>

          <div className="mt-12 space-y-4">
            <section className="space-y-4">
              <div className="flex items-end justify-between">
                <div>
                  <p className="eyebrow mb-1.5">Up next</p>
                  <h2 className="display text-3xl text-foreground">
                    {recommendationHeading}
                  </h2>
                </div>
                {recommendations?.has_more && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setRecommendationPage((prev) => prev + 1)}
                  >
                    See more
                  </Button>
                )}
              </div>
              {recommendationsLoading ? (
                <div className="flex gap-4 overflow-hidden">
                  {Array.from({ length: 4 }, (_, i) => (
                    <div key={i} className="w-60 shrink-0">
                      <VideoCardSkeleton />
                    </div>
                  ))}
                </div>
              ) : recommendations && recommendations.items.length > 0 ? (
                <div className="-mx-1 flex snap-x gap-4 overflow-x-auto px-1 pb-4 pt-2 scrollbar-none">
                  {recommendations.items.map((item) => (
                    <button
                      key={item.video.id}
                      type="button"
                      onClick={() => playRecommendedVideo(item.video)}
                      className="group w-60 shrink-0 snap-start text-left outline-none"
                    >
                      <div className="relative aspect-video overflow-hidden rounded-xl bg-secondary ring-1 ring-white/[0.06] transition-all duration-500 group-hover:-translate-y-1 group-hover:ring-white/20 group-hover:shadow-[0_20px_40px_-15px_rgba(0,0,0,0.9)]">
                        <img
                          src={item.video.thumbnail_url || "/placeholder.svg"}
                          alt={item.video.title}
                          className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                          loading="lazy"
                        />
                        <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
                            <Play className="ml-0.5 h-4 w-4 fill-current" />
                          </span>
                        </div>
                      </div>
                      <div className="mt-3 space-y-0.5 px-0.5">
                        <p className="line-clamp-2 text-sm font-medium text-foreground transition-colors group-hover:text-primary">
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
          <aside className="glass mt-8 rounded-3xl p-4 lg:sticky lg:top-6 lg:mt-14 lg:w-[400px]">
            <div className="mb-4 flex items-center gap-2 px-1">
              <ListOrdered className="h-4 w-4 text-primary" />
              <h2 className="display text-2xl text-foreground">Queue</h2>
              <span className="text-xs tabular-nums text-muted-foreground">{queue.length}</span>
              <div className="ml-auto flex gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9"
                  aria-label="Previous in queue"
                  disabled={!hasPrevious}
                  onClick={goPreviousInQueue}
                >
                  <SkipBack className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9"
                  aria-label="Next in queue"
                  disabled={!hasNext}
                  onClick={goNextInQueue}
                >
                  <SkipForward className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="max-h-[64vh] space-y-1 overflow-y-auto pr-1">
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
                  className={`group flex cursor-pointer items-center gap-3 rounded-2xl p-1.5 transition-colors ${
                    index === currentIndex ? "bg-white/[0.08] ring-1 ring-primary/40" : "hover:bg-white/[0.05]"
                  }`}
                >
                  <div className="relative h-16 w-28 shrink-0 overflow-hidden rounded-xl bg-secondary">
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
                      <p className="mt-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-primary">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                        Now playing
                      </p>
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
                  className="surface px-4 py-3"
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
    <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] py-1.5 pl-3 pr-4 text-sm" title={label}>
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="sr-only">{label}:</span>
      <span className="font-medium text-foreground">{children}</span>
    </div>
  );
}
