import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { MAX_PAGE_SIZE, fetchVideoPage } from "@/lib/videos";
import type { MusicVideo, Artist } from "@/data/mockData";
import VideoCard from "@/components/VideoCard";
import ArtistCard from "@/components/ArtistCard";
import SectionHeader from "@/components/SectionHeader";
import HeroCarousel from "@/components/HeroCarousel";
import PageTransition from "@/components/PageTransition";
import Reveal from "@/components/Reveal";
import { ArtistGridSkeleton, VideoGridSkeleton } from "@/components/Skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";

const RECENT_VIDEOS_CAROUSEL_LIMIT = 15;
const RECENT_ARTISTS_CAROUSEL_LIMIT = 12;
const RANDOM_PICKS_CAROUSEL_LIMIT = 15;

function toTimestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? 0 : ts;
}

export default function Index() {
  const [showAllRecentVideos, setShowAllRecentVideos] = useState(false);
  const [showAllRecentArtists, setShowAllRecentArtists] = useState(false);
  const { data: videos = [], isLoading: videosLoading, isError: videosError } = useQuery<MusicVideo[]>({
    queryKey: ["videos"],
    queryFn: async () => (await fetchVideoPage({}, 0, MAX_PAGE_SIZE)).items,
  });

  const { data: artists = [], isLoading: artistsLoading, isError: artistsError } = useQuery<Artist[]>({
    queryKey: ["artists"],
    queryFn: () => api.get("/artists/?limit=2000"),
  });

  const recentVideos = useMemo(
    () =>
      [...videos].sort(
        (a, b) => toTimestamp(b.added_at) - toTimestamp(a.added_at)
      ),
    [videos]
  );
  const recentVideosCarousel = useMemo(
    () => recentVideos.slice(0, RECENT_VIDEOS_CAROUSEL_LIMIT),
    [recentVideos]
  );
  const recentArtists = useMemo(() => {
    const sortedVideos = [...videos].sort(
      (a, b) => toTimestamp(b.added_at) - toTimestamp(a.added_at)
    );
    const artistsById = new Map(artists.map((artist) => [artist.id, artist]));
    const seen = new Set<string>();
    const recent: Artist[] = [];

    for (const video of sortedVideos) {
      if (seen.has(video.artist_id)) continue;
      const artist = artistsById.get(video.artist_id);
      if (!artist) continue;
      seen.add(video.artist_id);
      recent.push(artist);
    }

    const remainingArtists = artists
      .filter((artist) => !seen.has(artist.id))
      .sort((a, b) => toTimestamp(b.created_at) - toTimestamp(a.created_at));
    for (const artist of remainingArtists) {
      if (seen.has(artist.id)) continue;
      recent.push(artist);
    }

    return recent;
  }, [artists, videos]);
  const recentArtistsCarousel = useMemo(
    () => recentArtists.slice(0, RECENT_ARTISTS_CAROUSEL_LIMIT),
    [recentArtists]
  );
  const randomVideos = useMemo(() => {
    if (videos.length <= RANDOM_PICKS_CAROUSEL_LIMIT) {
      return [...videos].sort(() => Math.random() - 0.5);
    }
    const shuffled = [...videos].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, RANDOM_PICKS_CAROUSEL_LIMIT);
  }, [videos]);

  const videoRail = "basis-[72%] sm:basis-1/3 lg:basis-1/4 xl:basis-1/5 2xl:basis-1/6";

  return (
    <PageTransition>
      <div className="space-y-14 sm:space-y-20">
        {(videosError || artistsError) && (
          <p className="text-center text-sm text-destructive">Some content failed to load</p>
        )}

        {/* Hero Carousel */}
        {videosLoading ? (
          <div className="-mt-4 ml-[calc(50%-50vw)] mr-[calc(50%-50vw)] h-[62vh] min-h-[420px] max-h-[760px] sm:-mt-6">
            <Skeleton className="h-full w-full rounded-none" />
          </div>
        ) : (
          <HeroCarousel videos={videos} />
        )}

        {/* Recently Added Videos */}
        <Reveal>
          <section>
            <SectionHeader
              eyebrow="Fresh in the library"
              title="Recently added"
              action={
                recentVideos.length > RECENT_VIDEOS_CAROUSEL_LIMIT && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="rounded-full text-muted-foreground hover:text-foreground"
                    onClick={() => setShowAllRecentVideos((prev) => !prev)}
                  >
                    {showAllRecentVideos ? "Show less" : "See more"}
                  </Button>
                )
              }
            />
            {videosLoading ? (
              <VideoGridSkeleton count={6} className="xl:grid-cols-6" />
            ) : (
              <Carousel opts={{ align: "start", containScroll: "trimSnaps" }}>
                <CarouselContent>
                  {recentVideosCarousel.map((v) => (
                    <CarouselItem key={v.id} className={videoRail}>
                      <VideoCard video={v} />
                    </CarouselItem>
                  ))}
                </CarouselContent>
                <CarouselPrevious className="-left-3 top-[38%]" />
                <CarouselNext className="-right-3 top-[38%]" />
              </Carousel>
            )}
            {showAllRecentVideos && (
              <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                {recentVideos.map((v) => (
                  <VideoCard key={`all-${v.id}`} video={v} />
                ))}
              </div>
            )}
          </section>
        </Reveal>

        {/* Recently Added Artists */}
        <Reveal>
          <section>
            <SectionHeader
              eyebrow="On stage"
              title="Artists"
              action={
                recentArtists.length > RECENT_ARTISTS_CAROUSEL_LIMIT && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="rounded-full text-muted-foreground hover:text-foreground"
                    onClick={() => setShowAllRecentArtists((prev) => !prev)}
                  >
                    {showAllRecentArtists ? "Show less" : "See more"}
                  </Button>
                )
              }
            />
            {artistsLoading ? (
              <ArtistGridSkeleton count={8} />
            ) : (
              <Carousel opts={{ align: "start", containScroll: "trimSnaps" }}>
                <CarouselContent>
                  {recentArtistsCarousel.map((a) => (
                    <CarouselItem
                      key={a.id}
                      className="basis-[38%] sm:basis-1/4 lg:basis-1/6 xl:basis-[12.5%]"
                    >
                      <ArtistCard artist={a} />
                    </CarouselItem>
                  ))}
                </CarouselContent>
                <CarouselPrevious className="-left-3 top-[40%]" />
                <CarouselNext className="-right-3 top-[40%]" />
              </Carousel>
            )}
            {showAllRecentArtists && (
              <div className="mt-6 grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
                {recentArtists.map((a) => (
                  <ArtistCard key={`all-${a.id}`} artist={a} />
                ))}
              </div>
            )}
          </section>
        </Reveal>

        {/* Random Picks */}
        {randomVideos.length > 0 && (
          <Reveal>
            <section>
              <SectionHeader eyebrow="Shuffle" title="Random picks" />
              <Carousel opts={{ align: "start", containScroll: "trimSnaps" }}>
                <CarouselContent>
                  {randomVideos.map((v) => (
                    <CarouselItem key={v.id} className={videoRail}>
                      <VideoCard video={v} />
                    </CarouselItem>
                  ))}
                </CarouselContent>
                <CarouselPrevious className="-left-3 top-[38%]" />
                <CarouselNext className="-right-3 top-[38%]" />
              </Carousel>
            </section>
          </Reveal>
        )}
      </div>
    </PageTransition>
  );
}
