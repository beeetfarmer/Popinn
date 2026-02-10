import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ArtistDetail as ArtistDetailType } from "@/data/mockData";
import VideoCard from "@/components/VideoCard";
import PageTransition from "@/components/PageTransition";
import { ArrowLeft } from "lucide-react";

export default function ArtistDetail() {
  const { id } = useParams<{ id: string }>();

  const { data: artist } = useQuery<ArtistDetailType>({
    queryKey: ["artist", id],
    queryFn: () => api.get(`/artists/${id}`),
    enabled: !!id,
  });

  if (!artist) {
    return <p className="text-muted-foreground">Loading...</p>;
  }

  return (
    <PageTransition>
    <div>
      <Link to="/artists" className="mb-6 inline-flex items-center gap-1 text-sm text-primary hover:text-primary/80">
        <ArrowLeft className="h-4 w-4" /> Back to Artists
      </Link>

      {/* Header */}
      <div className="mt-4 flex flex-col items-center gap-6 sm:flex-row sm:items-start">
        <div className="h-40 w-40 shrink-0 overflow-hidden rounded-full border-2 border-primary">
          <img src={artist.image_url || "/placeholder.svg"} alt={artist.name} className="h-full w-full object-cover" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-foreground">{artist.name}</h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">{artist.bio}</p>
          <p className="mt-3 text-xs text-muted-foreground">{artist.videos.length} music video{artist.videos.length !== 1 && "s"}</p>
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
