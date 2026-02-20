import { useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ArtistDetail as ArtistDetailType } from "@/data/mockData";
import VideoCard from "@/components/VideoCard";
import PageTransition from "@/components/PageTransition";
import { ArrowLeft, Upload, Pencil } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

const PER_PAGE = 10;

function getCookie(name: string): string | null {
  const match = document.cookie
    .split("; ")
    .find((part) => part.startsWith(`${name}=`));
  if (!match) return null;
  return decodeURIComponent(match.split("=")[1] || "");
}

export default function ArtistDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const queryClient = useQueryClient();
  const [dragOver, setDragOver] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editBio, setEditBio] = useState("");
  const [page, setPage] = useState(1);

  const { data: artist, isLoading, isError } = useQuery<ArtistDetailType>({
    queryKey: ["artist", id],
    queryFn: () => api.get(`/artists/${id}`),
    enabled: !!id,
  });

  const uploadImage = useMutation({
    mutationFn: async (file: File) => {
      if (!isAdmin) throw new Error("Admin access required");
      const formData = new FormData();
      formData.append("file", file);
      const csrf = getCookie("popinn_csrf_token");
      const res = await fetch(`/api/v1/artists/${id}/image`, {
        method: "PUT",
        headers: csrf ? { "X-CSRF-Token": csrf } : {},
        credentials: "include",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Upload failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["artist", id] });
      queryClient.invalidateQueries({ queryKey: ["artists"] });
      toast.success("Artist image updated");
    },
    onError: (err: any) => toast.error(err.message || "Failed to upload image"),
  });

  const editMutation = useMutation({
    mutationFn: () => {
      if (!isAdmin) throw new Error("Admin access required");
      const body: Record<string, unknown> = {};
      if (editName.trim() && editName.trim() !== artist?.name) body.name = editName.trim();
      if (editBio.trim() !== (artist?.bio || "")) body.bio = editBio.trim() || null;
      return api.patch(`/artists/${id}`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["artist", id] });
      queryClient.invalidateQueries({ queryKey: ["artists"] });
      setEditOpen(false);
      toast.success("Artist updated");
    },
    onError: (err: any) => toast.error(err.message || "Failed to update"),
  });

  function openEdit() {
    if (artist) {
      setEditName(artist.name);
      setEditBio(artist.bio || "");
      setEditOpen(true);
    }
  }

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith("image/")) {
        uploadImage.mutate(file);
      } else {
        toast.error("Please drop an image file");
      }
    },
    [uploadImage]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) uploadImage.mutate(file);
      e.target.value = "";
    },
    [uploadImage]
  );

  if (!artist) {
    if (isLoading) return <p className="text-muted-foreground">Loading artist...</p>;
    if (isError) return <p className="text-destructive">Failed to load artist</p>;
    return <p className="text-muted-foreground">Artist not found</p>;
  }

  const totalPages = Math.max(1, Math.ceil(artist.videos.length / PER_PAGE));
  const start = (page - 1) * PER_PAGE;
  const paginatedVideos = artist.videos.slice(start, start + PER_PAGE);

  return (
    <PageTransition>
      <div>
        <Link
          to="/artists"
          className="mb-6 inline-flex items-center gap-1 text-sm text-primary hover:text-primary/80"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Artists
        </Link>

        {/* Header */}
        <div className="mt-4 flex flex-col items-center gap-6 sm:flex-row sm:items-start">
          {/* Drag & drop image area */}
          <div
            className={`relative h-40 w-40 shrink-0 overflow-hidden rounded-full border-2 transition-colors cursor-pointer ${
              dragOver
                ? "border-primary bg-primary/10"
                : "border-primary hover:border-primary/70"
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              if (isAdmin) setDragOver(true);
            }}
            onDragLeave={() => isAdmin && setDragOver(false)}
            onDrop={isAdmin ? handleDrop : undefined}
            onClick={isAdmin ? () => document.getElementById("artist-image-input")?.click() : undefined}
            title={isAdmin ? "Drag & drop or click to change artist image" : "Artist image"}
          >
            <img
              src={artist.image_url || "/placeholder.svg"}
              alt={artist.name}
              className={`h-full w-full object-cover transition-opacity ${
                dragOver || uploadImage.isPending ? "opacity-40" : ""
              }`}
            />
            {isAdmin && (
              <>
                <div
                  className={`absolute inset-0 flex flex-col items-center justify-center transition-opacity ${
                    dragOver || uploadImage.isPending ? "opacity-100" : "opacity-0 hover:opacity-100"
                  }`}
                >
                  <div className="rounded-full bg-background/80 p-2">
                    <Upload className="h-5 w-5 text-primary" />
                  </div>
                  <span className="mt-1 text-xs font-medium text-foreground">
                    {uploadImage.isPending ? "Uploading..." : "Change Image"}
                  </span>
                </div>
                <input
                  id="artist-image-input"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileSelect}
                />
              </>
            )}
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-bold text-foreground">{artist.name}</h1>
              {isAdmin && (
                <button
                  onClick={openEdit}
                  className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  title="Edit artist"
                >
                  <Pencil className="h-4 w-4" />
                </button>
              )}
            </div>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
              {artist.bio}
            </p>
            <p className="mt-3 text-xs text-muted-foreground">
              {artist.videos.length} music video{artist.videos.length !== 1 && "s"}
            </p>
          </div>
        </div>

        {/* Videos */}
        <h2 className="mb-4 mt-10 text-xl font-bold text-foreground">Music Videos</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {paginatedVideos.map((v) => (
            <VideoCard key={v.id} video={v} />
          ))}
        </div>
        {artist.videos.length > PER_PAGE && (
          <div className="mt-6 flex items-center justify-center gap-3">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </Button>
          </div>
        )}
        {/* Edit dialog */}
        <Dialog open={editOpen && isAdmin} onOpenChange={setEditOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Artist</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">Name</label>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">Bio</label>
                <Textarea
                  value={editBio}
                  onChange={(e) => setEditBio(e.target.value)}
                  rows={4}
                  placeholder="Artist biography..."
                />
              </div>
              <Button
                onClick={() => editMutation.mutate()}
                className="w-full"
                disabled={editMutation.isPending || !editName.trim()}
              >
                {editMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </PageTransition>
  );
}
