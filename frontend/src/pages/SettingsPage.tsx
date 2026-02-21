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
  lastfm_override_local_artist_images: boolean;
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
  const [pendingDeleteUser, setPendingDeleteUser] = useState<UserItem | null>(null);

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
  }, [runtimeSettings]);

  const runtimeMutation = useMutation({
    mutationFn: () =>
      api.put<RuntimeSettings>("/settings/runtime", {
        media_path: mediaPath,
        app_data_path: appDataPath,
        transcoding_enabled: transcodingEnabled,
        view_threshold_percent: viewThresholdPercent,
        lastfm_override_local_artist_images: lastfmOverrideLocalArtistImages,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["runtime-settings"] });
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
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        // Refresh data
        queryClient.invalidateQueries({ queryKey: ["videos"] });
        queryClient.invalidateQueries({ queryKey: ["artists"] });
        if (job.status === "completed") {
          toast.success(`Scan complete: ${job.files_found} found, ${job.files_added} added`);
        } else {
          toast.error("Scan failed");
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
        if (artistMetadataPollRef.current) {
          clearInterval(artistMetadataPollRef.current);
          artistMetadataPollRef.current = null;
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

      // Start polling
      pollRef.current = setInterval(() => pollScanStatus(jobId), 2000);
      // Also poll immediately after a short delay
      setTimeout(() => pollScanStatus(jobId), 1000);
    } catch (error: unknown) {
      setScanning(false);
      toast.error(getErrorMessage(error, "Failed to start scan"));
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
                      <p className="font-medium text-destructive">Scan failed</p>
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
            <h2 className="text-lg font-semibold text-foreground">Playback</h2>
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
          </section>

          {/* Notifications */}
          <section className="space-y-4 rounded-xl border border-border bg-card p-6">
            <h2 className="text-lg font-semibold text-foreground">Notifications</h2>
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
