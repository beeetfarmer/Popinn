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
      initial={{ opacity: 0, y: 16, filter: "blur(6px)" }}
      // filter is cleared afterwards: a lingering blur(0px) makes this div the
      // containing block for any position:fixed descendant.
      animate={{ opacity: 1, y: 0, filter: "blur(0px)", transitionEnd: { filter: "none" } }}
      exit={{ opacity: 0, y: -8, filter: "blur(4px)", transition: { duration: 0.18 } }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
