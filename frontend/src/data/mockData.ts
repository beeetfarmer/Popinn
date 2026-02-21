export interface Artist {
  id: string;
  name: string;
  lastfm_artist_name?: string | null;
  bio: string | null;
  image_url: string | null;
  video_count: number;
  play_count?: number;
  created_at?: string | null;
}

export interface MusicVideo {
  id: string;
  title: string;
  artist_id: string;
  artist_name: string;
  album: string | null;
  duration: number | null;
  duration_display: string;
  thumbnail_url: string | null;
  video_url: string | null;
  playback_url: string | null;
  year: number | null;
  genre: string | null;
  file_size: number | null;
  added_at: string | null;
}

export interface ArtistDetail extends Artist {
  videos: MusicVideo[];
}

export interface Watchlist {
  id: string;
  name: string;
  item_count: number;
  created_at: string;
  videos?: MusicVideo[];
}
