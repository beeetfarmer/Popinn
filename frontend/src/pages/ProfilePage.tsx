import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { User, ListVideo, Shield, Calendar } from "lucide-react";
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

export default function ProfilePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

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

  return (
    <PageTransition>
      <div className="mx-auto max-w-2xl space-y-8">
        {/* Profile header */}
        <div className="flex items-center gap-4">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/20">
            <User className="h-10 w-10 text-primary" />
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
