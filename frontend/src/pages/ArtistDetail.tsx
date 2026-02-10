import { useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ArtistDetail as ArtistDetailType } from "@/data/mockData";
import VideoCard from "@/components/VideoCard";
import PageTransition from "@/components/PageTransition";
import { ArrowLeft, Upload } from "lucide-react";
import { toast } from "sonner";

export default function ArtistDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [dragOver, setDragOver] = useState(false);

  const { data: artist } = useQuery<ArtistDetailType>({
    queryKey: ["artist", id],
    queryFn: () => api.get(`/artists/${id}`),
    enabled: !!id,
  });

  const uploadImage = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const token = localStorage.getItem("access_token");
      const res = await fetch(`/api/v1/artists/${id}/image`, {
        method: "PUT",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
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
    return <p className="text-muted-foreground">Loading...</p>;
  }

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
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => document.getElementById("artist-image-input")?.click()}
            title="Drag & drop or click to change artist image"
          >
            <img
              src={artist.image_url || "/placeholder.svg"}
              alt={artist.name}
              className={`h-full w-full object-cover transition-opacity ${
                dragOver || uploadImage.isPending ? "opacity-40" : ""
              }`}
            />
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
          </div>

          <div>
            <h1 className="text-3xl font-bold text-foreground">{artist.name}</h1>
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
          {artist.videos.map((v) => (
            <VideoCard key={v.id} video={v} />
          ))}
        </div>
      </div>
    </PageTransition>
  );
}
