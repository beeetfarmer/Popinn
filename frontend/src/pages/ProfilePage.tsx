import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { User, ListVideo, Shield, Calendar, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import PageTransition from "@/components/PageTransition";
import { toast } from "sonner";

interface WatchlistItem {
  id: string;
  name: string;
  item_count: number;
  created_at: string;
}

interface ProfileUser {
  id: string;
  username: string;
  email: string;
  image_url?: string | null;
  role: string;
  is_active: boolean;
  created_at: string;
}

function getCookie(name: string): string | null {
  const match = document.cookie
    .split("; ")
    .find((part) => part.startsWith(`${name}=`));
  if (!match) return null;
  return decodeURIComponent(match.split("=")[1] || "");
}

export default function ProfilePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [dragOver, setDragOver] = useState(false);
  const [profileImage, setProfileImage] = useState<string | null>(user?.image_url || null);

  const [username, setUsername] = useState(user?.username ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [newPassword, setNewPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");

  const { data: watchlists = [] } = useQuery<WatchlistItem[]>({
    queryKey: ["watchlists"],
    queryFn: () => api.get("/watchlists/"),
  });

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, string | undefined>) =>
      api.patch("/auth/me", data),
    onSuccess: () => {
      toast.success("Profile updated");
      setCurrentPassword("");
      setNewPassword("");
      queryClient.invalidateQueries({ queryKey: ["me"] });
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
      <div className="mx-auto max-w-2xl space-y-8">
        {/* Profile header */}
        <div className="flex items-center gap-4">
          <div
            className={`relative flex h-20 w-20 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 transition-colors ${
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
              <User className={`h-10 w-10 text-primary ${dragOver || uploadImageMutation.isPending ? "opacity-40" : ""}`} />
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
            <h1 className="text-2xl font-bold text-foreground">{user?.username}</h1>
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

        {/* Edit form */}
        <section className="space-y-4 rounded-xl border border-border bg-card p-6">
          <h2 className="text-lg font-semibold text-foreground">Edit Profile</h2>
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
        </section>

        {/* Watchlists */}
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-bold text-foreground">Your Watchlists</h2>
            <Button size="sm" variant="outline" onClick={() => navigate("/watchlists")}>
              View All
            </Button>
          </div>

          {watchlists.length === 0 ? (
            <p className="text-sm text-muted-foreground">No watchlists yet</p>
          ) : (
            <div className="space-y-3">
              {watchlists.slice(0, 5).map((wl) => (
                <div
                  key={wl.id}
                  className="flex items-center gap-4 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/30 cursor-pointer"
                  onClick={() => navigate(`/watchlists/${wl.id}`)}
                >
                  <ListVideo className="h-8 w-8 text-primary" />
                  <div className="flex-1">
                    <h3 className="font-semibold text-foreground">{wl.name}</h3>
                    <p className="text-xs text-muted-foreground">
                      {wl.item_count} video{wl.item_count !== 1 ? "s" : ""} · Created{" "}
                      {new Date(wl.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </PageTransition>
  );
}
