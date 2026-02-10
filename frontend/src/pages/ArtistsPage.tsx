import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Artist } from "@/data/mockData";
import ArtistCard from "@/components/ArtistCard";
import PageTransition from "@/components/PageTransition";

export default function ArtistsPage() {
  const { data: artists = [] } = useQuery<Artist[]>({
    queryKey: ["artists"],
    queryFn: () => api.get("/artists/"),
  });

  return (
    <PageTransition>
    <div>
      <h1 className="mb-6 text-2xl font-bold text-foreground">Artists</h1>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
        {artists.map((a) => (
          <ArtistCard key={a.id} artist={a} />
        ))}
      </div>
    </div>
    </PageTransition>
  );
}
