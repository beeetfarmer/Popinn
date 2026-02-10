import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
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
  errors: string | null;
  message?: string;
}

export default function SettingsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [autoScan, setAutoScan] = useState(true);
  const [notifications, setNotifications] = useState(true);
  const [autoplay, setAutoplay] = useState(false);

  // Scan state
  const [scanJobId, setScanJobId] = useState<string | null>(null);
  const [scanStatus, setScanStatus] = useState<ScanJob | null>(null);
  const [scanning, setScanning] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isAdmin = user?.role === "admin";

  const { data: users = [] } = useQuery<UserItem[]>({
    queryKey: ["admin-users"],
    queryFn: () => api.get("/auth/users"),
    enabled: isAdmin,
  });

  const deleteMutation = useMutation({
    mutationFn: (userId: string) => api.delete(`/auth/users/${userId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      toast.success("User deleted");
    },
    onError: (err: any) => toast.error(err.message || "Failed to delete user"),
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

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

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
    } catch (err: any) {
      setScanning(false);
      toast.error(err.message || "Failed to start scan");
    }
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

            <Button
              onClick={handleScan}
              disabled={scanning}
              className="w-full"
            >
              {scanning ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Scanning...
                </>
              ) : (
                "Scan Now"
              )}
            </Button>

            {/* Scan progress */}
            {scanning && (
              <div className="space-y-2">
                <div className="h-2 overflow-hidden rounded-full bg-secondary">
                  <div className="h-full animate-pulse rounded-full bg-primary" style={{ width: "100%" }} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {scanStatus?.status === "running"
                    ? "Scanning media directory..."
                    : "Starting scan..."}
                </p>
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
          </section>
        )}

        {/* Playback */}
        <section className="space-y-4 rounded-xl border border-border bg-card p-6">
          <h2 className="text-lg font-semibold text-foreground">Playback</h2>
          <div className="flex items-center justify-between">
            <Label htmlFor="autoplay">Autoplay next video</Label>
            <Switch id="autoplay" checked={autoplay} onCheckedChange={setAutoplay} />
          </div>
        </section>

        <Separator />

        {/* Notifications */}
        <section className="space-y-4 rounded-xl border border-border bg-card p-6">
          <h2 className="text-lg font-semibold text-foreground">Notifications</h2>
          <div className="flex items-center justify-between">
            <Label htmlFor="notif">Enable notifications</Label>
            <Switch id="notif" checked={notifications} onCheckedChange={setNotifications} />
          </div>
        </section>

        {/* Admin: User Management */}
        {isAdmin && (
          <>
            <Separator />
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
                          if (confirm(`Delete user "${u.username}"? This cannot be undone.`)) {
                            deleteMutation.mutate(u.id);
                          }
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
          </>
        )}
      </div>
    </PageTransition>
  );
}
