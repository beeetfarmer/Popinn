import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useIsMobile } from "./use-mobile";

const MOBILE_BREAKPOINT = 768;

/**
 * Replace window.matchMedia with a controllable stub and let tests drive the
 * "change" listeners by hand. The global setup file installs an inert version;
 * this one records listeners so resize behaviour can be exercised.
 */
function installMatchMedia() {
  const listeners = new Set<() => void>();
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: window.innerWidth < MOBILE_BREAKPOINT,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: (_: string, cb: () => void) => listeners.add(cb),
      removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
      dispatchEvent: vi.fn(),
    })),
  );
  return {
    listeners,
    resizeTo(width: number) {
      window.innerWidth = width;
      act(() => {
        listeners.forEach((cb) => cb());
      });
    },
  };
}

function setWidth(width: number) {
  window.innerWidth = width;
}

describe("useIsMobile", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setWidth(1024);
  });

  it("reports mobile below the breakpoint", () => {
    setWidth(375);
    installMatchMedia();

    const { result } = renderHook(() => useIsMobile());

    expect(result.current).toBe(true);
  });

  it("reports desktop at and above the breakpoint", () => {
    setWidth(MOBILE_BREAKPOINT);
    installMatchMedia();

    const { result } = renderHook(() => useIsMobile());

    expect(result.current).toBe(false);
  });

  it("treats one pixel under the breakpoint as mobile", () => {
    setWidth(MOBILE_BREAKPOINT - 1);
    installMatchMedia();

    const { result } = renderHook(() => useIsMobile());

    expect(result.current).toBe(true);
  });

  it("always returns a boolean, never the initial undefined state", () => {
    setWidth(1024);
    installMatchMedia();

    const { result } = renderHook(() => useIsMobile());

    expect(typeof result.current).toBe("boolean");
  });

  it("updates when the viewport crosses the breakpoint", () => {
    setWidth(1024);
    const mql = installMatchMedia();

    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    mql.resizeTo(375);
    expect(result.current).toBe(true);

    mql.resizeTo(1024);
    expect(result.current).toBe(false);
  });

  it("detaches its listener on unmount", () => {
    setWidth(1024);
    const mql = installMatchMedia();

    const { unmount } = renderHook(() => useIsMobile());
    expect(mql.listeners.size).toBe(1);

    unmount();
    expect(mql.listeners.size).toBe(0);
  });
});
