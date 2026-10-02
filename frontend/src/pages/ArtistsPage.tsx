import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useScrollRestoration } from "@/hooks/useScrollRestoration";
import type { Artist } from "@/data/mockData";
import ArtistCard from "@/components/ArtistCard";
import PageTransition from "@/components/PageTransition";
import { Input } from "@/components/ui/input";
import PageHeader from "@/components/PageHeader";
import { ArtistGridSkeleton } from "@/components/Skeletons";
import { Search } from "lucide-react";

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
        <PageHeader
          eyebrow="Library"
          title="Artists"
          meta={filteredArtists.length}
          actions={
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter artists..."
                className="h-10 rounded-full border-white/10 bg-white/[0.04] pl-10"
              />
            </div>
          }
        />

        {/* A-Z jump bar: scrolls to the letter's section. */}
        {!isLoading && !isError && orderedLetters.length > 1 && (
          <div className="glass sticky top-3 z-20 mb-8 flex gap-0.5 overflow-x-auto rounded-full p-1 scrollbar-none">
            {orderedLetters.map((letter) => (
              <a
                key={letter}
                href={`#letter-${letter}`}
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById(`letter-${letter}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className="flex h-8 min-w-8 shrink-0 items-center justify-center rounded-full px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
              >
                {letter}
              </a>
            ))}
          </div>
        )}

        {isLoading && <ArtistGridSkeleton count={16} />}
        {isError && <p className="mb-4 text-sm text-destructive">Failed to load artists</p>}

        {!isLoading && !isError && (
          <>
            {filteredArtists.length === 0 ? (
              <p className="py-20 text-center text-sm text-muted-foreground">
                No artists match your filter.
              </p>
            ) : (
              <div className="space-y-12">
                {orderedLetters.map((letter) => (
                  <section key={letter} id={`letter-${letter}`} className="scroll-mt-20">
                    <div className="mb-5 flex items-center gap-4">
                      <h2 className="display text-4xl text-primary">{letter}</h2>
                      <div className="h-px flex-1 bg-gradient-to-r from-white/10 to-transparent" />
                    </div>
                    <div className="grid grid-cols-3 gap-x-4 gap-y-8 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
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
