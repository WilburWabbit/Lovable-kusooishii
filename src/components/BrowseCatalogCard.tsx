import { Link } from "react-router-dom";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { GRADE_LABELS } from "@/lib/grades";
import { cn } from "@/lib/utils";

export interface BrowseCatalogItem {
  product_id: string;
  mpn: string;
  name: string;
  theme_name: string | null;
  theme_id: string | null;
  retired_flag: boolean;
  release_year: number | null;
  piece_count: number | null;
  min_price: number | null;
  best_grade: string | null;
  total_stock: number;
  img_url: string | null;
}

interface BrowseCatalogCardProps {
  item: BrowseCatalogItem;
  className?: string;
}

export function BrowseCatalogCard({ item, className }: BrowseCatalogCardProps) {
  const gradeLabel = item.best_grade ? (GRADE_LABELS[item.best_grade] ?? `Grade ${item.best_grade}`) : null;

  return (
    <Link
      to={`/sets/${item.mpn}`}
      className={cn(
        "group relative flex flex-col overflow-hidden border border-border bg-card transition-all hover:shadow-md",
        className,
      )}
    >
      <div className="aspect-square bg-white">
        {item.img_url ? (
          <img
            src={item.img_url}
            alt={item.name}
            className="h-full w-full object-contain p-4"
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6">
            <span className="font-display text-3xl font-bold text-muted-foreground/20">
              {item.mpn.split("-")[0]}
            </span>
          </div>
        )}
      </div>

      <div className="absolute left-2 top-2 flex gap-1">
        {gradeLabel && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="bg-foreground px-1.5 py-0.5 font-display text-[9px] font-bold uppercase tracking-wider text-background">
                {gradeLabel}
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              Condition Grade: {item.best_grade} — {gradeLabel}
            </TooltipContent>
          </Tooltip>
        )}
        {item.retired_flag && (
          <span className="bg-primary px-1.5 py-0.5 font-display text-[9px] font-bold uppercase tracking-wider text-primary-foreground">
            Retired
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-3">
        <h3 className="font-display text-sm font-semibold text-foreground transition-colors group-hover:text-primary line-clamp-2">
          {item.name}
        </h3>
        <p className="mt-0.5 font-body text-[11px] text-muted-foreground">
          {item.theme_name ?? "Uncategorised"} · {item.mpn}
        </p>
        <div className="mt-auto flex items-baseline justify-between pt-2">
          <span className="font-display text-base font-bold text-foreground">
            {item.min_price != null ? `£${Number(item.min_price).toFixed(2)}` : "—"}
          </span>
          <span className="font-body text-[11px] text-muted-foreground">
            {item.total_stock} in stock
          </span>
        </div>
      </div>
    </Link>
  );
}
