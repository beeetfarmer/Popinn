import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import type { MusicVideo } from "@/data/mockData";

interface HeroCarouselProps {
  videos: MusicVideo[];
}

export default function HeroCarousel({ videos }: HeroCarouselProps) {
  const [current, setCurrent] = useState(0);

  // Pick up to 8 random videos that have thumbnails
  const slides = videos
    .filter((v) => v.thumbnail_url)
    .sort(() => Math.random() - 0.5)
    .slice(0, 8);

  const advance = useCallback(() => {
    if (slides.length > 1) {
      setCurrent((prev) => (prev + 1) % slides.length);
    }
  }, [slides.length]);

  useEffect(() => {
    if (slides.length <= 1) return;
    const timer = setInterval(advance, 6000);
    return () => clearInterval(timer);
  }, [advance, slides.length]);

  if (slides.length === 0) return null;

  const video = slides[current];

  return (
    <section className="relative -mx-4 -mt-4 overflow-hidden sm:-mx-6 sm:-mt-6">
      <div className="relative h-64 sm:h-72 md:h-96">
        <AnimatePresence mode="wait">
          <motion.div
            key={video.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
            className="absolute inset-0"
          >
            <img
              src={video.thumbnail_url!}
              alt={video.title}
              className="h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
          </motion.div>
        </AnimatePresence>

        {/* Text overlay */}
        <div className="absolute bottom-6 left-6 right-6 sm:bottom-8 sm:left-8">
          <Link to={`/video/${video.id}`} className="group">
            <h2 className="text-2xl font-black text-foreground drop-shadow-lg md:text-4xl group-hover:text-primary transition-colors">
              {video.title}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground md:text-base">
              {video.artist_name}
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
    </section>
  );
}
