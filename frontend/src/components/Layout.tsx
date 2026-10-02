import { cloneElement } from "react";
import { useLocation, useOutlet } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import BottomDock from "./BottomDock";

export default function Layout() {
  const location = useLocation();
  // useOutlet, not <Outlet>: the element carries the route it was created for,
  // so the page exiting keeps rendering itself. An <Outlet> always renders the
  // current route, which made the new page mount twice -- once inside the
  // exiting wrapper, then again -- and the throwaway copy clobbered scroll state.
  const outlet = useOutlet();

  return (
    <div className="flex min-h-screen flex-col">
      <main className="mx-auto w-full max-w-[1800px] flex-1 px-4 pb-32 pt-4 sm:px-8 sm:pb-36 sm:pt-6">
        <AnimatePresence mode="wait">
          {outlet && cloneElement(outlet, { key: location.pathname })}
        </AnimatePresence>
      </main>
      <BottomDock />
    </div>
  );
}
