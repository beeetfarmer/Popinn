import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient, useQueries } from "@tanstack/react-query";
import { User, Shield, Calendar, Upload, Pencil, Clock3, PlayCircle, Music2, Radio } from "lucide-react";
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
import { toast } from "sonner";

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

type StatsRangePreset = "7d" | "30d" | "90d" | "custom";
type StatsGranularity = "daily" | "weekly";
type TopArtistMetric = "counted_plays" | "minutes";

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
  plays: { label: "Plays", color: "hsl(var(--primary))" },
} satisfies ChartConfig;

const watchChartConfig = {
  watch_minutes: { label: "Watch Minutes", color: "#22c55e" },
} satisfies ChartConfig;

const rankingChartConfig = {
  plays: { label: "Plays", color: "#3b82f6" },
} satisfies ChartConfig;

export default function ProfilePage() {
  const { user } = useAuth();
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
  const [statsPreset, setStatsPreset] = useState<StatsRangePreset>("30d");
  const [statsGranularity, setStatsGranularity] = useState<StatsGranularity>("daily");
  const [topArtistMetric, setTopArtistMetric] = useState<TopArtistMetric>("counted_plays");
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
      { key: string; label: string; bucketDate: Date; plays: number; watch_seconds: number }
    >();

    let cursor = statsGranularity === "daily" ? startOfDay(statsRange.start) : getWeekStart(statsRange.start);
    const rangeEnd = endOfDay(statsRange.end);
    const stepDays = statsGranularity === "daily" ? 1 : 7;

    while (cursor <= rangeEnd) {
      const key = toDateInputValue(cursor);
      const label = statsGranularity === "daily" ? shortDate(cursor) : `Wk ${shortDate(cursor)}`;
      bucketMap.set(key, { key, label, bucketDate: new Date(cursor), plays: 0, watch_seconds: 0 });
      cursor = addDays(cursor, stepDays);
    }

    statsHistory.forEach((entry) => {
      const bucketDate = statsGranularity === "daily" ? startOfDay(entry.playedAt) : getWeekStart(entry.playedAt);
      const key = toDateInputValue(bucketDate);
      const existing = bucketMap.get(key);
      if (!existing) return;
      existing.plays += 1;
      existing.watch_seconds += entry.watched_seconds;
    });

    return Array.from(bucketMap.values())
      .sort((a, b) => a.bucketDate.getTime() - b.bucketDate.getTime())
      .map((bucket) => ({
        label: bucket.label,
        plays: bucket.plays,
        watch_minutes: Number((bucket.watch_seconds / 60).toFixed(1)),
      }));
  }, [statsHistory, statsGranularity, statsRange]);

  const topArtists = useMemo(() => {
    const map = new Map<string, { id: string; name: string; counted_plays: number; watch_seconds: number }>();
    statsHistory.forEach((entry) => {
      const existing = map.get(entry.artist_id);
      if (existing) {
        existing.counted_plays += entry.counted_play ? 1 : 0;
        existing.watch_seconds += entry.watched_seconds;
      } else {
        map.set(entry.artist_id, {
          id: entry.artist_id,
          name: entry.artist_name,
          counted_plays: entry.counted_play ? 1 : 0,
          watch_seconds: entry.watched_seconds,
        });
      }
    });
    const artists = Array.from(map.values());
    const ranked = artists
      .filter((artist) =>
        topArtistMetric === "counted_plays"
          ? artist.counted_plays > 0
          : artist.watch_seconds > 0
      )
      .sort((a, b) =>
        topArtistMetric === "counted_plays"
          ? b.counted_plays - a.counted_plays || b.watch_seconds - a.watch_seconds
          : b.watch_seconds - a.watch_seconds || b.counted_plays - a.counted_plays
      );
    return ranked.slice(0, 6);
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
    const map = new Map<string, { title: string; plays: number; watch_seconds: number }>();
    statsHistory.forEach((entry) => {
      const existing = map.get(entry.video_id);
      if (existing) {
        existing.plays += 1;
        existing.watch_seconds += entry.watched_seconds;
      } else {
        map.set(entry.video_id, {
          title: entry.video_title,
          plays: 1,
          watch_seconds: entry.watched_seconds,
        });
      }
    });
    return Array.from(map.values())
      .sort((a, b) => b.plays - a.plays || b.watch_seconds - a.watch_seconds)
      .slice(0, 6);
  }, [statsHistory]);

  const topVideoChartData = useMemo(
    () => topVideos.map((video) => ({ label: video.title, plays: video.plays })),
    [topVideos]
  );

  const totalWatchSeconds = useMemo(
    () => statsHistory.reduce((sum, item) => sum + item.watched_seconds, 0),
    [statsHistory]
  );

  const totalPlays = statsHistory.length;

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
    onError: (err: any) => {
      toast.error(err.message || "Failed to update profile");
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

  return (
    <PageTransition>
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Profile header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div
              className={`relative flex h-24 w-24 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 transition-colors ${
                dragOver
                  ? "border-primary bg-primary/10"
                  : "border-border bg-primary/20 hover:border-primary/70"
              }`}
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
                className={`absolute inset-0 flex flex-col items-center justify-center transition-opacity ${
                  dragOver || uploadImageMutation.isPending ? "opacity-100" : "opacity-0 hover:opacity-100"
                }`}
              >
                <div className="rounded-full bg-background/80 p-1.5">
                  <Upload className="h-4 w-4 text-primary" />
                </div>
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
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-foreground">{user?.username}</h1>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 px-2"
                  onClick={() => setEditOpen(true)}
                >
                  <Pencil className="mr-1 h-3.5 w-3.5" />
                  Edit
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">{user?.email}</p>
              <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Shield className="h-3 w-3" />
                  {user?.role}
                </span>
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  Member since {user?.created_at ? new Date(user.created_at).toLocaleDateString() : ""}
                </span>
              </div>
            </div>
          </div>
        </div>

        <Tabs defaultValue="stats" className="space-y-4">
          <TabsList>
            <TabsTrigger value="stats">Stats</TabsTrigger>
            <TabsTrigger value="history">Playback History</TabsTrigger>
          </TabsList>

          <TabsContent value="stats" className="space-y-4">
            <section className="rounded-xl border border-border bg-card p-4">
              <div className="grid gap-3 md:grid-cols-4">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Range</Label>
                  <Select value={statsPreset} onValueChange={(value) => setStatsPreset(value as StatsRangePreset)}>
                    <SelectTrigger>
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
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">View</Label>
                  <Select
                    value={statsGranularity}
                    onValueChange={(value) => setStatsGranularity(value as StatsGranularity)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {statsPreset === "custom" && (
                  <>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Start Date</Label>
                      <Input
                        type="date"
                        value={statsStart}
                        onChange={(e) => setStatsStart(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">End Date</Label>
                      <Input
                        type="date"
                        value={statsEnd}
                        onChange={(e) => setStatsEnd(e.target.value)}
                      />
                    </div>
                  </>
                )}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Showing {shortDate(statsRange.start)} to {shortDate(statsRange.end)}
              </p>
            </section>

            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-xs text-muted-foreground">Total Watch Time</p>
                <div className="mt-2 flex items-center gap-2">
                  <Clock3 className="h-4 w-4 text-primary" />
                  <p className="text-lg font-semibold text-foreground">{formatWatchTime(totalWatchSeconds)}</p>
                </div>
              </div>
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-xs text-muted-foreground">Number of Plays</p>
                <div className="mt-2 flex items-center gap-2">
                  <PlayCircle className="h-4 w-4 text-primary" />
                  <p className="text-lg font-semibold text-foreground">{totalPlays}</p>
                </div>
              </div>
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-xs text-muted-foreground">Top Artist</p>
                <div className="mt-2 flex items-center gap-2">
                  <Radio className="h-4 w-4 text-primary" />
                  <p className="truncate text-sm font-semibold text-foreground">
                    {topArtists[0]
                      ? topArtistMetric === "counted_plays"
                        ? `${topArtists[0].name} (${topArtists[0].counted_plays} counted plays)`
                        : `${topArtists[0].name} (${formatWatchTime(topArtists[0].watch_seconds)})`
                      : "No data"}
                  </p>
                </div>
              </div>
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-xs text-muted-foreground">Top Music Video</p>
                <div className="mt-2 flex items-center gap-2">
                  <Music2 className="h-4 w-4 text-primary" />
                  <p className="truncate text-sm font-semibold text-foreground">
                    {topVideos[0] ? `${topVideos[0].title} (${topVideos[0].plays})` : "No data"}
                  </p>
                </div>
              </div>
            </section>

            <section className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-xl border border-border bg-card p-4">
                <h3 className="mb-2 text-sm font-semibold text-foreground">
                  Plays Trend ({statsGranularity === "daily" ? "Daily" : "Weekly"})
                </h3>
                <ChartContainer config={playsChartConfig} className="h-[240px] w-full">
                  <BarChart accessibilityLayer data={trendData}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={16} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="plays" fill="var(--color-plays)" radius={4} />
                  </BarChart>
                </ChartContainer>
              </div>
              <div className="rounded-xl border border-border bg-card p-4">
                <h3 className="mb-2 text-sm font-semibold text-foreground">
                  Watch Time Trend ({statsGranularity === "daily" ? "Daily" : "Weekly"})
                </h3>
                <ChartContainer config={watchChartConfig} className="h-[240px] w-full">
                  <BarChart accessibilityLayer data={trendData}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={16} />
                    <YAxis tickLine={false} axisLine={false} width={36} />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          formatter={(value) => [`${value} min`, "Watch Minutes"]}
                        />
                      }
                    />
                    <Bar dataKey="watch_minutes" fill="#22c55e" radius={4} />
                  </BarChart>
                </ChartContainer>
              </div>
            </section>

            <section className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-foreground">Top Artists</h3>
                  <Select
                    value={topArtistMetric}
                    onValueChange={(value) => setTopArtistMetric(value as TopArtistMetric)}
                  >
                    <SelectTrigger className="h-8 w-[170px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="counted_plays">Counted Plays</SelectItem>
                      <SelectItem value="minutes">Watch Minutes</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {topArtists.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {topArtistMetric === "counted_plays" && statsHistory.length > 0
                      ? "No counted plays in selected range. Expand date range or switch to Watch Minutes."
                      : "No playback data for this range."}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {topArtists.map((artist, index) => (
                      <div
                        key={artist.id}
                        className="flex cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2 transition-colors hover:border-primary/35 hover:bg-secondary/20"
                        onClick={() => navigate(`/artist/${artist.id}`)}
                      >
                        <div className="h-10 w-10 overflow-hidden rounded-full bg-secondary">
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
                            {topArtistMetric === "counted_plays"
                              ? `${artist.counted_plays} counted play${artist.counted_plays !== 1 ? "s" : ""}`
                              : formatWatchTime(artist.watch_seconds)}
                          </p>
                        </div>
                        <p className="text-xs font-medium text-muted-foreground">#{index + 1}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="rounded-xl border border-border bg-card p-4">
                <h3 className="mb-2 text-sm font-semibold text-foreground">Top Music Videos</h3>
                {topVideoChartData.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No playback data for this range.</p>
                ) : (
                  <ChartContainer config={rankingChartConfig} className="h-[240px] w-full">
                    <BarChart accessibilityLayer data={topVideoChartData} layout="vertical" margin={{ left: 8 }}>
                      <CartesianGrid horizontal={false} />
                      <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
                      <YAxis
                        dataKey="label"
                        type="category"
                        tickLine={false}
                        axisLine={false}
                        width={120}
                        tickFormatter={(value) => String(value).slice(0, 18)}
                      />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="plays" fill="#3b82f6" radius={4} />
                    </BarChart>
                  </ChartContainer>
                )}
              </div>
            </section>
          </TabsContent>

          <TabsContent value="history">
            <section className="space-y-3 rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-foreground">Playback History</h2>
                  <p className="text-xs text-muted-foreground">
                    Filter by video title, artist, and date range.
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
                    <div className="sticky top-0 z-10 border-b border-border bg-popover p-2">
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
                    <div key={entry.id} className="rounded-md border border-border px-3 py-2">
                      <p className="text-sm font-medium text-foreground">{entry.video_title}</p>
                      <p className="text-xs text-muted-foreground">{entry.artist_name}</p>
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
