import { api } from "@/lib/api";
import type { MusicVideo } from "@/data/mockData";

/** One page of videos as returned by GET /videos/. */
export interface VideoPage {
  items: MusicVideo[];
  total: number;
  skip: number;
  limit: number;
}

export interface VideoQuery {
  search?: string;
  artist_id?: string;
  genre?: string;
  sort_by?: string;
  sort_order?: string;
}

/**
 * Largest page the API will serve. Used when fetching a whole set, where the
 * point is to make as few round trips as possible.
 */
export const MAX_PAGE_SIZE = 200;

export function videoQueryString(
  query: VideoQuery,
  skip: number,
  limit: number
): string {
  const params = new URLSearchParams();
  params.set("skip", String(skip));
  params.set("limit", String(limit));
  if (query.search) params.set("search", query.search);
  if (query.artist_id && query.artist_id !== "all") {
    params.set("artist_id", query.artist_id);
  }
  if (query.genre && query.genre !== "all") params.set("genre", query.genre);
  if (query.sort_by) params.set("sort_by", query.sort_by);
  if (query.sort_order) params.set("sort_order", query.sort_order);
  return params.toString();
}

export function fetchVideoPage(
  query: VideoQuery,
  skip: number,
  limit: number
): Promise<VideoPage> {
  return api.get<VideoPage>(`/videos/?${videoQueryString(query, skip, limit)}`);
}

/**
 * Every video matching a query, gathered a page at a time.
 *
 * Needed wherever a count or an ordering has to be right across the whole
 * library rather than the page on screen -- play queues, stats rankings. The
 * loop is bounded by the total the server reports and by a hard iteration
 * ceiling, so a disagreement between total and page contents cannot spin
 * forever.
 */
export async function fetchAllVideos(
  query: VideoQuery = {}
): Promise<MusicVideo[]> {
  const first = await fetchVideoPage(query, 0, MAX_PAGE_SIZE);
  const collected = [...first.items];
  const maxRequests = Math.ceil(first.total / MAX_PAGE_SIZE) + 1;

  for (let request = 1; request < maxRequests; request += 1) {
    if (collected.length >= first.total) break;
    const next = await fetchVideoPage(query, collected.length, MAX_PAGE_SIZE);
    if (next.items.length === 0) break;
    collected.push(...next.items);
  }
  return collected;
}
