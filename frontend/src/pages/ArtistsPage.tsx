import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useScrollRestoration } from "@/hooks/useScrollRestoration";
import type { Artist } from "@/data/mockData";
import ArtistCard from "@/components/ArtistCard";
import PageTransition from "@/components/PageTransition";
import { Input } from "@/components/ui/input";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

function getLetterBucket(name: string): string {
  const firstChar = name.trim().charAt(0).toUpperCase();
  return /^[A-Z]$/.test(firstChar) ? firstChar : "#";
}

export default function ArtistsPage() {
  const [search, setSearch] = useState("");

  const { data: artists = [], isLoading, isError } = useQuery<Artist[]>({
    queryKey: ["artists"],
    // Fetched in one go rather than paged: the A-Z index has to know which
    // letters exist, which needs the whole list. The old limit of 200 quietly
    // truncated larger libraries.
    queryFn: () => api.get("/artists/?limit=2000"),
  });

  // Coming back from an artist should land where you left off, not at the top.
  useScrollRestoration(artists.length > 0);

  const filteredArtists = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = needle
      ? artists.filter((artist) => artist.name.toLowerCase().includes(needle))
      : artists;
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [artists, search]);

  const groupedArtists = useMemo(() => {
    const groups: Record<string, Artist[]> = {};
    for (const artist of filteredArtists) {
      const letter = getLetterBucket(artist.name);
      groups[letter] = groups[letter] ? [...groups[letter], artist] : [artist];
    }
    return groups;
  }, [filteredArtists]);

  const orderedLetters = useMemo(
    () => [...LETTERS, "#"].filter((letter) => (groupedArtists[letter] || []).length > 0),
    [groupedArtists]
  );

  return (
    <PageTransition>
      <div>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-foreground">Artists</h1>
          <span className="text-sm text-muted-foreground">({filteredArtists.length})</span>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter artists..."
            className="ml-auto h-9 w-full max-w-xs"
          />
        </div>

        {isLoading && <p className="mb-4 text-sm text-muted-foreground">Loading artists...</p>}
        {isError && <p className="mb-4 text-sm text-destructive">Failed to load artists</p>}

        {!isLoading && !isError && (
          <>
            {filteredArtists.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No artists match your filter.
              </p>
            ) : (
              <div className="space-y-7">
                {orderedLetters.map((letter) => (
                  <section key={letter}>
                    <h2 className="mb-3 text-sm font-bold tracking-wide text-muted-foreground">
                      {letter}
                    </h2>
                    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
                      {(groupedArtists[letter] || []).map((artist) => (
                        <ArtistCard key={artist.id} artist={artist} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </PageTransition>
  );
}
