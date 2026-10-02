import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient, useQueries } from "@tanstack/react-query";
import { User, Shield, Calendar, Upload, Pencil, Clock3, PlayCircle, Music2, Radio, LogOut, Film } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import PageTransition from "@/components/PageTransition";
import { motion } from "framer-motion";
import { toast } from "sonner";
import type { MusicVideo } from "@/data/mockData";

interface ProfileUser {
  id: string;
  username: string;
  email: string;
  image_url?: string | null;
  role: string;
  is_active: boolean;
  created_at: string;
}

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

interface ViewThresholdSettings {
  view_threshold_percent: number;
}

type StatsRangePreset = "7d" | "30d" | "90d" | "custom";
type StatsGranularity = "daily" | "weekly";
type TopArtistMetric = "views" | "minutes";
type TopVideoMetric = "views" | "minutes";

function getCookie(name: string): string | null {
  const match = document.cookie
    .split("; ")
    .find((part) => part.startsWith(`${name}=`));
  if (!match) return null;
  return decodeURIComponent(match.split("=")[1] || "");
}

function formatWatched(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
}

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

function toDateInputValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
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

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function getWeekStart(date: Date): Date {
  const d = startOfDay(date);
  const day = d.getDay();
  const diff = (day + 6) % 7;
  d.setDate(d.getDate() - diff);
  return d;
}

function shortDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

const playsChartConfig = {
  views: { label: "Views", color: "hsl(var(--primary))" },
} satisfies ChartConfig;

const watchChartConfig = {
  watch_minutes: { label: "Watch Minutes", color: "hsl(var(--primary) / 0.65)" },
} satisfies ChartConfig;

export default function ProfilePage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [dragOver, setDragOver] = useState(false);
  const [profileImage, setProfileImage] = useState<string | null>(user?.image_url || null);
  const [editOpen, setEditOpen] = useState(false);
  const [historyTitleFilter, setHistoryTitleFilter] = useState("");
  const [historyArtistFilter, setHistoryArtistFilter] = useState("all");
  const [historyArtistSearch, setHistoryArtistSearch] = useState("");
  const [historyStartDate, setHistoryStartDate] = useState("");
  const [historyEndDate, setHistoryEndDate] = useState("");
  const [profileTab, setProfileTab] = useState("stats");
  const [statsPreset, setStatsPreset] = useState<StatsRangePreset>("30d");
  const [statsGranularity, setStatsGranularity] = useState<StatsGranularity>("daily");
  const [topArtistMetric, setTopArtistMetric] = useState<TopArtistMetric>("views");
  const [topVideoMetric, setTopVideoMetric] = useState<TopVideoMetric>("views");
  const [statsStart, setStatsStart] = useState(() => toDateInputValue(addDays(new Date(), -29)));
  const [statsEnd, setStatsEnd] = useState(() => toDateInputValue(new Date()));

  const [username, setUsername] = useState(user?.username ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [newPassword, setNewPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");

  const { data: playbackHistory = [], isLoading: playbackHistoryLoading } = useQuery<PlaybackHistoryItem[]>({
    queryKey: ["my-playback-history"],
    queryFn: () => api.get("/auth/me/plays?limit=2000"),
  });
  const { data: viewThreshold } = useQuery<ViewThresholdSettings>({
    queryKey: ["view-threshold"],
    queryFn: () => api.get("/settings/view-threshold"),
  });
  const { data: libraryTotal } = useQuery<{ total: number }>({
    queryKey: ["library-video-total"],
    queryFn: () => api.get("/videos/?limit=1"),
  });
  const viewThresholdPercent = viewThreshold?.view_threshold_percent ?? 20;

  const parsedPlaybackHistory = useMemo(
    () =>
      playbackHistory
        .map((item) => ({ ...item, playedAt: new Date(item.played_at) }))
        .filter((item) => !Number.isNaN(item.playedAt.getTime())),
    [playbackHistory]
  );

  const statsRange = useMemo(() => {
    const now = new Date();
    const endNow = endOfDay(now);
    if (statsPreset === "7d") {
      return { start: startOfDay(addDays(now, -6)), end: endNow };
    }
    if (statsPreset === "30d") {
      return { start: startOfDay(addDays(now, -29)), end: endNow };
    }
    if (statsPreset === "90d") {
      return { start: startOfDay(addDays(now, -89)), end: endNow };
    }

    const customStart = parseDateInput(statsStart);
    const customEnd = parseDateInput(statsEnd);
    if (!customStart || !customEnd) {
      return { start: startOfDay(addDays(now, -29)), end: endNow };
    }
    if (customStart > customEnd) {
      return { start: startOfDay(customEnd), end: endOfDay(customStart) };
    }
    return { start: startOfDay(customStart), end: endOfDay(customEnd) };
  }, [statsPreset, statsStart, statsEnd]);

  const statsHistory = useMemo(
    () =>
      parsedPlaybackHistory.filter(
        (entry) => entry.playedAt >= statsRange.start && entry.playedAt <= statsRange.end
      ),
    [parsedPlaybackHistory, statsRange]
  );

  const trendData = useMemo(() => {
    const bucketMap = new Map<
      string,
      { key: string; label: string; bucketDate: Date; views: number; watch_seconds: number }
    >();

    let cursor = statsGranularity === "daily" ? startOfDay(statsRange.start) : getWeekStart(statsRange.start);
    const rangeEnd = endOfDay(statsRange.end);
    const stepDays = statsGranularity === "daily" ? 1 : 7;

    while (cursor <= rangeEnd) {
      const key = toDateInputValue(cursor);
      const label = statsGranularity === "daily" ? shortDate(cursor) : `Wk ${shortDate(cursor)}`;
      bucketMap.set(key, { key, label, bucketDate: new Date(cursor), views: 0, watch_seconds: 0 });
      cursor = addDays(cursor, stepDays);
    }

    statsHistory.forEach((entry) => {
      const bucketDate = statsGranularity === "daily" ? startOfDay(entry.playedAt) : getWeekStart(entry.playedAt);
      const key = toDateInputValue(bucketDate);
      const existing = bucketMap.get(key);
      if (!existing) return;
      existing.views += entry.counted_play ? 1 : 0;
      existing.watch_seconds += entry.watched_seconds;
    });

    return Array.from(bucketMap.values())
      .sort((a, b) => a.bucketDate.getTime() - b.bucketDate.getTime())
      .map((bucket) => ({
        label: bucket.label,
        views: bucket.views,
        watch_minutes: Number((bucket.watch_seconds / 60).toFixed(1)),
      }));
  }, [statsHistory, statsGranularity, statsRange]);

  const topArtists = useMemo(() => {
    const map = new Map<string, { id: string; name: string; views: number; watch_seconds: number }>();
    statsHistory.forEach((entry) => {
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
    const artists = Array.from(map.values());
    const ranked = artists
      .filter((artist) =>
        topArtistMetric === "views"
          ? artist.views > 0
          : artist.watch_seconds > 0
      )
      .sort((a, b) =>
        topArtistMetric === "views"
          ? b.views - a.views || b.watch_seconds - a.watch_seconds
          : b.watch_seconds - a.watch_seconds || b.views - a.views
      );
    return ranked.slice(0, 5);
  }, [statsHistory, topArtistMetric]);

  const topArtistDetails = useQueries({
    queries: topArtists.map((artist) => ({
      queryKey: ["artist-detail-brief", artist.id],
      queryFn: () => api.get<{ id: string; image_url?: string | null }>(`/artists/${artist.id}`),
      staleTime: 5 * 60 * 1000,
    })),
  });

  const topArtistImageMap = useMemo(() => {
    const map = new Map<string, string | null>();
    topArtists.forEach((artist, index) => {
      map.set(artist.id, topArtistDetails[index]?.data?.image_url || null);
    });
    return map;
  }, [topArtists, topArtistDetails]);

  const topVideos = useMemo(() => {
    const map = new Map<
      string,
      { id: string; title: string; artist_name: string; views: number; watch_seconds: number }
    >();
    statsHistory.forEach((entry) => {
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
      )
      .slice(0, 5);
  }, [statsHistory, topVideoMetric]);

  const topVideoDetails = useQueries({
    queries: topVideos.map((video) => ({
      queryKey: ["top-video-brief", video.id],
      queryFn: () => api.get<MusicVideo>(`/videos/${video.id}`),
      staleTime: 5 * 60 * 1000,
    })),
  });

  const topVideoThumbMap = useMemo(() => {
    const map = new Map<string, string | null>();
    topVideos.forEach((video, index) => {
      map.set(video.id, topVideoDetails[index]?.data?.thumbnail_url || null);
    });
    return map;
  }, [topVideos, topVideoDetails]);

  const totalWatchSeconds = useMemo(
    () => statsHistory.reduce((sum, item) => sum + item.watched_seconds, 0),
    [statsHistory]
  );

  const totalViews = useMemo(
    () => statsHistory.reduce((sum, item) => sum + (item.counted_play ? 1 : 0), 0),
    [statsHistory]
  );

  const historyArtists = useMemo(() => {
    const map = new Map<string, string>();
    playbackHistory.forEach((item) => map.set(item.artist_id, item.artist_name));
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [playbackHistory]);

  const searchedHistoryArtists = useMemo(() => {
    const needle = historyArtistSearch.trim().toLowerCase();
    if (!needle) return historyArtists;
    return historyArtists.filter((artist) => artist.name.toLowerCase().includes(needle));
  }, [historyArtists, historyArtistSearch]);

  const filteredPlaybackHistory = useMemo(() => {
    const start = parseDateInput(historyStartDate);
    const end = parseDateInput(historyEndDate);
    const startTs = start ? startOfDay(start).getTime() : null;
    const endTs = end ? endOfDay(end).getTime() : null;
    const needle = historyTitleFilter.trim().toLowerCase();
    return parsedPlaybackHistory.filter((entry) => {
      const titleOk = needle
        ? entry.video_title.toLowerCase().includes(needle)
        : true;
      const artistOk = historyArtistFilter === "all"
        ? true
        : entry.artist_id === historyArtistFilter;
      const playedAtTs = entry.playedAt.getTime();
      const startOk = startTs === null ? true : playedAtTs >= startTs;
      const endOk = endTs === null ? true : playedAtTs <= endTs;
      return titleOk && artistOk && startOk && endOk;
    });
  }, [
    parsedPlaybackHistory,
    historyTitleFilter,
    historyArtistFilter,
    historyStartDate,
    historyEndDate,
  ]);

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, string | undefined>) =>
      api.patch("/auth/me", data),
    onSuccess: () => {
      toast.success("Profile updated");
      setCurrentPassword("");
      setNewPassword("");
      queryClient.invalidateQueries({ queryKey: ["me"] });
      setEditOpen(false);
      // Re-fetch user info by refreshing the page context
      window.location.reload();
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Failed to update profile";
      toast.error(message);
    },
  });

  const uploadImageMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const csrf = getCookie("popinn_csrf_token");
      const res = await fetch("/api/v1/auth/me/image", {
        method: "PUT",
        headers: csrf ? { "X-CSRF-Token": csrf } : {},
        credentials: "include",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Upload failed");
      }
      return res.json() as Promise<ProfileUser>;
    },
    onSuccess: (updated) => {
      setProfileImage(updated.image_url || null);
      toast.success("Profile image updated");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to upload profile image");
    },
  });

  useEffect(() => {
    setUsername(user?.username ?? "");
    setEmail(user?.email ?? "");
    setProfileImage(user?.image_url || null);
  }, [user]);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!currentPassword) {
      toast.error("Current password is required");
      return;
    }
    const data: Record<string, string | undefined> = {
      current_password: currentPassword,
    };
    if (username !== user?.username) data.username = username;
    if (email !== user?.email) data.email = email;
    if (newPassword) data.new_password = newPassword;

    updateMutation.mutate(data);
  }

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        toast.error("Please drop an image file");
        return;
      }
      uploadImageMutation.mutate(file);
    },
    [uploadImageMutation]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) uploadImageMutation.mutate(file);
      e.target.value = "";
    },
    [uploadImageMutation]
  );

  function handleSignOut() {
    logout();
    navigate("/login", { replace: true });
  }

  function openStatsRankings() {
    const params = new URLSearchParams();
    params.set("start", toDateInputValue(statsRange.start));
    params.set("end", toDateInputValue(statsRange.end));
    params.set("artist_metric", topArtistMetric);
    params.set("video_metric", topVideoMetric);
    navigate(`/profile/stats-rankings?${params.toString()}`);
  }

  return (
    <PageTransition>
      <div className="mx-auto max-w-6xl space-y-10">
        {/* Profile header */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="flex items-center justify-between gap-4 pt-6 sm:pt-10"
        >
          <div className="flex flex-col items-center gap-6 text-center sm:flex-row sm:text-left">
            <div
              className={`group relative flex h-28 w-28 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full ring-4 transition-all sm:h-32 sm:w-32 ${
                dragOver
                  ? "bg-primary/10 ring-primary"
                  : "bg-gradient-to-br from-primary/30 to-primary/5 ring-white/10 hover:ring-primary/50"
              } shadow-[0_20px_60px_-15px_hsl(var(--primary)/0.4)]`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => document.getElementById("profile-image-input")?.click()}
              title="Drag & drop or click to update profile image"
            >
              {profileImage ? (
                <img
                  src={profileImage}
                  alt={user?.username || "Profile"}
                  className={`h-full w-full object-cover transition-opacity ${
                    dragOver || uploadImageMutation.isPending ? "opacity-40" : ""
                  }`}
                />
              ) : (
                <User className={`h-12 w-12 text-primary ${dragOver || uploadImageMutation.isPending ? "opacity-40" : ""}`} />
              )}
              <div
                className={`absolute inset-0 flex flex-col items-center justify-center bg-black/50 backdrop-blur-sm transition-opacity ${
                  dragOver || uploadImageMutation.isPending ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                }`}
              >
                <Upload className="h-5 w-5 text-primary" />
                <span className="mt-1 text-[10px] font-medium text-foreground">
                  {uploadImageMutation.isPending ? "Uploading..." : "Change"}
                </span>
              </div>
              <input
                id="profile-image-input"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileSelect}
              />
            </div>
            <div>
              <p className="eyebrow mb-2">Your profile</p>
              <div className="flex items-center justify-center gap-2 sm:justify-start">
                <h1 className="display text-5xl leading-none text-foreground sm:text-6xl">{user?.username}</h1>
                <button
                  type="button"
                  onClick={() => setEditOpen(true)}
                  className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
                  aria-label="Edit profile"
                  title="Edit profile"
                >
                  <Pencil className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{user?.email}</p>
              <div className="mt-2 flex items-center justify-center gap-3 text-xs text-muted-foreground sm:justify-start">
                <span className="flex items-center gap-1 capitalize">
                  <Shield className="h-3 w-3" />
                  {user?.role}
                </span>
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  Member since {user?.created_at ? new Date(user.created_at).toLocaleDateString() : ""}
                </span>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="mt-4"
                onClick={handleSignOut}
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign out
              </Button>
            </div>
          </div>
        </motion.div>

        <Tabs value={profileTab} onValueChange={setProfileTab} className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabsList>
              <TabsTrigger value="stats">Stats</TabsTrigger>
              <TabsTrigger value="history">Playback History</TabsTrigger>
            </TabsList>
            {profileTab === "stats" && (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <Label className="text-xs text-muted-foreground">Range</Label>
                  <Select value={statsPreset} onValueChange={(value) => setStatsPreset(value as StatsRangePreset)}>
                    <SelectTrigger className="h-9 w-[150px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="7d">Last 7 days</SelectItem>
                      <SelectItem value="30d">Last 30 days</SelectItem>
                      <SelectItem value="90d">Last 90 days</SelectItem>
                      <SelectItem value="custom">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-1.5">
                  <Label className="text-xs text-muted-foreground">View</Label>
                  <Select
                    value={statsGranularity}
                    onValueChange={(value) => setStatsGranularity(value as StatsGranularity)}
                  >
                    <SelectTrigger className="h-9 w-[120px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>

          <TabsContent value="stats" className="space-y-4">
            {statsPreset === "custom" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Start Date</Label>
                  <Input type="date" value={statsStart} onChange={(e) => setStatsStart(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">End Date</Label>
                  <Input type="date" value={statsEnd} onChange={(e) => setStatsEnd(e.target.value)} />
                </div>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Showing {shortDate(statsRange.start)} to {shortDate(statsRange.end)}
            </p>

            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <div className="surface group relative overflow-hidden p-5 transition-colors hover:border-white/10">
                <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-primary/10 blur-2xl" />
                <p className="eyebrow">Music Videos in Library</p>
                <div className="mt-3 flex items-center gap-2">
                  <Film className="h-4 w-4 text-primary" />
                  <p className="display text-4xl leading-none text-foreground">{libraryTotal?.total ?? 0}</p>
                </div>
              </div>
              <div className="surface group relative overflow-hidden p-5 transition-colors hover:border-white/10">
                <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-primary/10 blur-2xl" />
                <p className="eyebrow">Total Watch Time</p>
                <div className="mt-3 flex items-center gap-2">
                  <Clock3 className="h-4 w-4 text-primary" />
                  <p className="display text-4xl leading-none text-foreground">{formatWatchTime(totalWatchSeconds)}</p>
                </div>
              </div>
              <div className="surface group relative overflow-hidden p-5 transition-colors hover:border-white/10">
                <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-primary/10 blur-2xl" />
                <p className="eyebrow">Number of Views</p>
                <div className="mt-3 flex items-center gap-2">
                  <PlayCircle className="h-4 w-4 text-primary" />
                  <p className="display text-4xl leading-none text-foreground">{totalViews}</p>
                </div>
              </div>
              <div className="surface group relative overflow-hidden p-5 transition-colors hover:border-white/10">
                <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-primary/10 blur-2xl" />
                <p className="eyebrow">Top Artist</p>
                <div className="mt-3 flex items-center gap-2">
                  <Radio className="h-4 w-4 text-primary" />
                  <p className="truncate text-base font-medium text-foreground">
                    {topArtists[0]
                      ? topArtistMetric === "views"
                        ? `${topArtists[0].name} (${formatViewCount(topArtists[0].views)})`
                        : `${topArtists[0].name} (${formatWatchTime(topArtists[0].watch_seconds)})`
                      : "No data"}
                  </p>
                </div>
              </div>
              <div className="surface group relative overflow-hidden p-5 transition-colors hover:border-white/10">
                <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-primary/10 blur-2xl" />
                <p className="eyebrow">Top Music Video</p>
                <div className="mt-3 flex items-center gap-2">
                  <Music2 className="h-4 w-4 text-primary" />
                  <p className="truncate text-base font-medium text-foreground">
                    {topVideos[0]
                      ? topVideoMetric === "views"
                        ? `${topVideos[0].title} (${formatViewCount(topVideos[0].views)})`
                        : `${topVideos[0].title} (${formatWatchTime(topVideos[0].watch_seconds)})`
                      : "No data"}
                  </p>
                </div>
              </div>
            </section>

            <section className="grid gap-3 lg:grid-cols-2">
              <div className="surface p-5 sm:p-6">
                <h3 className="display mb-4 text-2xl text-foreground">
                  Views Trend ({statsGranularity === "daily" ? "Daily" : "Weekly"})
                </h3>
                <ChartContainer config={playsChartConfig} className="h-[240px] w-full">
                  <BarChart accessibilityLayer data={trendData}>
                    <CartesianGrid vertical={false} strokeOpacity={0.08} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={16} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="views" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              </div>
              <div className="surface p-5 sm:p-6">
                <h3 className="display mb-4 text-2xl text-foreground">
                  Watch Time Trend ({statsGranularity === "daily" ? "Daily" : "Weekly"})
                </h3>
                <ChartContainer config={watchChartConfig} className="h-[240px] w-full">
                  <BarChart accessibilityLayer data={trendData}>
                    <CartesianGrid vertical={false} strokeOpacity={0.08} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={16} />
                    <YAxis tickLine={false} axisLine={false} width={36} />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          formatter={(value) => [`${value} min`, "Watch Minutes"]}
                        />
                      }
                    />
                    <Bar dataKey="watch_minutes" fill="hsl(var(--primary) / 0.65)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              </div>
            </section>

            <section className="grid gap-3 lg:grid-cols-2">
              <div className="surface p-5 sm:p-6">
                <div className="mb-4 flex items-center justify-between gap-2">
                  <h3 className="display text-2xl text-foreground">Top artists</h3>
                  <div className="flex items-center gap-2">
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
                    <Button variant="ghost" size="sm" onClick={openStatsRankings}>
                      See more
                    </Button>
                  </div>
                </div>
                {topArtists.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {topArtistMetric === "views" && statsHistory.length > 0
                      ? "No views in selected range. Expand date range or switch to Watch Minutes."
                      : "No playback data for this range."}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {topArtists.map((artist, index) => (
                      <div
                        key={artist.id}
                        className="group flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/[0.05]"
                        onClick={() => navigate(`/artist/${artist.id}`)}
                      >
                        <div className="h-11 w-11 shrink-0 overflow-hidden rounded-full bg-secondary ring-1 ring-white/10">
                          {topArtistImageMap.get(artist.id) ? (
                            <img
                              src={topArtistImageMap.get(artist.id) || ""}
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
                  <h3 className="display text-2xl text-foreground">Top music videos</h3>
                  <div className="flex items-center gap-2">
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
                    <Button variant="ghost" size="sm" onClick={openStatsRankings}>
                      See more
                    </Button>
                  </div>
                </div>
                {topVideos.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {topVideoMetric === "views" && statsHistory.length > 0
                      ? "No views in selected range. Expand date range or switch to Watch Minutes."
                      : "No playback data for this range."}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {topVideos.map((video, index) => (
                      <div
                        key={video.id}
                        className="group flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/[0.05]"
                        onClick={() => navigate(`/video/${video.id}`)}
                      >
                        <div className="h-12 w-20 shrink-0 overflow-hidden rounded-lg bg-secondary">
                          {topVideoThumbMap.get(video.id) ? (
                            <img
                              src={topVideoThumbMap.get(video.id) || ""}
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
                          <p className="truncate text-xs text-muted-foreground">{video.artist_name}</p>
                          <p className="text-xs text-muted-foreground">
                            {topVideoMetric === "views"
                              ? formatViewCount(video.views)
                              : formatWatchTime(video.watch_seconds)}
                          </p>
                        </div>
                        <p className="display w-8 text-right text-2xl text-muted-foreground/60 transition-colors group-hover:text-primary">{index + 1}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </TabsContent>

          <TabsContent value="history">
            <section className="surface space-y-4 p-5 sm:p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="display text-3xl text-foreground">Playback history</h2>
                  <p className="text-xs text-muted-foreground">
                    Records every playback session. Views are tracked separately when watch time reaches {viewThresholdPercent}% of a video.
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">{filteredPlaybackHistory.length} records</p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Input
                  value={historyTitleFilter}
                  onChange={(e) => setHistoryTitleFilter(e.target.value)}
                  placeholder="Filter by music video title..."
                />
                <Select value={historyArtistFilter} onValueChange={setHistoryArtistFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Filter by artist" />
                  </SelectTrigger>
                  <SelectContent>
                    <div className="sticky top-0 z-10 border-b border-white/10 bg-popover p-2">
                      <Input
                        value={historyArtistSearch}
                        onChange={(e) => setHistoryArtistSearch(e.target.value)}
                        onKeyDown={(e) => e.stopPropagation()}
                        placeholder="Search artist..."
                        className="h-8"
                      />
                    </div>
                    <SelectItem value="all">All artists</SelectItem>
                    {searchedHistoryArtists.map((artist) => (
                      <SelectItem key={artist.id} value={artist.id}>
                        {artist.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="date"
                  value={historyStartDate}
                  onChange={(e) => setHistoryStartDate(e.target.value)}
                  placeholder="Start date"
                />
                <Input
                  type="date"
                  value={historyEndDate}
                  onChange={(e) => setHistoryEndDate(e.target.value)}
                  placeholder="End date"
                />
              </div>
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setHistoryStartDate("");
                    setHistoryEndDate("");
                  }}
                >
                  Clear Date Filter
                </Button>
              </div>

              {playbackHistoryLoading ? (
                <p className="text-sm text-muted-foreground">Loading playback history...</p>
              ) : filteredPlaybackHistory.length === 0 ? (
                <p className="text-sm text-muted-foreground">No playback history found.</p>
              ) : (
                <div className="max-h-[52vh] space-y-2 overflow-y-auto pr-1">
                  {filteredPlaybackHistory.map((entry) => (
                    <div key={entry.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 transition-colors hover:bg-white/[0.04]">
                      <p className="text-sm font-medium text-foreground">{entry.video_title}</p>
                      <p className="text-xs text-muted-foreground">{entry.artist_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {entry.counted_play ? "Counts as a view" : "History only"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatWatched(entry.watched_seconds)} watched · {new Date(entry.played_at).toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Profile</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">New Password (optional)</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Leave blank to keep current"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="current-password">Current Password (required)</Label>
              <Input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Confirm with your current password"
              />
            </div>
            <Button type="submit" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </PageTransition>
  );
}
