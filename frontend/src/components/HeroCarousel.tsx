import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import type { MusicVideo } from "@/data/mockData";

interface HeroCarouselProps {
  videos: MusicVideo[];
}

export default function HeroCarousel({ videos }: HeroCarouselProps) {
  const [current, setCurrent] = useState(0);
  const [isVisible, setIsVisible] = useState(true);
  const [failedPreviewIds, setFailedPreviewIds] = useState<Set<string>>(new Set());
  const [failedVideoIds, setFailedVideoIds] = useState<Set<string>>(new Set());
  const sectionRef = useRef<HTMLElement | null>(null);
  const activeVideoRef = useRef<HTMLVideoElement | null>(null);

  // Pick up to 8 random videos from the full library.
  const slides = useMemo(
    () =>
      videos
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
    const timer = setInterval(advance, 8000);
    return () => clearInterval(timer);
  }, [advance, isVisible, slides.length]);

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
  const activeVideoUsable = Boolean(
    activeSlide?.video_url && !failedVideoIds.has(activeSlide.id)
  );
  const activeMediaUrl = activePreviewUsable
    ? activeSlide.preview_url
    : activeVideoUsable
      ? activeSlide.video_url
      : null;

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
      className="relative -mx-4 -mt-4 overflow-hidden sm:-mx-6 sm:-mt-6"
    >
      <div className="relative h-64 sm:h-72 md:h-96">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeSlide.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
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
                  if (activePreviewUsable) {
                    setFailedPreviewIds((prev) => {
                      const next = new Set(prev);
                      next.add(activeSlide.id);
                      return next;
                    });
                    return;
                  }
                  setFailedVideoIds((prev) => {
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
                className="h-full w-full object-cover"
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
          </motion.div>
        </AnimatePresence>

        {/* Text overlay */}
        <div className="absolute bottom-6 left-6 right-6 sm:bottom-8 sm:left-8">
          <Link to={`/video/${activeSlide.id}`} className="group">
            <h2 className="text-2xl font-black text-foreground drop-shadow-lg md:text-4xl group-hover:text-primary transition-colors">
              {activeSlide.title}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground md:text-base">
              {activeSlide.artist_name}
            </p>
          </Link>
        </div>

        {/* Dot indicators */}
        {slides.length > 1 && (
          <div className="absolute bottom-3 right-6 flex gap-1.5 sm:bottom-4 sm:right-8">
            {slides.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrent(i)}
                className={`h-2 w-2 rounded-full transition-all ${
                  i === current
                    ? "w-6 bg-primary"
                    : "bg-foreground/30 hover:bg-foreground/50"
                }`}
              />
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
