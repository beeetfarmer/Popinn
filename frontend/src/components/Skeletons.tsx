import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function VideoCardSkeleton() {
  return (
    <div>
      <Skeleton className="aspect-video w-full rounded-xl" />
      <Skeleton className="mt-3 h-3.5 w-4/5" />
      <Skeleton className="mt-2 h-3 w-1/2" />
    </div>
  );
}

export function VideoGridSkeleton({ count = 12, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6", className)}>
      {Array.from({ length: count }, (_, i) => (
        <VideoCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function ArtistGridSkeleton({ count = 12, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8", className)}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col items-center">
          <Skeleton className="aspect-square w-full max-w-[10rem] rounded-full" />
          <Skeleton className="mt-3 h-3.5 w-2/3" />
          <Skeleton className="mt-2 h-3 w-1/3" />
        </div>
      ))}
    </div>
  );
}
