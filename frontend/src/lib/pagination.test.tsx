import { fireEvent, render, screen } from "@testing-library/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import { describe, expect, it } from "vitest";

/**
 * Guards the URL-backed pagination pattern used by MusicVideos and
 * ArtistDetail. Two mistakes here are easy to make and hard to spot, and both
 * were shipped once:
 *
 *  - React Router rebuilds setSearchParams whenever the params change, so any
 *    setPage built on it is NOT referentially stable. Listing it as an effect
 *    dependency makes every page change re-run that effect; if the effect
 *    resets to page 1, the pager silently refuses to advance.
 *  - The "reset on filter change" effect also runs on mount, which discards a
 *    page restored from the URL when returning from a video.
 */
function Paged() {
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, Number(searchParams.get("page")) || 1);

  const setPage = useCallback(
    (next: number | ((current: number) => number)) => {
      setSearchParams(
        (params) => {
          const updated = new URLSearchParams(params);
          const current = Math.max(1, Number(updated.get("page")) || 1);
          const value = typeof next === "function" ? next(current) : next;
          if (value <= 1) updated.delete("page");
          else updated.set("page", String(value));
          return updated;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const [filter, setFilter] = useState("all");
  const totalPages = 3;

  const filtersInitialised = useRef(false);
  const setPageRef = useRef(setPage);
  setPageRef.current = setPage;
  useEffect(() => {
    if (!filtersInitialised.current) {
      filtersInitialised.current = true;
      return;
    }
    setPageRef.current(1);
  }, [filter]);

  const label = useMemo(() => `Page ${page} of ${totalPages}`, [page]);

  return (
    <div>
      <span data-testid="label">{label}</span>
      <button onClick={() => setPage((p) => p - 1)} disabled={page === 1}>
        Prev
      </button>
      <button onClick={() => setPage((p) => p + 1)} disabled={page === totalPages}>
        Next
      </button>
      <button onClick={() => setFilter("rock")}>Filter</button>
    </div>
  );
}

const label = () => screen.getByTestId("label").textContent;

describe("URL-backed pagination", () => {
  it("advances to the next page when Next is clicked", () => {
    render(
      <MemoryRouter initialEntries={["/videos"]}>
        <Paged />
      </MemoryRouter>
    );
    expect(label()).toBe("Page 1 of 3");
    fireEvent.click(screen.getByText("Next"));
    expect(label()).toBe("Page 2 of 3");
  });

  it("keeps advancing across multiple clicks", () => {
    render(
      <MemoryRouter initialEntries={["/videos"]}>
        <Paged />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Next"));
    expect(label()).toBe("Page 3 of 3");
  });

  it("restores the page from the URL on mount", () => {
    render(
      <MemoryRouter initialEntries={["/videos?page=2"]}>
        <Paged />
      </MemoryRouter>
    );
    // The mount-time filter effect must not clobber this back to page 1.
    expect(label()).toBe("Page 2 of 3");
  });

  it("goes back a page", () => {
    render(
      <MemoryRouter initialEntries={["/videos?page=3"]}>
        <Paged />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText("Prev"));
    expect(label()).toBe("Page 2 of 3");
  });

  it("resets to page 1 when a filter actually changes", () => {
    render(
      <MemoryRouter initialEntries={["/videos?page=3"]}>
        <Paged />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText("Filter"));
    expect(label()).toBe("Page 1 of 3");
  });
});
