import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { MusicVideo } from "@/data/mockData";
import VideoCard from "@/components/VideoCard";
import PageTransition from "@/components/PageTransition";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

const PER_PAGE = 12;

export default function MusicVideosPage() {
  const [page, setPage] = useState(1);

  const { data: videos = [] } = useQuery<MusicVideo[]>({
    queryKey: ["videos"],
    queryFn: () => api.get("/videos/"),
  });

  const totalPages = Math.ceil(videos.length / PER_PAGE);

  const visible = useMemo(
    () => videos.slice((page - 1) * PER_PAGE, page * PER_PAGE),
    [videos, page]
  );

  return (
    <PageTransition>
    <div>
      <h1 className="mb-6 text-2xl font-bold text-foreground">Music Videos</h1>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {visible.map((v) => (
          <VideoCard key={v.id} video={v} />
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page === totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
    </PageTransition>
  );
}
