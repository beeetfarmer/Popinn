import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { Play } from "lucide-react";

/** Full-screen frame for the sign-in and register forms. */
export default function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen overflow-hidden bg-background">
      {/* Slow-drifting stage lights. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <motion.div
          className="absolute -left-40 top-[-10%] h-[600px] w-[600px] rounded-full bg-primary/25 blur-[140px]"
          animate={{ x: [0, 80, 0], y: [0, 60, 0] }}
          transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute bottom-[-20%] right-[-10%] h-[700px] w-[700px] rounded-full bg-fuchsia-500/10 blur-[160px]"
          animate={{ x: [0, -60, 0], y: [0, -40, 0] }}
          transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      <div className="relative mx-auto grid w-full max-w-6xl items-center gap-12 px-6 py-12 lg:grid-cols-2">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          className="hidden lg:block"
        >
          <div className="mb-8 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-[0_20px_50px_-10px_hsl(var(--primary)/0.7)]">
            <Play className="ml-1 h-6 w-6 fill-current" />
          </div>
          <h1 className="display text-8xl leading-[0.9] text-foreground xl:text-9xl">
            Popinn<span className="text-primary">.</span>
          </h1>
          <p className="mt-6 max-w-md text-lg text-muted-foreground">
            Your music videos, <span className="display italic text-foreground">beautifully</span> self-hosted.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          className="glass mx-auto w-full max-w-md rounded-3xl p-8 sm:p-10"
        >
          <div className="mb-8">
            <div className="mb-6 flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground lg:hidden">
              <Play className="ml-0.5 h-5 w-5 fill-current" />
            </div>
            <h2 className="display text-4xl text-foreground">{title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
          </div>
          {children}
        </motion.div>
      </div>
    </div>
  );
}
