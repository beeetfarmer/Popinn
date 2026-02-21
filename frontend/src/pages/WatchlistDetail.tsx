import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { MusicVideo } from "@/data/mockData";
import VideoCard from "@/components/VideoCard";
import PageTransition from "@/components/PageTransition";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowLeft, Trash2, Pencil, Play, Shuffle } from "lucide-react";
import { toast } from "sonner";
import { useQueue } from "@/contexts/QueueContext";

interface WatchlistDetailData {
  id: string;
  name: string;
  item_count: number;
  created_at: string;
  videos: MusicVideo[];
}

export default function WatchlistDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { startQueue } = useQueue();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");

  const { data: watchlist, isLoading } = useQuery<WatchlistDetailData>({
    queryKey: ["watchlist", id],
    queryFn: () => api.get(`/watchlists/${id}`),
    enabled: !!id,
  });

  const removeVideoMutation = useMutation({
    mutationFn: (videoId: string) =>
      api.delete(`/watchlists/${id}/videos/${videoId}`),
    onMutate: async (videoId: string) => {
      await queryClient.cancelQueries({ queryKey: ["watchlist", id] });
      const previous = queryClient.getQueryData<WatchlistDetailData>(["watchlist", id]);
      if (previous) {
        queryClient.setQueryData<WatchlistDetailData>(["watchlist", id], {
          ...previous,
          videos: previous.videos.filter((v) => v.id !== videoId),
          item_count: Math.max(0, previous.item_count - 1),
        });
      }
      return { previous };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watchlist", id] });
      toast.success("Video removed");
    },
    onError: (_error, _videoId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["watchlist", id], context.previous);
      }
      toast.error("Failed to remove video");
    },
  });

  const renameMutation = useMutation({
    mutationFn: (name: string) => api.patch(`/watchlists/${id}`, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watchlist", id] });
      queryClient.invalidateQueries({ queryKey: ["watchlists"] });
      setEditOpen(false);
      toast.success("Watchlist renamed");
    },
    onError: () => toast.error("Failed to rename"),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/watchlists/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watchlists"] });
      toast.success("Watchlist deleted");
      navigate("/watchlists");
    },
    onError: () => toast.error("Failed to delete watchlist"),
  });

  function handleRename() {
    const name = editName.trim();
    if (!name) return;
    renameMutation.mutate(name);
  }

  function startWatchlistQueue(shuffleQueue: boolean) {
    if (!watchlist || watchlist.videos.length === 0) {
      toast.error("No videos in this watchlist");
      return;
    }
    const queue = shuffleQueue
      ? [...watchlist.videos].sort(() => Math.random() - 0.5)
      : watchlist.videos;
    startQueue(queue, { startIndex: 0 });
    navigate(`/video/${queue[0].id}`);
  }

  if (isLoading) {
    return <p className="text-muted-foreground">Loading...</p>;
  }

  if (!watchlist) {
    return <p className="text-muted-foreground">Watchlist not found</p>;
  }

  return (
    <PageTransition>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate("/watchlists")}
            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-foreground">{watchlist.name}</h1>
              <button
                onClick={() => {
                  setEditName(watchlist.name);
                  setEditOpen(true);
                }}
                className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                title="Rename watchlist"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                onClick={() => {
                  if (confirm(`Delete "${watchlist.name}"?`)) {
                    deleteMutation.mutate();
                  }
                }}
                className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                title="Delete watchlist"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground">
              {watchlist.item_count} video{watchlist.item_count !== 1 ? "s" : ""}
            </p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="outline" onClick={() => startWatchlistQueue(false)}>
                <Play className="mr-1 h-4 w-4" /> Play All
              </Button>
              <Button size="sm" variant="outline" onClick={() => startWatchlistQueue(true)}>
                <Shuffle className="mr-1 h-4 w-4" /> Shuffle
              </Button>
            </div>
          </div>
        </div>

        {watchlist.videos.length === 0 ? (
          <p className="py-12 text-center text-muted-foreground">
            No videos in this watchlist yet
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {watchlist.videos.map((v) => (
              <div key={v.id} className="relative">
                <VideoCard video={v} />
                <button
                  onClick={() => removeVideoMutation.mutate(v.id)}
                  className="absolute right-1 top-1 rounded-full bg-background/80 p-1.5 text-destructive opacity-0 transition-opacity hover:bg-destructive hover:text-destructive-foreground group-hover:opacity-100 [div:hover>&]:opacity-100"
                  title="Remove from watchlist"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Rename dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Watchlist</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleRename()}
              autoFocus
            />
            <Button
              onClick={handleRename}
              className="w-full"
              disabled={renameMutation.isPending || !editName.trim()}
            >
              {renameMutation.isPending ? "Saving..." : "Rename"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </PageTransition>
  );
}
