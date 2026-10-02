import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: ReactNode;
  eyebrow?: ReactNode;
  /** Shown beside the title, e.g. an item count. */
  meta?: ReactNode;
  description?: ReactNode;
  /** Controls aligned to the right (filters, buttons). */
  actions?: ReactNode;
  className?: string;
}

export default function PageHeader({ title, eyebrow, meta, description, actions, className }: PageHeaderProps) {
  return (
    <header className={cn("mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 pt-4 sm:mb-10 sm:pt-8", className)}>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="min-w-0"
      >
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <div className="flex items-baseline gap-3">
          <h1 className="display truncate text-5xl text-foreground sm:text-6xl">{title}</h1>
          {meta && <span className="text-sm tabular-nums text-muted-foreground">{meta}</span>}
        </div>
        {description && <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </motion.div>
      {actions && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
          className="flex w-full flex-wrap items-center gap-2 sm:w-auto"
        >
          {actions}
        </motion.div>
      )}
    </header>
  );
}
