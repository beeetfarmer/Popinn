import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <div className="text-center">
        <p className="eyebrow mb-4">Error 404</p>
        <h1 className="display text-[10rem] leading-none text-gradient sm:text-[14rem]">404</h1>
        <p className="mb-8 mt-2 text-lg text-muted-foreground">This page fell off the setlist.</p>
        <Button asChild size="lg">
          <Link to="/">Return home</Link>
        </Button>
      </div>
    </div>
  );
};

export default NotFound;
