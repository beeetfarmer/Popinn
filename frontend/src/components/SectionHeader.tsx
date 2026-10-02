import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

interface SectionHeaderProps {
  title: string;
  eyebrow?: string;
  linkTo?: string;
  linkLabel?: string;
  /** Extra controls on the right, e.g. a "See more" toggle. */
  action?: ReactNode;
}

export default function SectionHeader({
  title,
  eyebrow,
  linkTo,
  linkLabel = "See all",
  action,
}: SectionHeaderProps) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        {eyebrow && <p className="eyebrow mb-1.5">{eyebrow}</p>}
        <h2 className="display text-3xl text-foreground sm:text-4xl">{title}</h2>
      </div>
      {action}
      {linkTo && (
        <Link
          to={linkTo}
          className="group flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {linkLabel}
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
      )}
    </div>
  );
}
