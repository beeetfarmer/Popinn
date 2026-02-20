import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { MusicVideo } from "@/data/mockData";
import PageTransition from "@/components/PageTransition";
import { ArrowLeft, Calendar, Disc, Tag, User, Clock, AlertCircle, Loader2 } from "lucide-react";

interface SubtitleTrack {
  id: string;
  video_id: string;
  language: string;
  format: string;
  url: string;
}

export default function VideoPlayer() {
  const { id } = useParams<{ id: string }>();
  const [videoError, setVideoError] = useState(false);
  const [videoLoading, setVideoLoading] = useState(true);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);

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

  useEffect(() => {
    if (!video) return;
    setSourceUrl(video.playback_url || video.video_url);
    setVideoError(false);
    setVideoLoading(true);
  }, [video]);

  if (!video) {
    return <p className="text-muted-foreground">Loading...</p>;
  }

  return (
    <PageTransition>
      <div className="mx-auto max-w-4xl">
        <Link to="/videos" className="mb-4 inline-flex items-center gap-1 text-sm text-primary hover:text-primary/80">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>

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
                src={sourceUrl}
                poster={video.thumbnail_url || undefined}
                controls
                autoPlay
                preload="metadata"
                className="h-full w-full"
                onLoadedData={() => setVideoLoading(false)}
                onError={() => {
                  if (sourceUrl !== video.video_url && video.video_url) {
                    setSourceUrl(video.video_url);
                    setVideoError(false);
                    setVideoLoading(true);
                    return;
                  }
                  setVideoError(true);
                  setVideoLoading(false);
                }}
                crossOrigin="anonymous"
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
          </div>
        </div>
      </div>
    </PageTransition>
  );
}

function InfoItem({ icon: Icon, label, children }: { icon: any; label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className="text-sm font-medium text-foreground">{children}</div>
    </div>
  );
}
