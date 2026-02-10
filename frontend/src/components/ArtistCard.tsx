import { Link } from "react-router-dom";
import type { Artist } from "@/data/mockData";

export default function ArtistCard({ artist }: { artist: Artist }) {
  return (
    <Link to={`/artist/${artist.id}`} className="group card-hover block text-center">
      <div className="mx-auto aspect-square w-full max-w-[10rem] overflow-hidden rounded-full border-2 border-border transition-colors group-hover:border-primary">
        <img
          src={artist.image_url || "/placeholder.svg"}
          alt={artist.name}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
          loading="lazy"
        />
      </div>
      <h3 className="mt-3 text-sm font-semibold text-foreground">{artist.name}</h3>
      <p className="text-xs text-muted-foreground">{artist.video_count} videos</p>
    </Link>
  );
}
