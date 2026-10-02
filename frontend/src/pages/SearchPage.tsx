import { useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { MAX_PAGE_SIZE, fetchVideoPage } from "@/lib/videos";
import type { MusicVideo, Artist } from "@/data/mockData";
import VideoCard from "@/components/VideoCard";
import ArtistCard from "@/components/ArtistCard";
import PageTransition from "@/components/PageTransition";
import Reveal from "@/components/Reveal";
import SectionHeader from "@/components/SectionHeader";
import { ArtistGridSkeleton, VideoGridSkeleton } from "@/components/Skeletons";
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
      <div className="space-y-12">
        <form onSubmit={handleSearch} className="pt-6 sm:pt-12">
          <p className="eyebrow mb-4 text-center">Search the library</p>
          <div className="group relative mx-auto max-w-2xl">
            <div className="absolute -inset-px rounded-full bg-gradient-to-r from-primary/40 via-primary/0 to-primary/40 opacity-0 blur transition-opacity duration-500 group-focus-within:opacity-100" />
            <Search className="absolute left-5 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
            <input
              type="text"
              autoFocus
              placeholder="Artists, songs, albums..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="glass relative h-14 w-full rounded-full pl-14 pr-5 text-lg text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
          </div>
        </form>

        {!q && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="display text-4xl text-foreground/90 sm:text-5xl">What are you in the mood for?</p>
            <p className="mt-3 text-sm text-muted-foreground">Search for your favorite artists and videos</p>
          </div>
        )}

        {isLoading && (
          <div className="space-y-10">
            <ArtistGridSkeleton count={8} />
            <VideoGridSkeleton count={10} />
          </div>
        )}

        {noResults && q && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="display text-4xl text-foreground">No results found</p>
            <p className="mt-2 text-sm text-muted-foreground">Try a different search term</p>
          </div>
        )}

        {q && !isLoading && (artists.length > 0 || videos.length > 0) && (
          <p className="text-sm text-muted-foreground">
            Results for <span className="text-foreground">&ldquo;{q}&rdquo;</span>
          </p>
        )}

        {artists.length > 0 && (
          <Reveal>
            <section>
              <SectionHeader title="Artists" eyebrow={`${artists.length} found`} />
              <div className="grid grid-cols-3 gap-x-4 gap-y-8 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
                {artists.map((a) => (
                  <ArtistCard key={a.id} artist={a} />
                ))}
              </div>
            </section>
          </Reveal>
        )}

        {videos.length > 0 && (
          <Reveal delay={0.05}>
            <section>
              <SectionHeader title="Videos" eyebrow={`${videos.length} found`} />
              <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                {videos.map((v) => (
                  <VideoCard key={v.id} video={v} />
                ))}
              </div>
            </section>
          </Reveal>
        )}
      </div>
    </PageTransition>
  );
}
