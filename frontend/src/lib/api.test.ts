import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "./api";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function setCsrfCookie(value: string | null) {
  // jsdom has no cookie jar API, so drive document.cookie directly.
  if (value === null) {
    document.cookie = "popinn_csrf_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    return;
  }
  document.cookie = `popinn_csrf_token=${encodeURIComponent(value)}`;
}

/** The URL a fetch mock was called with, for a given call index. */
function urlOf(mock: ReturnType<typeof vi.fn>, call: number): string {
  return String(mock.mock.calls[call][0]);
}

/** The RequestInit a fetch mock was called with, for a given call index. */
function initOf(mock: ReturnType<typeof vi.fn>, call: number): RequestInit {
  return mock.mock.calls[call][1] as RequestInit;
}

describe("api client", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setCsrfCookie(null);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("prefixes requests with the API base and parses JSON", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "abc" }));

    const result = await api.get<{ id: string }>("/videos/");

    expect(result).toEqual({ id: "abc" });
    expect(urlOf(fetchMock, 0)).toBe("/api/v1/videos/");
  });

  it("sends credentials so the auth cookies ride along", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));

    await api.get("/auth/me");

    expect(initOf(fetchMock, 0).credentials).toBe("include");
  });

  it("omits the CSRF header on GET even when the cookie is present", async () => {
    setCsrfCookie("tok-123");
    fetchMock.mockResolvedValueOnce(jsonResponse({}));

    await api.get("/videos/");

    const headers = new Headers(initOf(fetchMock, 0).headers);
    expect(headers.has("X-CSRF-Token")).toBe(false);
  });

  it.each(["post", "put", "patch", "delete"] as const)(
    "attaches the CSRF header on %s",
    async (method) => {
      setCsrfCookie("tok-123");
      fetchMock.mockResolvedValueOnce(jsonResponse({}));

      await api[method]("/watchlists/");

      const headers = new Headers(initOf(fetchMock, 0).headers);
      expect(headers.get("X-CSRF-Token")).toBe("tok-123");
    },
  );

  it("URL-decodes the CSRF cookie value", async () => {
    setCsrfCookie("tok/with+special=chars");
    fetchMock.mockResolvedValueOnce(jsonResponse({}));

    await api.post("/watchlists/", { name: "x" });

    const headers = new Headers(initOf(fetchMock, 0).headers);
    expect(headers.get("X-CSRF-Token")).toBe("tok/with+special=chars");
  });

  it("serialises a JSON body and sets Content-Type", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));

    await api.post("/watchlists/", { name: "Favourites" });

    const init = initOf(fetchMock, 0);
    expect(init.body).toBe(JSON.stringify({ name: "Favourites" }));
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
  });

  it("returns undefined for 204 rather than trying to parse a body", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(api.delete("/watchlists/1")).resolves.toBeUndefined();
  });

  it("throws ApiError carrying the server's detail message", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ detail: "Video not found" }, 404),
    );

    const error = await api.get("/videos/nope").catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(404);
    expect(error.message).toBe("Video not found");
  });

  it("falls back to a generic message when the error body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("<html>gateway</html>", { status: 502 }),
    );

    const error = await api.get("/videos/").catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(502);
    // res.statusText is "" under jsdom's Response, so the generic fallback wins.
    expect(typeof error.message).toBe("string");
    expect(error.message.length).toBeGreaterThan(0);
  });

  describe("401 handling", () => {
    it("refreshes then replays the original request", async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ detail: "expired" }, 401))
        .mockResolvedValueOnce(new Response(null, { status: 200 })) // refresh
        .mockResolvedValueOnce(jsonResponse({ id: "abc" })); // retry

      const result = await api.get<{ id: string }>("/videos/");

      expect(result).toEqual({ id: "abc" });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(urlOf(fetchMock, 1)).toBe("/api/v1/auth/refresh");
      expect(initOf(fetchMock, 1).method).toBe("POST");
      expect(urlOf(fetchMock, 2)).toBe("/api/v1/videos/");
    });

    it("surfaces the 401 when the refresh itself fails", async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ detail: "expired" }, 401))
        .mockResolvedValueOnce(new Response(null, { status: 401 })); // refresh denied

      const error = await api.get("/videos/").catch((e) => e);

      expect(error).toBeInstanceOf(ApiError);
      expect(error.status).toBe(401);
      // No retry attempt after a failed refresh.
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("re-reads the CSRF cookie after refresh so the replay uses the new token", async () => {
      setCsrfCookie("stale-token");
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ detail: "expired" }, 401))
        .mockImplementationOnce(async () => {
          // The refresh endpoint rotates the CSRF cookie.
          setCsrfCookie("fresh-token");
          return new Response(null, { status: 200 });
        })
        .mockResolvedValueOnce(jsonResponse({ ok: true }));

      await api.post("/watchlists/", { name: "x" });

      const replayHeaders = new Headers(initOf(fetchMock, 2).headers);
      expect(replayHeaders.get("X-CSRF-Token")).toBe("fresh-token");
    });

    it("issues a single refresh for concurrent 401s", async () => {
      let refreshCalls = 0;
      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/auth/refresh")) {
          refreshCalls += 1;
          // Let both callers queue up behind the same in-flight promise.
          await new Promise((resolve) => setTimeout(resolve, 10));
          return new Response(null, { status: 200 });
        }
        // First attempt for each caller 401s; the replay succeeds.
        return refreshCalls === 0
          ? jsonResponse({ detail: "expired" }, 401)
          : jsonResponse({ ok: true });
      });

      const results = await Promise.all([
        api.get("/videos/"),
        api.get("/artists/"),
      ]);

      expect(results).toEqual([{ ok: true }, { ok: true }]);
      expect(refreshCalls).toBe(1);
    });
  });

  it("converts an aborted request into a timeout ApiError", async () => {
    fetchMock.mockImplementationOnce(async (_input, init: RequestInit) => {
      // Mimic what fetch does when its AbortSignal fires.
      const signal = init.signal as AbortSignal;
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve()),
      );
      throw new DOMException("The operation was aborted.", "AbortError");
    });

    vi.useFakeTimers();
    const pending = api.get("/videos/").catch((e) => e);
    await vi.advanceTimersByTimeAsync(15_000);
    const error = await pending;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(0);
    expect(error.message).toMatch(/timed out/i);
  });

  it("propagates non-abort network errors unchanged", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const error = await api.get("/videos/").catch((e) => e);

    expect(error).toBeInstanceOf(TypeError);
    expect(error).not.toBeInstanceOf(ApiError);
  });

  it("keeps the cookie-auth no-ops inert", () => {
    expect(api.getAccessToken()).toBeNull();
    expect(api.setTokens()).toBeUndefined();
    expect(api.clearTokens()).toBeUndefined();
  });
});
