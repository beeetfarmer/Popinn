import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { MusicVideo } from "@/data/mockData";
import VideoCard from "@/components/VideoCard";
import PageTransition from "@/components/PageTransition";
import { Skeleton } from "@/components/ui/skeleton";
import { VideoGridSkeleton } from "@/components/Skeletons";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  const [deleteWatchlistOpen, setDeleteWatchlistOpen] = useState(false);

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
      setDeleteWatchlistOpen(false);
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
    return (
      <div className="space-y-10 pt-8">
        <Skeleton className="h-14 w-72 rounded-xl" />
        <VideoGridSkeleton count={10} />
      </div>
    );
  }

  if (!watchlist) {
    return <p className="py-24 text-center text-muted-foreground">Watchlist not found</p>;
  }

  const backdrop = watchlist.videos[0]?.thumbnail_url;

  return (
    <PageTransition>
      <div className="space-y-10">
        <section className="relative -mt-4 ml-[calc(50%-50vw)] mr-[calc(50%-50vw)] overflow-hidden sm:-mt-6">
          {backdrop && (
            <img
              src={backdrop}
              alt=""
              aria-hidden
              className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-3xl"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/70 to-background" />
          <div className="relative mx-auto max-w-[1800px] px-4 pb-10 pt-8 sm:px-8 sm:pt-12">
            <button
              onClick={() => navigate("/watchlists")}
              className="glass mb-8 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" /> Watchlists
            </button>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            >
              <p className="eyebrow mb-3">Watchlist</p>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="display text-5xl text-foreground sm:text-7xl">{watchlist.name}</h1>
                <div className="flex gap-1">
                  <button
                    onClick={() => {
                      setEditName(watchlist.name);
                      setEditOpen(true);
                    }}
                    className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
                    title="Rename watchlist"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => {
                      setDeleteWatchlistOpen(true);
                    }}
                    className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    title="Delete watchlist"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {watchlist.item_count} video{watchlist.item_count !== 1 ? "s" : ""}
              </p>
              <div className="mt-6 flex gap-2">
                <Button size="lg" onClick={() => startWatchlistQueue(false)}>
                  <Play className="h-4 w-4 fill-current" /> Play all
                </Button>
                <Button size="lg" variant="outline" onClick={() => startWatchlistQueue(true)}>
                  <Shuffle className="h-4 w-4" /> Shuffle
                </Button>
              </div>
            </motion.div>
          </div>
        </section>

        {watchlist.videos.length === 0 ? (
          <p className="py-16 text-center text-muted-foreground">
            No videos in this watchlist yet
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            {watchlist.videos.map((v) => (
              <div key={v.id} className="group/item relative">
                <VideoCard video={v} />
                <button
                  onClick={() => removeVideoMutation.mutate(v.id)}
                  className="absolute left-2 top-2 rounded-full bg-black/60 p-2 text-white/80 opacity-0 backdrop-blur-md transition-all hover:bg-destructive hover:text-destructive-foreground group-hover/item:opacity-100 [@media(hover:none)]:opacity-100"
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

      <AlertDialog open={deleteWatchlistOpen} onOpenChange={setDeleteWatchlistOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete watchlist?</AlertDialogTitle>
            <AlertDialogDescription>
              Delete "{watchlist.name}" watchlist. Videos in your library will not be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
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
