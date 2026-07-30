import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

const KEY_PREFIX = "popinn:scroll:key:";
const PATH_PREFIX = "popinn:scroll:path:";
/**
 * Frames to keep retrying a restore while the list grows into place. At ~60fps
 * this is about a second, which covers a cached render plus images settling
 * without leaving the page stuck if the content never gets tall enough.
 */
const MAX_RESTORE_FRAMES = 60;

/**
 * Put the window back where it was when the user last left this list.
 *
 * Position is stored twice, and both are needed:
 *
 * - By location.key, which identifies one history entry. The browser Back
 *   button returns to that same entry, so this restores the exact spot.
 * - By pathname, as a fallback. An in-app "Back to X" link is a *push*, not a
 *   pop, so it lands on a brand new history entry with a key that has nothing
 *   saved against it. Keying only by entry meant those returns always started
 *   at the top -- which is the whole bug this hook was supposed to fix.
 *
 * The consequence of the fallback is that reopening a list from the nav dock
 * also returns to where you were rather than the top. For a library that is
 * browsed rather than read, that is the behaviour people expect.
 *
 * `ready` must become true only once the list has data. Restoring against an
 * empty page silently clamps to zero -- the document is not yet tall enough to
 * scroll -- so the restore is retried across frames until the height is there.
 */
export function useScrollRestoration(ready: boolean): void {
  const location = useLocation();
  const entryKey = `${KEY_PREFIX}${location.key}`;
  const pathKey = `${PATH_PREFIX}${location.pathname}`;
  const restored = useRef(false);

  // Browsers try to restore scroll themselves, but they do it before an SPA has
  // rendered its data, so the attempt lands on a short page and is lost. Taking
  // over avoids the two mechanisms fighting.
  useEffect(() => {
    if (!("scrollRestoration" in window.history)) return;
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => {
      window.history.scrollRestoration = previous;
    };
  }, []);

  useEffect(() => {
    restored.current = false;
  }, [entryKey]);

  // Record position. Throttled to one write per frame: scroll fires far more
  // often than that and sessionStorage is synchronous.
  useEffect(() => {
    let pending = 0;
    const persist = () => {
      pending = 0;
      try {
        const offset = String(Math.round(window.scrollY));
        sessionStorage.setItem(entryKey, offset);
        sessionStorage.setItem(pathKey, offset);
      } catch {
        // Private-mode quota failures are not worth breaking scrolling over.
      }
    };
    const onScroll = () => {
      if (pending) return;
      pending = requestAnimationFrame(persist);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (pending) cancelAnimationFrame(pending);
      // Capture the final position, since the last frame may not have run.
      persist();
    };
  }, [entryKey, pathKey]);

  useEffect(() => {
    if (!ready || restored.current) return;

    let saved: string | null = null;
    try {
      // Exact history entry first, then the last position seen on this path.
      saved = sessionStorage.getItem(entryKey) ?? sessionStorage.getItem(pathKey);
    } catch {
      saved = null;
    }
    const target = Number(saved);
    if (!saved || !Number.isFinite(target) || target <= 0) {
      restored.current = true;
      return;
    }

    let frame = 0;
    let attempts = 0;
    const attempt = () => {
      attempts += 1;
      const maxScroll =
        document.documentElement.scrollHeight - window.innerHeight;
      if (maxScroll >= target || attempts >= MAX_RESTORE_FRAMES) {
        window.scrollTo({ top: Math.min(target, Math.max(0, maxScroll)) });
        restored.current = true;
        return;
      }
      frame = requestAnimationFrame(attempt);
    };
    frame = requestAnimationFrame(attempt);

    return () => {
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ready, entryKey, pathKey]);
}
