import { describe, expect, it, vi, beforeEach } from "vitest";
import { api } from "@/lib/api";
import {
  MAX_PAGE_SIZE,
  fetchAllVideos,
  videoQueryString,
} from "@/lib/videos";
import type { MusicVideo } from "@/data/mockData";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn() },
}));

const mockedGet = vi.mocked(api.get);

function videos(count: number, offset = 0): MusicVideo[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `v${offset + i}`,
  })) as unknown as MusicVideo[];
}

/** Serves a library of `total` videos, honouring skip/limit like the API does. */
function serveLibrary(total: number) {
  mockedGet.mockImplementation((path: string) => {
    const params = new URLSearchParams(path.split("?")[1] ?? "");
    const skip = Number(params.get("skip") ?? 0);
    const limit = Number(params.get("limit") ?? 50);
    const items = videos(Math.max(0, Math.min(limit, total - skip)), skip);
    return Promise.resolve({ items, total, skip, limit });
  });
}

beforeEach(() => {
  mockedGet.mockReset();
});

describe("videoQueryString", () => {
  it("always carries paging", () => {
    const qs = new URLSearchParams(videoQueryString({}, 24, 12));
    expect(qs.get("skip")).toBe("24");
    expect(qs.get("limit")).toBe("12");
  });

  it("omits the 'all' sentinel so it is not sent as a real filter", () => {
    const qs = new URLSearchParams(
      videoQueryString({ artist_id: "all", genre: "all" }, 0, 12)
    );
    expect(qs.has("artist_id")).toBe(false);
    expect(qs.has("genre")).toBe(false);
  });

  it("passes real filters and sorting through", () => {
    const qs = new URLSearchParams(
      videoQueryString(
        {
          artist_id: "abc",
          genre: "K-Pop",
          search: "love",
          sort_by: "file_created_at",
          sort_order: "desc",
        },
        0,
        12
      )
    );
    expect(qs.get("artist_id")).toBe("abc");
    expect(qs.get("genre")).toBe("K-Pop");
    expect(qs.get("search")).toBe("love");
    expect(qs.get("sort_by")).toBe("file_created_at");
    expect(qs.get("sort_order")).toBe("desc");
  });
});

describe("fetchAllVideos", () => {
  it("returns every video in a library larger than one page", async () => {
    serveLibrary(830);
    const all = await fetchAllVideos();
    // The bug being guarded against: stopping at the first page and reporting
    // a 200-video library as the whole thing.
    expect(all).toHaveLength(830);
    expect(new Set(all.map((v) => v.id)).size).toBe(830);
    expect(mockedGet).toHaveBeenCalledTimes(Math.ceil(830 / MAX_PAGE_SIZE));
  });

  it("makes a single request when everything fits on one page", async () => {
    serveLibrary(31);
    const all = await fetchAllVideos();
    expect(all).toHaveLength(31);
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });

  it("handles an empty library", async () => {
    serveLibrary(0);
    expect(await fetchAllVideos()).toHaveLength(0);
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });

  it("stops when a page comes back empty even though total claims more", async () => {
    // A server whose total disagrees with its pages must not spin forever. One
    // extra request is made to discover the page is empty, then it gives up.
    mockedGet.mockResolvedValue({ items: [], total: 500, skip: 0, limit: 200 });
    const all = await fetchAllVideos();
    expect(all).toHaveLength(0);
    expect(mockedGet).toHaveBeenCalledTimes(2);
  });

  it("is bounded when pages never advance past the total", async () => {
    // Pathological: always returns a full page, so length never reaches total.
    mockedGet.mockResolvedValue({
      items: videos(1),
      total: 1_000_000,
      skip: 0,
      limit: 200,
    });
    await fetchAllVideos();
    expect(mockedGet.mock.calls.length).toBeLessThanOrEqual(
      Math.ceil(1_000_000 / MAX_PAGE_SIZE) + 1
    );
  });

  it("applies the filter to every page it requests", async () => {
    serveLibrary(300);
    await fetchAllVideos({ artist_id: "abc", sort_by: "title" });
    expect(mockedGet).toHaveBeenCalledTimes(2);
    for (const [path] of mockedGet.mock.calls) {
      expect(path).toContain("artist_id=abc");
      expect(path).toContain("sort_by=title");
    }
  });
});
