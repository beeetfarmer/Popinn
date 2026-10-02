import { motion } from "framer-motion";
import { useLayoutEffect, type ReactNode } from "react";

export default function PageTransition({ children }: { children: ReactNode }) {
  // Start every page at the top. Otherwise it opens at the previous page's
  // scroll offset -- coming from deep in a long list, that is the bottom of a
  // page still loading, which looks blank until a reload. Runs on mount, after
  // the old page has unmounted and saved its own position; pages that restore
  // theirs (useScrollRestoration) do so later, once their data is in.
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
