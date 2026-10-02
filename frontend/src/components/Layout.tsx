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
      <main className="flex-1 p-4 pb-24 sm:p-6 sm:pb-28">
        <AnimatePresence mode="wait">
          {outlet && cloneElement(outlet, { key: location.pathname })}
        </AnimatePresence>
      </main>
      <BottomDock />
    </div>
  );
}
