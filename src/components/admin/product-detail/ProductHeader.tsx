import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { useState } from "react";
import type { ProductDetail } from "./types";

interface ProductHeaderProps {
  product: ProductDetail;
}

export function ProductHeader({ product }: ProductHeaderProps) {
  const navigate = useNavigate();
  const [dimsOpen, setDimsOpen] = useState(false);

  const hasDims =
    product.length_cm != null ||
    product.width_cm != null ||
    product.height_cm != null ||
    product.weight_kg != null;

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-4">
        <Button
          variant="ghost"
          size="icon"
          className="mt-1"
          onClick={() => navigate("/admin/products")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1 flex-wrap">
            <h2 className="font-display text-lg font-bold text-foreground truncate">
              {product.name ?? "Unnamed"}
            </h2>
            <span className="font-mono text-sm text-muted-foreground">
              {product.mpn}
            </span>
            {product.retired_flag && (
              <Badge
                variant="outline"
                className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 text-[10px]"
              >
                Retired
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {[product.theme_name, product.subtheme_name]
              .filter(Boolean)
              .join(" › ")}
            {product.release_year ? ` • ${product.release_year}` : ""}
            {product.piece_count ? ` • ${product.piece_count} pcs` : ""}
            {product.age_range ? ` • ${product.age_range}` : ""}
          </p>
        </div>
        {product.img_url && (
          <img
            src={product.img_url}
            alt={product.name ?? ""}
            className="h-16 w-16 rounded-md object-cover border border-border shrink-0"
          />
        )}
      </div>

      {hasDims && (
        <Collapsible open={dimsOpen} onOpenChange={setDimsOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground px-2 ml-10">
              Dimensions & Weight
              <ChevronDown className={`h-3 w-3 ml-1 transition-transform ${dimsOpen ? "rotate-180" : ""}`} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 ml-10 mt-2 pb-1">
              {product.length_cm != null && (
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Length</p>
                  <p className="text-sm font-bold font-display">{product.length_cm} cm</p>
                </div>
              )}
              {product.width_cm != null && (
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Width</p>
                  <p className="text-sm font-bold font-display">{product.width_cm} cm</p>
                </div>
              )}
              {product.height_cm != null && (
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Height</p>
                  <p className="text-sm font-bold font-display">{product.height_cm} cm</p>
                </div>
              )}
              {product.length_cm != null && product.width_cm != null && product.height_cm != null && (
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Girth</p>
                  <p className="text-sm font-bold font-display">
                    {(2 * ((product.width_cm ?? 0) + (product.height_cm ?? 0))).toFixed(1)} cm
                  </p>
                </div>
              )}
              {product.weight_kg != null && (
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Weight</p>
                  <p className="text-sm font-bold font-display">{product.weight_kg} kg</p>
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
