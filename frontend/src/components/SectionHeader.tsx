import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";

interface SectionHeaderProps {
  title: string;
  linkTo?: string;
  linkLabel?: string;
}

export default function SectionHeader({ title, linkTo, linkLabel = "See all" }: SectionHeaderProps) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-xl font-bold text-foreground">{title}</h2>
      {linkTo && (
        <Link
          to={linkTo}
          className="flex items-center gap-1 text-sm text-primary transition-colors hover:text-primary/80"
        >
          {linkLabel} <ChevronRight className="h-4 w-4" />
        </Link>
      )}
    </div>
  );
}
