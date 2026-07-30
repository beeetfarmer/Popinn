import { useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { MAX_PAGE_SIZE, fetchVideoPage } from "@/lib/videos";
import type { MusicVideo, Artist } from "@/data/mockData";
import VideoCard from "@/components/VideoCard";
import ArtistCard from "@/components/ArtistCard";
import PageTransition from "@/components/PageTransition";
import { Search } from "lucide-react";

export default function SearchPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const q = searchParams.get("q") || "";
  const [input, setInput] = useState(q);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (trimmed) {
      navigate(`/search?q=${encodeURIComponent(trimmed)}`);
    }
  }

  const { data: artists = [], isLoading: loadingArtists } = useQuery<Artist[]>({
    queryKey: ["search-artists", q],
    queryFn: () => api.get(`/artists/?search=${encodeURIComponent(q)}`),
    enabled: !!q,
  });

  const { data: videos = [], isLoading: loadingVideos } = useQuery<MusicVideo[]>({
    queryKey: ["search-videos", q],
    queryFn: async () =>
      (await fetchVideoPage({ search: q }, 0, MAX_PAGE_SIZE)).items,
    enabled: !!q,
  });

  const isLoading = loadingArtists || loadingVideos;
  const noResults = !isLoading && artists.length === 0 && videos.length === 0;

  return (
    <PageTransition>
      <div className="space-y-8">
        {/* Search input */}
        <form onSubmit={handleSearch}>
          <div className="relative mx-auto max-w-xl">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              autoFocus
              placeholder="Search artists & videos..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="h-12 w-full rounded-full border border-border bg-card pl-12 pr-4 text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </form>

        {!q && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Search className="mb-4 h-12 w-12 text-muted-foreground/50" />
            <p className="text-muted-foreground">
              Search for your favorite artists and videos
            </p>
          </div>
        )}

        {isLoading && (
          <p className="text-muted-foreground">Searching...</p>
        )}

        {noResults && q && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Search className="mb-4 h-12 w-12 text-muted-foreground/50" />
            <p className="text-lg font-medium text-foreground">No results found</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Try a different search term
            </p>
          </div>
        )}

        {q && !isLoading && (artists.length > 0 || videos.length > 0) && (
          <p className="text-sm text-muted-foreground">
            Showing results for &ldquo;{q}&rdquo;
          </p>
        )}

        {artists.length > 0 && (
          <section>
            <h2 className="mb-4 text-lg font-semibold text-foreground">
              Artists ({artists.length})
            </h2>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
              {artists.map((a) => (
                <ArtistCard key={a.id} artist={a} />
              ))}
            </div>
          </section>
        )}

        {videos.length > 0 && (
          <section>
            <h2 className="mb-4 text-lg font-semibold text-foreground">
              Videos ({videos.length})
            </h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {videos.map((v) => (
                <VideoCard key={v.id} video={v} />
              ))}
            </div>
          </section>
        )}
      </div>
    </PageTransition>
  );
}
