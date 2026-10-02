import { Link } from "react-router-dom";
import type { Artist } from "@/data/mockData";

export default function ArtistCard({ artist }: { artist: Artist }) {
  return (
    <Link
      to={`/artist/${artist.id}`}
      className="group block rounded-2xl text-center outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
    >
      <div className="relative mx-auto aspect-square w-full max-w-[10rem]">
        {/* Halo picks up the accent on hover, like a stage light behind the photo. */}
        <div className="absolute inset-0 rounded-full bg-primary/40 opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-60" />
        <div className="relative h-full w-full overflow-hidden rounded-full bg-muted ring-1 ring-white/10 transition-all duration-500 ease-out group-hover:ring-2 group-hover:ring-primary/70">
          {artist.image_url ? (
            <img
              src={artist.image_url}
              alt={artist.name}
              className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-110"
              loading="lazy"
              decoding="async"
            />
          ) : (
            // No photo: the initial on a tinted disc instead of a stock placeholder.
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-secondary to-muted">
              <span className="display text-5xl text-muted-foreground/80 transition-colors group-hover:text-primary">
                {artist.name.trim().charAt(0).toUpperCase()}
              </span>
            </div>
          )}
        </div>
      </div>
      <h3 className="mt-3 truncate text-sm font-medium text-foreground transition-colors group-hover:text-primary">
        {artist.name}
      </h3>
      <p className="text-xs text-muted-foreground">{artist.video_count} videos</p>
    </Link>
  );
}
