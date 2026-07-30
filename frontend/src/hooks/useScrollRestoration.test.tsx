import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { useScrollRestoration } from "@/hooks/useScrollRestoration";

/**
 * jsdom has no layout, so the document is never tall enough for a restore to
 * land. Both are faked so the hook's clamping logic runs against real numbers.
 */
function setPageHeight(height: number) {
  Object.defineProperty(document.documentElement, "scrollHeight", {
    value: height,
    configurable: true,
  });
  Object.defineProperty(window, "innerHeight", {
    value: 800,
    configurable: true,
  });
}

let scrolledTo = 0;

function flushFrames(count = 5) {
  for (let i = 0; i < count; i += 1) {
    act(() => {
      vi.advanceTimersByTime(20);
    });
  }
}

function ListPage({ ready = true }: { ready?: boolean }) {
  const navigate = useNavigate();
  useScrollRestoration(ready);
  return (
    <div>
      <button onClick={() => navigate("/detail")}>open</button>
      {/* A push back to the list, which is what the real "Back to X" link does */}
      <button onClick={() => navigate("/list")}>push-back</button>
    </div>
  );
}

function DetailPage() {
  const navigate = useNavigate();
  return <button onClick={() => navigate("/list")}>back</button>;
}

function App({ ready = true }: { ready?: boolean }) {
  return (
    <Routes>
      <Route path="/list" element={<ListPage ready={ready} />} />
      <Route path="/detail" element={<DetailPage />} />
    </Routes>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
  scrolledTo = 0;
  setPageHeight(5000);
  window.scrollTo = ((options: number | ScrollToOptions) => {
    scrolledTo =
      typeof options === "number" ? options : Math.round(options?.top ?? 0);
    Object.defineProperty(window, "scrollY", {
      value: scrolledTo,
      configurable: true,
    });
  }) as typeof window.scrollTo;
  Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
    setTimeout(() => cb(performance.now()), 16) as unknown as number
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function scrollTo(offset: number) {
  Object.defineProperty(window, "scrollY", {
    value: offset,
    configurable: true,
  });
  act(() => {
    window.dispatchEvent(new Event("scroll"));
  });
  flushFrames(2);
}

describe("useScrollRestoration", () => {
  it("stores the offset under both the history entry and the path", () => {
    render(
      <MemoryRouter initialEntries={["/list"]}>
        <App />
      </MemoryRouter>
    );
    scrollTo(900);

    const stored = Object.entries({ ...sessionStorage });
    expect(stored.some(([k]) => k.startsWith("popinn:scroll:key:"))).toBe(true);
    expect(sessionStorage.getItem("popinn:scroll:path:/list")).toBe("900");
  });

  it("restores position when the list is re-entered by a push", () => {
    // The reported bug: "Back to Artists" is a Link, so it pushes a NEW history
    // entry. Keyed only by entry there is nothing saved and the page opens at
    // the top. The path fallback is what makes this pass.
    sessionStorage.setItem("popinn:scroll:path:/list", "1200");

    render(
      <MemoryRouter initialEntries={["/other", "/list"]}>
        <App />
      </MemoryRouter>
    );
    flushFrames();

    expect(scrolledTo).toBe(1200);
  });

  it("prefers the exact history entry over the path fallback", () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={["/list"]}>
        <App />
      </MemoryRouter>
    );
    scrollTo(700);
    const entryKey = Object.keys({ ...sessionStorage }).find((k) =>
      k.startsWith("popinn:scroll:key:")
    )!;
    unmount();

    // Path says somewhere else; the exact entry must win.
    sessionStorage.setItem(entryKey, "450");
    sessionStorage.setItem("popinn:scroll:path:/list", "3000");
    expect(sessionStorage.getItem(entryKey)).toBe("450");
  });

  it("does not scroll when nothing was stored", () => {
    render(
      <MemoryRouter initialEntries={["/list"]}>
        <App />
      </MemoryRouter>
    );
    flushFrames();
    expect(scrolledTo).toBe(0);
  });

  it("waits for content before restoring, then clamps to what exists", () => {
    sessionStorage.setItem("popinn:scroll:path:/list", "4000");
    // Page is far too short for the saved offset.
    setPageHeight(1000);

    render(
      <MemoryRouter initialEntries={["/list"]}>
        <App />
      </MemoryRouter>
    );
    flushFrames(70);

    // Clamped to the maximum scrollable offset rather than overshooting.
    expect(scrolledTo).toBe(200);
  });

  it("does not restore until the list reports it has data", () => {
    sessionStorage.setItem("popinn:scroll:path:/list", "1200");

    const { rerender } = render(
      <MemoryRouter initialEntries={["/list"]}>
        <App ready={false} />
      </MemoryRouter>
    );
    flushFrames();
    expect(scrolledTo).toBe(0);

    rerender(
      <MemoryRouter initialEntries={["/list"]}>
        <App ready />
      </MemoryRouter>
    );
    flushFrames();
    expect(scrolledTo).toBe(1200);
  });
});
