import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { MusicVideo, Artist } from "@/data/mockData";
import VideoCard from "@/components/VideoCard";
import ArtistCard from "@/components/ArtistCard";
import SectionHeader from "@/components/SectionHeader";
import HeroCarousel from "@/components/HeroCarousel";
import PageTransition from "@/components/PageTransition";

export default function Index() {
  const { data: videos = [], isLoading: videosLoading, isError: videosError } = useQuery<MusicVideo[]>({
    queryKey: ["videos"],
    queryFn: () => api.get("/videos/?limit=200"),
  });

  const { data: artists = [], isLoading: artistsLoading, isError: artistsError } = useQuery<Artist[]>({
    queryKey: ["artists"],
    queryFn: () => api.get("/artists/?limit=200"),
  });

  const recentVideos = useMemo(() => videos.slice(0, 6), [videos]);
  const recentArtists = useMemo(() => {
    const artistsById = new Map(artists.map((artist) => [artist.id, artist]));
    const seen = new Set<string>();
    const recent: Artist[] = [];

    for (const video of videos) {
      if (seen.has(video.artist_id)) continue;
      const artist = artistsById.get(video.artist_id);
      if (!artist) continue;
      seen.add(video.artist_id);
      recent.push(artist);
      if (recent.length >= 6) break;
    }

    if (recent.length >= 6) return recent;

    for (const artist of artists) {
      if (seen.has(artist.id)) continue;
      recent.push(artist);
      if (recent.length >= 6) break;
    }

    return recent;
  }, [artists, videos]);
  const randomVideos = useMemo(() => {
    if (videos.length <= 6) return [...videos].sort(() => Math.random() - 0.5);
    const shuffled = [...videos].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 6);
  }, [videos]);

  return (
    <PageTransition>
      <div className="space-y-10">
        {(videosLoading || artistsLoading) && (
          <p className="text-center text-muted-foreground">Loading library...</p>
        )}
        {(videosError || artistsError) && (
          <p className="text-center text-destructive">Some content failed to load</p>
        )}

        {/* Hero Carousel */}
        <HeroCarousel videos={videos} />

        {/* Recently Added Videos */}
        <section>
          <SectionHeader title="Recently Added Videos" linkTo="/videos" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {recentVideos.map((v) => (
              <VideoCard key={v.id} video={v} />
            ))}
          </div>
        </section>

        {/* Recently Added Artists */}
        <section>
          <SectionHeader title="Recently Added Artists" linkTo="/artists" />
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
            {recentArtists.map((a) => (
              <ArtistCard key={a.id} artist={a} />
            ))}
          </div>
        </section>

        {/* Random Picks */}
        {randomVideos.length > 0 && (
          <section>
            <SectionHeader title="Random Picks" />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {randomVideos.map((v) => (
                <VideoCard key={v.id} video={v} />
              ))}
            </div>
          </section>
        )}
      </div>
    </PageTransition>
  );
}
