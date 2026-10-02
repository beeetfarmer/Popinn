import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Info, Play } from "lucide-react";
import type { MusicVideo } from "@/data/mockData";

const SLIDE_INTERVAL_MS = 8000;

const heroLine = {
  hidden: { opacity: 0, y: 24, filter: "blur(8px)" },
  show: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] as const },
  },
};

interface HeroCarouselProps {
  videos: MusicVideo[];
}

export default function HeroCarousel({ videos }: HeroCarouselProps) {
  const [current, setCurrent] = useState(0);
  const [isVisible, setIsVisible] = useState(true);
  const [failedPreviewIds, setFailedPreviewIds] = useState<Set<string>>(new Set());
  const sectionRef = useRef<HTMLElement | null>(null);
  const activeVideoRef = useRef<HTMLVideoElement | null>(null);

  // Pick up to 8 random videos from the full library.
  const slides = useMemo(
    () =>
      [...videos]
        .sort(() => Math.random() - 0.5)
        .slice(0, 8),
    [videos]
  );

  const advance = useCallback(() => {
    if (slides.length > 1) {
      setCurrent((prev) => (prev + 1) % slides.length);
    }
  }, [slides.length]);

  useEffect(() => {
    if (slides.length <= 1 || !isVisible) return;
    const timer = setInterval(advance, SLIDE_INTERVAL_MS);
    return () => clearInterval(timer);
    // current restarts the timer on a manual pick, keeping it in step with the
    // progress bar.
  }, [advance, isVisible, slides.length, current]);

  useEffect(() => {
    if (current < slides.length) return;
    setCurrent(0);
  }, [current, slides.length]);

  useEffect(() => {
    if (typeof window === "undefined" || !("IntersectionObserver" in window)) {
      setIsVisible(true);
      return;
    }

    const node = sectionRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        setIsVisible(Boolean(entry?.isIntersecting && entry.intersectionRatio >= 0.1));
      },
      { threshold: [0, 0.1, 0.25] }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const activeSlide = slides[current] ?? slides[0];
  const activePreviewUsable = Boolean(
    activeSlide?.preview_url && !failedPreviewIds.has(activeSlide.id)
  );
  // Previews only. Falling back to video_url streamed the full original file
  // (often 4K, hundreds of MB) just to decorate the home page; the thumbnail
  // is shown instead until the preview exists.
  const activeMediaUrl = activePreviewUsable ? activeSlide.preview_url : null;

  useEffect(() => {
    const el = activeVideoRef.current;
    if (!el || !activeMediaUrl) return;

    if (!isVisible) {
      try {
        el.pause();
        el.currentTime = 0;
      } catch {
        // Ignore media API errors; UI should not crash.
      }
      return;
    }

    try {
      const playPromise = el.play();
      if (playPromise) {
        playPromise.catch(() => undefined);
      }
    } catch {
      // Ignore media API errors; UI should not crash.
    }

    return () => {
      try {
        el.pause();
        el.currentTime = 0;
      } catch {
        // Ignore media API errors; UI should not crash.
      }
    };
  }, [activeMediaUrl, activeSlide?.id, current, isVisible]);

  if (slides.length === 0) return null;

  const preloadSlides = (() => {
    if (slides.length <= 1) return [] as MusicVideo[];
    const nextIdx = (current + 1) % slides.length;
    const prevIdx = (current - 1 + slides.length) % slides.length;
    return [nextIdx, prevIdx]
      .filter((idx, index, arr) => arr.indexOf(idx) === index)
      .map((idx) => slides[idx])
      .filter((slide) => !!slide.preview_url && !failedPreviewIds.has(slide.id));
  })();

  return (
    <section
      ref={sectionRef}
      className="relative -mt-4 ml-[calc(50%-50vw)] mr-[calc(50%-50vw)] overflow-hidden sm:-mt-6"
    >
      <div className="relative h-[62vh] min-h-[420px] max-h-[760px]">
        <AnimatePresence mode="popLayout">
          <motion.div
            key={activeSlide.id}
            initial={{ opacity: 0, scale: 1.04 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-0"
          >
            {activeMediaUrl ? (
              <video
                key={`hero-preview-${activeSlide.id}`}
                ref={activeVideoRef}
                src={activeMediaUrl}
                poster={activeSlide.thumbnail_url || "/placeholder.svg"}
                muted
                playsInline
                loop
                autoPlay
                preload="metadata"
                onError={() => {
                  setFailedPreviewIds((prev) => {
                    const next = new Set(prev);
                    next.add(activeSlide.id);
                    return next;
                  });
                }}
                className="h-full w-full object-cover"
              />
            ) : (
              <img
                src={activeSlide.thumbnail_url || "/placeholder.svg"}
                alt={activeSlide.title}
                className="h-full w-full animate-ken-burns object-cover"
              />
            )}
          </motion.div>
        </AnimatePresence>

        {/* Scrims: bottom fade into the page, left fade behind the title, and a
            soft top shade so the frame never meets the viewport edge hard. */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background via-background/20 to-transparent" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-background/80 via-background/10 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-background/50 to-transparent" />

        <div className="absolute inset-x-0 bottom-0 pb-12 sm:pb-16">
          {/* Same box as <main>, so the title lines up with the content below. */}
          <div className="mx-auto max-w-[1800px] px-4 sm:px-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeSlide.id}
              initial="hidden"
              animate="show"
              exit="exit"
              variants={{
                hidden: {},
                show: { transition: { staggerChildren: 0.08, delayChildren: 0.15 } },
                exit: { opacity: 0, transition: { duration: 0.2 } },
              }}
              className="max-w-3xl"
            >
              <motion.p
                variants={heroLine}
                className="eyebrow flex items-center gap-2 text-primary"
              >
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                Featured · {activeSlide.artist_name}
              </motion.p>
              <motion.h1
                variants={heroLine}
                className="display mt-3 line-clamp-2 text-5xl leading-[0.95] text-foreground drop-shadow-[0_4px_30px_rgba(0,0,0,0.6)] sm:text-6xl lg:text-8xl"
              >
                {activeSlide.title}
              </motion.h1>
              <motion.div variants={heroLine} className="mt-6 flex flex-wrap items-center gap-3">
                <Link
                  to={`/video/${activeSlide.id}`}
                  className="group inline-flex items-center gap-2 rounded-full bg-foreground px-6 py-3 text-sm font-semibold text-background transition-all duration-300 hover:scale-[1.03] hover:bg-primary hover:text-primary-foreground hover:shadow-[0_10px_40px_-10px_hsl(var(--primary)/0.8)]"
                >
                  <Play className="h-4 w-4 fill-current" />
                  Play
                </Link>
                <Link
                  to={`/artist/${activeSlide.artist_id}`}
                  className="glass inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-medium text-foreground transition-colors hover:bg-white/10"
                >
                  <Info className="h-4 w-4" />
                  {activeSlide.artist_name}
                </Link>
                {activeSlide.duration_display && (
                  <span className="text-sm text-muted-foreground">{activeSlide.duration_display}</span>
                )}
              </motion.div>
            </motion.div>
          </AnimatePresence>
          </div>
        </div>

        {/* Progress indicators: the active one fills over the slide interval. */}
        {slides.length > 1 && (
          <div className="absolute bottom-6 right-[max(1rem,calc((100vw-1800px)/2+1rem))] flex gap-1.5 sm:bottom-10 sm:right-[max(2rem,calc((100vw-1800px)/2+2rem))]">
            {slides.map((slide, i) => (
              <button
                key={slide.id}
                type="button"
                aria-label={`Show ${slide.title}`}
                onClick={() => setCurrent(i)}
                className="group relative h-1 w-6 overflow-hidden rounded-full bg-white/20 transition-all duration-500 hover:bg-white/40 data-[active=true]:w-12"
                data-active={i === current}
              >
                {i === current && (
                  <span
                    key={`${slide.id}-${current}`}
                    className="absolute inset-y-0 left-0 rounded-full bg-primary"
                    style={{
                      animation: `hero-progress ${SLIDE_INTERVAL_MS}ms linear forwards`,
                      animationPlayState: isVisible ? "running" : "paused",
                    }}
                  />
                )}
                {i < current && <span className="absolute inset-0 bg-white/50" />}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="hidden" aria-hidden>
        {preloadSlides.map((slide) => (
          <video
            key={`hero-preload-${slide.id}`}
            src={slide.preview_url || undefined}
            muted
            playsInline
            preload="metadata"
          />
        ))}
      </div>
    </section>
  );
}
