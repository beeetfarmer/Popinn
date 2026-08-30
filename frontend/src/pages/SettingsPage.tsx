import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
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
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { transcodeProgressPercent } from "@/lib/transcode";
import PageTransition from "@/components/PageTransition";
import { toast } from "sonner";
import { Trash2, Shield, Calendar, Loader2, CheckCircle2, XCircle, FolderSearch } from "lucide-react";

interface UserItem {
  id: string;
  username: string;
  email: string;
  role: string;
  is_active: boolean;
  created_at: string;
}

interface ScanJob {
  job_id?: string;
  id?: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  files_found: number | null;
  files_added: number | null;
  folders_total?: number | null;
  folders_processed?: number | null;
  current_folder?: string | null;
  errors: string | null;
  message?: string;
}

interface RuntimeSettings {
  media_path: string;
  app_data_path: string;
  transcoding_enabled: boolean;
  view_threshold_percent: number;
  library_scan_interval_minutes: number;
  lastfm_override_local_artist_images: boolean;
  video_infinite_scroll: boolean;
  metadata_provider: "spotify" | "musicbrainz";
  spotify_configured: boolean;
}

interface TranscodeRunStatus {
  active: boolean;
  cancelling: boolean;
  total: number;
  completed: number;
  failed: number;
  cancelled: number;
  processed: number;
  current: string | null;
  started_at: string | null;
  finished_at: string | null;
}

interface TranscodeStatus {
  transcoding_enabled: boolean;
  total_videos: number;
  needs_transcode: number;
  transcoded: number;
  pending: number;
  run: TranscodeRunStatus;
}

interface ExportSettingItem {
  key: string;
  value: string | null;
}

interface ExportPlaybackItem {
  user_email: string;
  user_username: string;
  video_file_path: string;
  watched_seconds: number;
  video_duration_seconds: number | null;
  counted_play: boolean;
  played_at: string;
}

interface ExportPayload {
  version: number;
  exported_at: string;
  settings: ExportSettingItem[];
  playback_history: ExportPlaybackItem[];
}

interface ImportResponse {
  imported_settings: number;
  imported_playback_history: number;
  skipped_playback_history: number;
  warnings: string[];
}

type VideoRecommendationSource = "lastfm" | "genre";

const VIDEO_RECOMMENDATION_SOURCE_KEY = "videoRecommendationSource";
const VIDEO_HOVER_PREVIEW_ENABLED_KEY = "videoHoverPreviewEnabled";
const ACTIVE_LIBRARY_SCAN_JOB_KEY = "activeLibraryScanJobId";
const ACTIVE_ARTIST_METADATA_SCAN_JOB_KEY = "activeArtistMetadataScanJobId";

function getStoredVideoRecommendationSource(): VideoRecommendationSource {
  if (typeof window === "undefined") return "lastfm";
  try {
    const value = window.localStorage.getItem(VIDEO_RECOMMENDATION_SOURCE_KEY);
    return value === "genre" ? "genre" : "lastfm";
  } catch {
    return "lastfm";
  }
}

function getStoredHoverPreviewEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const value = window.localStorage.getItem(VIDEO_HOVER_PREVIEW_ENABLED_KEY);
    if (value === null) return true;
    return value === "1";
  } catch {
    return true;
  }
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

export default function SettingsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [autoScan, setAutoScan] = useState(true);
  const [notifications, setNotifications] = useState(true);
  const [autoplay, setAutoplay] = useState(false);
  const [videoRecommendationSource, setVideoRecommendationSource] =
    useState<VideoRecommendationSource>(getStoredVideoRecommendationSource);
  const [hoverPreviewEnabled, setHoverPreviewEnabled] = useState<boolean>(
    getStoredHoverPreviewEnabled
  );

  // Scan state
  const [scanJobId, setScanJobId] = useState<string | null>(null);
  const [scanStatus, setScanStatus] = useState<ScanJob | null>(null);
  const [scanning, setScanning] = useState(false);
  const [cancellingScan, setCancellingScan] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [artistMetadataJobId, setArtistMetadataJobId] = useState<string | null>(null);
  const [artistMetadataStatus, setArtistMetadataStatus] = useState<ScanJob | null>(null);
  const [artistMetadataScanning, setArtistMetadataScanning] = useState(false);
  const artistMetadataPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [mediaPath, setMediaPath] = useState("");
  const [appDataPath, setAppDataPath] = useState("");
  const [transcodingEnabled, setTranscodingEnabled] = useState(false);
  const [viewThresholdPercent, setViewThresholdPercent] = useState(20);
  const [lastfmOverrideLocalArtistImages, setLastfmOverrideLocalArtistImages] =
    useState(true);
  const [videoInfiniteScroll, setVideoInfiniteScroll] = useState(false);
  const [libraryScanIntervalMinutes, setLibraryScanIntervalMinutes] = useState(0);
  const [metadataProvider, setMetadataProvider] = useState<"spotify" | "musicbrainz">("spotify");
  const [spotifyConfigured, setSpotifyConfigured] = useState(false);
  const [pendingDeleteUser, setPendingDeleteUser] = useState<UserItem | null>(null);
  const [cancelTranscodeOpen, setCancelTranscodeOpen] = useState(false);

  const isAdmin = user?.role === "admin";

  const { data: runtimeSettings, isLoading: runtimeLoading } = useQuery<RuntimeSettings>({
    queryKey: ["runtime-settings"],
    queryFn: () => api.get("/settings/runtime"),
    enabled: isAdmin,
  });

  const { data: users = [] } = useQuery<UserItem[]>({
    queryKey: ["admin-users"],
    queryFn: () => api.get("/auth/users"),
    enabled: isAdmin,
  });

  const deleteMutation = useMutation({
    mutationFn: (userId: string) => api.delete(`/auth/users/${userId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      setPendingDeleteUser(null);
      toast.success("User deleted");
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Failed to delete user")),
  });

  useEffect(() => {
    if (!runtimeSettings) return;
    setMediaPath(runtimeSettings.media_path);
    setAppDataPath(runtimeSettings.app_data_path);
    setTranscodingEnabled(runtimeSettings.transcoding_enabled);
    setViewThresholdPercent(runtimeSettings.view_threshold_percent);
    setLastfmOverrideLocalArtistImages(
      runtimeSettings.lastfm_override_local_artist_images
    );
    setVideoInfiniteScroll(runtimeSettings.video_infinite_scroll);
    setLibraryScanIntervalMinutes(runtimeSettings.library_scan_interval_minutes);
    setMetadataProvider(runtimeSettings.metadata_provider);
    setSpotifyConfigured(runtimeSettings.spotify_configured);
  }, [runtimeSettings]);

  const runtimeMutation = useMutation({
    mutationFn: () =>
      api.put<RuntimeSettings>("/settings/runtime", {
        media_path: mediaPath,
        app_data_path: appDataPath,
        transcoding_enabled: transcodingEnabled,
        view_threshold_percent: viewThresholdPercent,
        lastfm_override_local_artist_images: lastfmOverrideLocalArtistImages,
        video_infinite_scroll: videoInfiniteScroll,
        library_scan_interval_minutes: libraryScanIntervalMinutes,
        metadata_provider: metadataProvider,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["runtime-settings"] });
      // Video lists read this to decide how they paginate, so they have to be
      // told it changed or they keep their old behaviour until a reload.
      queryClient.invalidateQueries({ queryKey: ["browsing-settings"] });
      toast.success("Runtime settings saved");
    },
    onError: (error: unknown) =>
      toast.error(getErrorMessage(error, "Failed to save runtime settings")),
  });

  const regenerateThumbs = useMutation({
    mutationFn: () => api.post<{ message: string; task_id: string }>("/settings/thumbnail-regenerate"),
    onSuccess: (resp) => {
      toast.success(`${resp.message} (task ${resp.task_id.slice(0, 8)})`);
    },
    onError: (error: unknown) =>
      toast.error(getErrorMessage(error, "Failed to trigger thumbnail regeneration")),
  });

  // Poll only while a run is in flight; otherwise this is a cheap idle query.
  const { data: transcodeStatus } = useQuery<TranscodeStatus>({
    queryKey: ["transcode-status"],
    queryFn: () => api.get("/videos/transcode/status"),
    enabled: isAdmin,
    refetchInterval: (query) =>
      query.state.data?.run.active ? 2000 : false,
  });

  const transcodeRun = transcodeStatus?.run;
  const transcodeRunActive = !!transcodeRun?.active;
  const transcodePending = transcodeStatus?.pending ?? 0;

  // Once a run finishes, the library's playback URLs change, so drop the
  // cached video queries rather than leaving stale direct-stream URLs around.
  const prevTranscodeActiveRef = useRef(false);
  useEffect(() => {
    if (prevTranscodeActiveRef.current && !transcodeRunActive && transcodeRun) {
      queryClient.invalidateQueries({ queryKey: ["videos"] });
      const { completed, failed, cancelled } = transcodeRun;
      if (cancelled > 0) {
        toast.info(
          `Transcoding cancelled: ${completed} done, ${cancelled} skipped` +
            (failed > 0 ? `, ${failed} failed` : "")
        );
      } else if (failed > 0) {
        toast.warning(`Transcoding finished: ${completed} done, ${failed} failed`);
      } else if (completed > 0) {
        toast.success(`Transcoding complete: ${completed} video${completed === 1 ? "" : "s"}`);
      }
    }
    prevTranscodeActiveRef.current = transcodeRunActive;
  }, [transcodeRunActive, transcodeRun, queryClient]);

  const startTranscode = useMutation({
    mutationFn: () =>
      api.post<{ message: string; queued: number }>("/videos/transcode/run"),
    onSuccess: (resp) => {
      if (resp.queued === 0) {
        toast.info("Every video already has a transcode");
      } else {
        toast.success(`Queued ${resp.queued} video${resp.queued === 1 ? "" : "s"} for transcoding`);
      }
      queryClient.invalidateQueries({ queryKey: ["transcode-status"] });
    },
    onError: (error: unknown) =>
      toast.error(getErrorMessage(error, "Failed to start transcoding")),
  });

  const cancelTranscode = useMutation({
    mutationFn: () => api.post<{ message: string }>("/videos/transcode/cancel"),
    onSuccess: () => {
      setCancelTranscodeOpen(false);
      toast.success("Cancelling transcode run");
      queryClient.invalidateQueries({ queryKey: ["transcode-status"] });
    },
    onError: (error: unknown) => {
      setCancelTranscodeOpen(false);
      toast.error(getErrorMessage(error, "Failed to cancel transcoding"));
    },
  });

  const exportMutation = useMutation({
    mutationFn: () => api.get<ExportPayload>("/settings/export"),
    onSuccess: (payload) => {
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      a.href = url;
      a.download = `popinn-export-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Export downloaded");
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Failed to export data")),
  });

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const csrf = getCookie("popinn_csrf_token");
      const res = await fetch("/api/v1/settings/import", {
        method: "POST",
        headers: csrf ? { "X-CSRF-Token": csrf } : {},
        credentials: "include",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Import failed");
      }
      return res.json() as Promise<ImportResponse>;
    },
    onSuccess: (resp) => {
      queryClient.invalidateQueries({ queryKey: ["runtime-settings"] });
      queryClient.invalidateQueries({ queryKey: ["videos"] });
      queryClient.invalidateQueries({ queryKey: ["artists"] });
      toast.success(
        `Imported settings: ${resp.imported_settings}, plays: ${resp.imported_playback_history}, skipped: ${resp.skipped_playback_history}`
      );
      if (resp.warnings.length > 0) {
        toast.info(`Import warnings: ${resp.warnings.slice(0, 2).join(" | ")}`);
      }
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Failed to import data")),
  });

  const pollScanStatus = useCallback(async (jobId: string) => {
    try {
      const job = await api.get<ScanJob>(`/scan/jobs/${jobId}`);
      setScanStatus(job);
      if (job.status === "completed" || job.status === "failed") {
        setScanning(false);
        setCancellingScan(false);
        setScanJobId(jobId);
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        if (typeof window !== "undefined") {
          window.localStorage.removeItem(ACTIVE_LIBRARY_SCAN_JOB_KEY);
        }
        // Refresh data
        queryClient.invalidateQueries({ queryKey: ["videos"] });
        queryClient.invalidateQueries({ queryKey: ["artists"] });
        if (job.status === "completed") {
          toast.success(`Scan complete: ${job.files_found} found, ${job.files_added} added`);
        } else {
          const isCancelled = (job.errors || "").toLowerCase().includes("cancel");
          if (isCancelled) {
            toast.info("Scan cancelled");
          } else {
            toast.error("Scan failed");
          }
        }
      }
    } catch {
      // Keep polling
    }
  }, [queryClient]);

  const pollArtistMetadataStatus = useCallback(async (jobId: string) => {
    try {
      const job = await api.get<ScanJob>(`/scan/jobs/${jobId}`);
      setArtistMetadataStatus(job);
      if (job.status === "completed" || job.status === "failed") {
        setArtistMetadataScanning(false);
        setArtistMetadataJobId(jobId);
        if (artistMetadataPollRef.current) {
          clearInterval(artistMetadataPollRef.current);
          artistMetadataPollRef.current = null;
        }
        if (typeof window !== "undefined") {
          window.localStorage.removeItem(ACTIVE_ARTIST_METADATA_SCAN_JOB_KEY);
        }
        queryClient.invalidateQueries({ queryKey: ["artists"] });
        if (job.status === "completed") {
          toast.success(
            `Artist metadata refresh complete: ${job.files_found || 0} processed, ${job.files_added || 0} updated`
          );
        } else {
          toast.error("Artist metadata refresh failed");
        }
      }
    } catch {
      // Keep polling
    }
  }, [queryClient]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (artistMetadataPollRef.current) clearInterval(artistMetadataPollRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function resumeScanPolling() {
      if (typeof window === "undefined") return;

      const libraryJobId = window.localStorage.getItem(ACTIVE_LIBRARY_SCAN_JOB_KEY);
      if (libraryJobId) {
        try {
          const job = await api.get<ScanJob>(`/scan/jobs/${libraryJobId}`);
          if (cancelled) return;
          setScanJobId(libraryJobId);
          setScanStatus(job);
          if (job.status === "running" || job.status === "pending") {
            setScanning(true);
            if (!pollRef.current) {
              pollRef.current = setInterval(() => pollScanStatus(libraryJobId), 2000);
            }
          } else {
            window.localStorage.removeItem(ACTIVE_LIBRARY_SCAN_JOB_KEY);
            setScanning(false);
          }
        } catch {
          window.localStorage.removeItem(ACTIVE_LIBRARY_SCAN_JOB_KEY);
        }
      }

      const artistJobId = window.localStorage.getItem(ACTIVE_ARTIST_METADATA_SCAN_JOB_KEY);
      if (artistJobId) {
        try {
          const job = await api.get<ScanJob>(`/scan/jobs/${artistJobId}`);
          if (cancelled) return;
          setArtistMetadataJobId(artistJobId);
          setArtistMetadataStatus(job);
          if (job.status === "running" || job.status === "pending") {
            setArtistMetadataScanning(true);
            if (!artistMetadataPollRef.current) {
              artistMetadataPollRef.current = setInterval(
                () => pollArtistMetadataStatus(artistJobId),
                2000
              );
            }
          } else {
            window.localStorage.removeItem(ACTIVE_ARTIST_METADATA_SCAN_JOB_KEY);
            setArtistMetadataScanning(false);
          }
        } catch {
          window.localStorage.removeItem(ACTIVE_ARTIST_METADATA_SCAN_JOB_KEY);
        }
      }
    }

    void resumeScanPolling();

    return () => {
      cancelled = true;
    };
  }, [pollArtistMetadataStatus, pollScanStatus]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(VIDEO_RECOMMENDATION_SOURCE_KEY, videoRecommendationSource);
    } catch {
      // Ignore storage failures; setting still applies for this session.
    }
  }, [videoRecommendationSource]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        VIDEO_HOVER_PREVIEW_ENABLED_KEY,
        hoverPreviewEnabled ? "1" : "0"
      );
    } catch {
      // Ignore storage failures; setting still applies for this session.
    }
  }, [hoverPreviewEnabled]);

  async function handleScan() {
    if (scanning) return;
    setScanning(true);
    setScanStatus(null);

    try {
      const resp = await api.post<{ job_id: string; message: string }>("/scan/run");
      const jobId = resp.job_id;
      setScanJobId(jobId);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(ACTIVE_LIBRARY_SCAN_JOB_KEY, jobId);
      }

      // Start polling
      pollRef.current = setInterval(() => pollScanStatus(jobId), 2000);
      // Also poll immediately after a short delay
      setTimeout(() => pollScanStatus(jobId), 1000);
    } catch (error: unknown) {
      setScanning(false);
      setCancellingScan(false);
      toast.error(getErrorMessage(error, "Failed to start scan"));
    }
  }

  async function handleCancelScan() {
    if (!scanJobId || !scanning || cancellingScan) return;
    setCancellingScan(true);
    try {
      await api.post<{ job_id: string; message: string }>(`/scan/jobs/${scanJobId}/cancel`);
      toast.info("Scan cancel requested");
    } catch (error: unknown) {
      setCancellingScan(false);
      toast.error(getErrorMessage(error, "Failed to cancel scan"));
    }
  }

  async function handleArtistMetadataRefresh() {
    if (artistMetadataScanning) return;
    setArtistMetadataScanning(true);
    setArtistMetadataStatus(null);

    try {
      const resp = await api.post<{ job_id: string; message: string }>("/scan/artist-metadata/run");
      const jobId = resp.job_id;
      setArtistMetadataJobId(jobId);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(ACTIVE_ARTIST_METADATA_SCAN_JOB_KEY, jobId);
      }

      artistMetadataPollRef.current = setInterval(() => pollArtistMetadataStatus(jobId), 2000);
      setTimeout(() => pollArtistMetadataStatus(jobId), 1000);
    } catch (error: unknown) {
      setArtistMetadataScanning(false);
      toast.error(getErrorMessage(error, "Failed to start artist metadata refresh"));
    }
  }

  function handleImportFile(file: File | null) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".json")) {
      toast.error("Please select a JSON export file");
      return;
    }
    importMutation.mutate(file);
  }

  return (
    <PageTransition>
      <div className="mx-auto max-w-2xl space-y-8">
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>

        {/* Library Scan */}
        {isAdmin && (
          <section className="space-y-4 rounded-xl border border-border bg-card p-6">
            <div className="flex items-center gap-2">
              <FolderSearch className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold text-foreground">Library Scan</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              Scan your media directory for new artists, videos, and subtitles.
            </p>

            <div className="grid grid-cols-2 gap-2">
              <Button onClick={handleScan} disabled={scanning} className="w-full">
                {scanning ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Scanning...
                  </>
                ) : (
                  "Scan Now"
                )}
              </Button>

              <Button
                onClick={handleArtistMetadataRefresh}
                disabled={artistMetadataScanning}
                variant="secondary"
                className="w-full"
              >
                {artistMetadataScanning ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Refreshing Artist Metadata...
                  </>
                ) : (
                  "Refresh Artist Bio + Images"
                )}
              </Button>
            </div>

            {/* Scan progress */}
            {scanning && (
              <div className="space-y-2">
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleCancelScan}
                    disabled={!scanJobId || cancellingScan}
                  >
                    {cancellingScan ? "Cancelling..." : "Cancel Scan"}
                  </Button>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-secondary">
                  {scanStatus?.folders_total && scanStatus.folders_total > 0 ? (
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-500"
                      style={{
                        width: `${Math.min(
                          100,
                          Math.round(
                            ((scanStatus.folders_processed || 0) / scanStatus.folders_total) * 100
                          )
                        )}%`,
                      }}
                    />
                  ) : (
                    <div className="h-full animate-pulse rounded-full bg-primary" style={{ width: "100%" }} />
                  )}
                </div>
                {scanStatus?.status === "running" ? (
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <p>
                      {scanStatus.current_folder
                        ? `Scanning folder: ${scanStatus.current_folder}`
                        : "Scanning media directory..."}
                    </p>
                    {scanStatus.folders_total && scanStatus.folders_total > 0 && (
                      <p>
                        Progress: {scanStatus.folders_processed || 0}/{scanStatus.folders_total} folders
                      </p>
                    )}
                    <p>
                      Files: {scanStatus.files_found || 0} found, {scanStatus.files_added || 0} added
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Starting scan...</p>
                )}
              </div>
            )}

            {/* Scan results */}
            {!scanning && scanStatus && (
              <div
                className={`flex items-start gap-3 rounded-lg border p-4 ${
                  scanStatus.status === "completed"
                    ? "border-green-500/30 bg-green-500/5"
                    : "border-destructive/30 bg-destructive/5"
                }`}
              >
                {scanStatus.status === "completed" ? (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-500" />
                ) : (
                  <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                )}
                <div className="text-sm">
                  {scanStatus.status === "completed" ? (
                    <>
                      <p className="font-medium text-foreground">Scan complete</p>
                      <p className="text-muted-foreground">
                        Found {scanStatus.files_found} files, added {scanStatus.files_added} new
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="font-medium text-destructive">
                        {(scanStatus.errors || "").toLowerCase().includes("cancel")
                          ? "Scan cancelled"
                          : "Scan failed"}
                      </p>
                      {scanStatus.errors && (
                        <p className="text-muted-foreground">{scanStatus.errors}</p>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Artist metadata refresh progress */}
            {artistMetadataScanning && (
              <div className="space-y-2 rounded-lg border border-border p-3">
                <div className="h-2 overflow-hidden rounded-full bg-secondary">
                  {artistMetadataStatus?.folders_total && artistMetadataStatus.folders_total > 0 ? (
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-500"
                      style={{
                        width: `${Math.min(
                          100,
                          Math.round(
                            ((artistMetadataStatus.folders_processed || 0) /
                              artistMetadataStatus.folders_total) *
                              100
                          )
                        )}%`,
                      }}
                    />
                  ) : (
                    <div className="h-full animate-pulse rounded-full bg-primary" style={{ width: "100%" }} />
                  )}
                </div>
                {artistMetadataStatus?.status === "running" ? (
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <p>
                      {artistMetadataStatus.current_folder
                        ? `Refreshing artist: ${artistMetadataStatus.current_folder}`
                        : "Refreshing artist metadata..."}
                    </p>
                    {artistMetadataStatus.folders_total && artistMetadataStatus.folders_total > 0 && (
                      <p>
                        Progress: {artistMetadataStatus.folders_processed || 0}/
                        {artistMetadataStatus.folders_total} artists
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Starting artist metadata refresh...</p>
                )}
              </div>
            )}

            {!artistMetadataScanning && artistMetadataStatus && (
              <div
                className={`flex items-start gap-3 rounded-lg border p-4 ${
                  artistMetadataStatus.status === "completed"
                    ? "border-green-500/30 bg-green-500/5"
                    : "border-destructive/30 bg-destructive/5"
                }`}
              >
                {artistMetadataStatus.status === "completed" ? (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-500" />
                ) : (
                  <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                )}
                <div className="text-sm">
                  {artistMetadataStatus.status === "completed" ? (
                    <>
                      <p className="font-medium text-foreground">Artist metadata refresh complete</p>
                      <p className="text-muted-foreground">
                        Processed {artistMetadataStatus.files_found || 0} artists, updated {artistMetadataStatus.files_added || 0}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="font-medium text-destructive">Artist metadata refresh failed</p>
                      {artistMetadataStatus.errors && (
                        <p className="text-muted-foreground">{artistMetadataStatus.errors}</p>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {isAdmin && (
          <section className="space-y-4 rounded-xl border border-border bg-card p-6">
            <h2 className="text-lg font-semibold text-foreground">Library Runtime Settings</h2>
            {runtimeLoading ? (
              <p className="text-sm text-muted-foreground">Loading runtime settings...</p>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="media-path">Media folder path</Label>
                  <Input
                    id="media-path"
                    value={mediaPath}
                    onChange={(e) => setMediaPath(e.target.value)}
                    placeholder="/path/to/media"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="app-data-path">App data folder path</Label>
                  <Input
                    id="app-data-path"
                    value={appDataPath}
                    onChange={(e) => setAppDataPath(e.target.value)}
                    placeholder="/path/to/app-data"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="transcoding-enabled">Enable HLS transcoding</Label>
                  <Switch
                    id="transcoding-enabled"
                    checked={transcodingEnabled}
                    onCheckedChange={setTranscodingEnabled}
                  />
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="view-threshold">View threshold</Label>
                    <span className="text-sm font-medium text-foreground">{viewThresholdPercent}%</span>
                  </div>
                  <Slider
                    id="view-threshold"
                    value={[viewThresholdPercent]}
                    min={1}
                    max={100}
                    step={1}
                    onValueChange={(value) => setViewThresholdPercent(value[0] ?? 20)}
                  />
                  <p className="text-xs text-muted-foreground">
                    A playback counts as a view after this watch percentage. Playback history still records every session.
                  </p>
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label htmlFor="lastfm-override-local-artist-images">
                      Override local artist images on Last.fm update
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      If enabled, Last.fm refresh can replace manually uploaded local artist images.
                    </p>
                  </div>
                  <Switch
                    id="lastfm-override-local-artist-images"
                    checked={lastfmOverrideLocalArtistImages}
                    onCheckedChange={setLastfmOverrideLocalArtistImages}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label htmlFor="video-infinite-scroll">
                      Infinite scroll instead of pages
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Video lists and artist pages load more as you scroll rather
                      than splitting into numbered pages.
                    </p>
                  </div>
                  <Switch
                    id="video-infinite-scroll"
                    checked={videoInfiniteScroll}
                    onCheckedChange={setVideoInfiniteScroll}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="library-scan-interval">
                    Automatic library scan interval (minutes)
                  </Label>
                  <Input
                    id="library-scan-interval"
                    type="number"
                    min={0}
                    max={10080}
                    step={1}
                    value={libraryScanIntervalMinutes}
                    onChange={(e) =>
                      setLibraryScanIntervalMinutes(
                        Math.max(0, Math.min(10080, Number(e.target.value) || 0))
                      )
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Rescan the media library automatically this often. Set to 0 to
                    disable and scan only on demand.
                  </p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="metadata-provider">Metadata search provider</Label>
                  <select
                    id="metadata-provider"
                    value={metadataProvider}
                    onChange={(e) =>
                      setMetadataProvider(e.target.value === "musicbrainz" ? "musicbrainz" : "spotify")
                    }
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
                  >
                    <option value="spotify" disabled={!spotifyConfigured}>
                      Spotify{spotifyConfigured ? "" : " (credentials not configured)"}
                    </option>
                    <option value="musicbrainz">MusicBrainz (no account needed)</option>
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Source for the "Match metadata" search when editing videos. Spotify
                    needs API credentials in the server config; MusicBrainz is free and
                    needs none, but rarely returns a genre.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => runtimeMutation.mutate()}
                    disabled={runtimeMutation.isPending || !mediaPath.trim() || !appDataPath.trim()}
                  >
                    {runtimeMutation.isPending ? "Saving..." : "Save Runtime Settings"}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => regenerateThumbs.mutate()}
                    disabled={regenerateThumbs.isPending}
                  >
                    {regenerateThumbs.isPending ? "Starting..." : "Regenerate Thumbnails"}
                  </Button>
                </div>
              </>
            )}
          </section>
        )}

        {isAdmin && (
          <section className="space-y-4 rounded-xl border border-border bg-card p-6">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-foreground">Transcoding</h2>
              <p className="text-sm text-muted-foreground">
                Formats browsers cannot play directly (MKV, AVI, MOV) need an HLS
                rendition before they will play. Transcoding runs in the background.
              </p>
            </div>

            {!transcodeStatus ? (
              <p className="text-sm text-muted-foreground">Loading transcode status...</p>
            ) : (
              <>
                {!transcodeStatus.transcoding_enabled && (
                  <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
                    <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
                    <div className="space-y-1 text-sm">
                      <p className="font-medium text-foreground">Transcoding is disabled</p>
                      <p className="text-muted-foreground">
                        Enable it in Runtime Settings above, or these videos will not play.
                      </p>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-2xl font-semibold text-foreground">
                      {transcodeStatus.needs_transcode}
                    </p>
                    <p className="text-xs text-muted-foreground">Need transcoding</p>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-2xl font-semibold text-foreground">
                      {transcodeStatus.transcoded}
                    </p>
                    <p className="text-xs text-muted-foreground">Transcoded</p>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <p
                      className={`text-2xl font-semibold ${
                        transcodePending > 0 ? "text-amber-500" : "text-foreground"
                      }`}
                    >
                      {transcodePending}
                    </p>
                    <p className="text-xs text-muted-foreground">Pending</p>
                  </div>
                </div>

                {transcodeRunActive && transcodeRun && (
                  <div className="space-y-2">
                    <div className="h-2 overflow-hidden rounded-full bg-secondary">
                      {transcodeRun.total > 0 ? (
                        <div
                          className="h-full rounded-full bg-primary transition-all duration-500"
                          style={{
                            width: `${transcodeProgressPercent(
                              transcodeRun.processed,
                              transcodeRun.total
                            )}%`,
                          }}
                        />
                      ) : (
                        <div
                          className="h-full animate-pulse rounded-full bg-primary"
                          style={{ width: "100%" }}
                        />
                      )}
                    </div>
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <p>
                        Progress: {transcodeRun.processed}/{transcodeRun.total} videos
                        {transcodeRun.failed > 0 && ` (${transcodeRun.failed} failed)`}
                        {transcodeRun.cancelled > 0 &&
                          ` (${transcodeRun.cancelled} cancelled)`}
                      </p>
                      {transcodeRun.cancelling ? (
                        <p>Cancelling: waiting for the current video to stop...</p>
                      ) : (
                        transcodeRun.current && (
                          <p className="truncate">Transcoding: {transcodeRun.current}</p>
                        )
                      )}
                    </div>
                  </div>
                )}

                {!transcodeRunActive && transcodePending === 0 && transcodeStatus.needs_transcode > 0 && (
                  <div className="flex items-start gap-3 rounded-lg border border-border p-4">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
                    <p className="text-sm text-muted-foreground">
                      Every video that needs transcoding has been transcoded.
                    </p>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => startTranscode.mutate()}
                    disabled={
                      startTranscode.isPending ||
                      transcodeRunActive ||
                      transcodePending === 0 ||
                      !transcodeStatus.transcoding_enabled
                    }
                  >
                    {transcodeRunActive ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Transcoding...
                      </>
                    ) : startTranscode.isPending ? (
                      "Starting..."
                    ) : transcodePending > 0 ? (
                      `Transcode ${transcodePending} Video${transcodePending === 1 ? "" : "s"}`
                    ) : (
                      "Nothing to Transcode"
                    )}
                  </Button>

                  {transcodeRunActive && (
                    <Button
                      variant="outline"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setCancelTranscodeOpen(true)}
                      disabled={
                        cancelTranscode.isPending || !!transcodeRun?.cancelling
                      }
                    >
                      {transcodeRun?.cancelling
                        ? "Cancelling..."
                        : "Cancel Transcoding"}
                    </Button>
                  )}
                </div>
              </>
            )}
          </section>
        )}

        {isAdmin && (
          <section className="space-y-4 rounded-xl border border-border bg-card p-6">
            <h2 className="text-lg font-semibold text-foreground">Backup & Restore</h2>
            <p className="text-sm text-muted-foreground">
              Export and import settings plus playback history for migrations to another server with the same media files.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => exportMutation.mutate()}
                disabled={exportMutation.isPending}
              >
                {exportMutation.isPending ? "Exporting..." : "Export Settings + History"}
              </Button>
              <Button
                variant="secondary"
                disabled={importMutation.isPending}
                onClick={() => document.getElementById("settings-import-file")?.click()}
              >
                {importMutation.isPending ? "Importing..." : "Import Settings + History"}
              </Button>
              <input
                id="settings-import-file"
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  handleImportFile(e.target.files?.[0] || null);
                  e.currentTarget.value = "";
                }}
              />
            </div>
          </section>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Playback */}
          <section className="space-y-4 rounded-xl border border-border bg-card p-6">
            <h2 className="text-lg font-semibold text-foreground">Playback &amp; Notifications</h2>
            <div className="flex items-center justify-between">
              <Label htmlFor="autoplay">Autoplay next video</Label>
              <Switch id="autoplay" checked={autoplay} onCheckedChange={setAutoplay} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="video-recommendation-source">Recommended videos source</Label>
              <select
                id="video-recommendation-source"
                value={videoRecommendationSource}
                onChange={(e) =>
                  setVideoRecommendationSource(
                    e.target.value === "genre" ? "genre" : "lastfm"
                  )
                }
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
              >
                <option value="lastfm">Last.fm similar tracks</option>
                <option value="genre">Same genre in library</option>
              </select>
              <p className="text-xs text-muted-foreground">
                Controls how recommended music videos are generated in the player.
              </p>
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label htmlFor="hover-preview-enabled">Hover video previews</Label>
                <p className="text-xs text-muted-foreground">
                  Autoplay muted preview on thumbnail hover. Hover previews do not affect history or views.
                </p>
              </div>
              <Switch
                id="hover-preview-enabled"
                checked={hoverPreviewEnabled}
                onCheckedChange={setHoverPreviewEnabled}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="notif">Enable notifications</Label>
              <Switch id="notif" checked={notifications} onCheckedChange={setNotifications} />
            </div>
          </section>
        </div>

        {/* Admin: User Management */}
        {isAdmin && (
          <section className="space-y-4 rounded-xl border border-border bg-card p-6">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold text-foreground">User Management</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              Manage registered users. Only admins can see this section.
            </p>

            {users.length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No users found
              </p>
            )}

            <div className="space-y-3">
              {users.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center gap-4 rounded-lg border border-border p-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{u.username}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          u.role === "admin"
                            ? "bg-primary/15 text-primary"
                            : "bg-secondary text-muted-foreground"
                        }`}
                      >
                        {u.role}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                    <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Calendar className="h-2.5 w-2.5" />
                      Joined {new Date(u.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  {u.id !== user?.id && (
                    <button
                      onClick={() => {
                        setPendingDeleteUser(u);
                      }}
                      className="rounded p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      <AlertDialog open={cancelTranscodeOpen} onOpenChange={setCancelTranscodeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel transcoding?</AlertDialogTitle>
            <AlertDialogDescription>
              Videos still queued will be skipped, and the one being encoded now
              is stopped and its partial output discarded, so it counts as not
              transcoded again. Videos already finished are kept. You can start
              another run at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelTranscode.isPending}>
              Keep Transcoding
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => cancelTranscode.mutate()}
              disabled={cancelTranscode.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {cancelTranscode.isPending ? "Cancelling..." : "Cancel Run"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!pendingDeleteUser}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteUser(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete user?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDeleteUser
                ? `Delete user "${pendingDeleteUser.username}". This action cannot be undone.`
                : "Delete this user. This action cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDeleteUser) deleteMutation.mutate(pendingDeleteUser.id);
              }}
              disabled={deleteMutation.isPending || !pendingDeleteUser}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageTransition>
  );
}
