import { Outlet, useLocation } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import BottomDock from "./BottomDock";

export default function Layout() {
  const location = useLocation();

  return (
    <div className="flex min-h-screen flex-col">
      <main className="flex-1 p-4 pb-24 sm:p-6 sm:pb-28">
        <AnimatePresence mode="wait">
          <Outlet key={location.pathname} />
        </AnimatePresence>
      </main>
      <BottomDock />
    </div>
  );
}
