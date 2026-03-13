import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { AlertCircle, AlertTriangle, ChevronDown } from "lucide-react";
import type { ProductDetail, ChannelListing } from "./types";

interface Issue {
  severity: "error" | "warning";
  message: string;
  tab: string;
}

interface ProductIssuesBannerProps {
  product: ProductDetail;
  onNavigateToTab: (tab: string) => void;
}

function computeIssues(product: ProductDetail): Issue[] {
  const issues: Issue[] = [];

  if (!product.name) {
    issues.push({ severity: "error", message: "Missing product name", tab: "content-media" });
  }
  if (!product.description) {
    issues.push({ severity: "warning", message: "Missing description", tab: "content-media" });
  }
  if (!product.product_hook) {
    issues.push({ severity: "warning", message: "Missing product hook", tab: "content-media" });
  }
  if (product.seo_title && product.seo_title.length > 60) {
    issues.push({ severity: "warning", message: `SEO title exceeds 60 chars (${product.seo_title.length})`, tab: "content-media" });
  }
  if (product.seo_description && product.seo_description.length > 160) {
    issues.push({ severity: "warning", message: `SEO description exceeds 160 chars (${product.seo_description.length})`, tab: "content-media" });
  }
  if (product.product_hook && product.product_hook.length > 160) {
    issues.push({ severity: "warning", message: `Product hook exceeds 160 chars (${product.product_hook.length})`, tab: "content-media" });
  }
  if (product.call_to_action && product.call_to_action.length > 80) {
    issues.push({ severity: "warning", message: `CTA exceeds 80 chars (${product.call_to_action.length})`, tab: "content-media" });
  }

  // eBay title check across all listings
  const allListings: ChannelListing[] = product.skus.flatMap((s) => s.channel_listings);
  for (const cl of allListings) {
    if (cl.channel === "ebay" && cl.listing_title && cl.listing_title.length > 80) {
      issues.push({
        severity: "warning",
        message: `eBay title exceeds 80 chars on ${cl.external_sku} (${cl.listing_title.length})`,
        tab: "channels",
      });
    }
    if (cl.listed_price != null && cl.price_floor != null && cl.listed_price < cl.price_floor) {
      issues.push({
        severity: "error",
        message: `${cl.external_sku} listed at £${cl.listed_price.toFixed(2)} — below floor £${cl.price_floor.toFixed(2)}`,
        tab: "channels",
      });
    }
  }

  return issues;
}

export function ProductIssuesBanner({ product, onNavigateToTab }: ProductIssuesBannerProps) {
  const [open, setOpen] = useState(false);
  const issues = computeIssues(product);

  if (issues.length === 0) return null;

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const hasErrors = errors.length > 0;

  return (
    <Alert variant={hasErrors ? "destructive" : "default"} className="py-2">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex items-center gap-2 w-full text-left">
          {hasErrors ? (
            <AlertCircle className="h-4 w-4 shrink-0" />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0" />
          )}
          <AlertDescription className="flex-1 text-sm font-medium">
            {issues.length} issue{issues.length !== 1 ? "s" : ""} found
            {errors.length > 0 && (
              <Badge variant="destructive" className="ml-2 text-[10px] px-1.5 py-0">
                {errors.length} error{errors.length !== 1 ? "s" : ""}
              </Badge>
            )}
            {warnings.length > 0 && (
              <Badge variant="outline" className="ml-1 text-[10px] px-1.5 py-0">
                {warnings.length} warning{warnings.length !== 1 ? "s" : ""}
              </Badge>
            )}
          </AlertDescription>
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 space-y-1">
            {issues.map((issue, i) => (
              <button
                key={i}
                className="flex items-center gap-2 w-full text-left text-xs py-0.5 hover:underline"
                onClick={() => onNavigateToTab(issue.tab)}
              >
                {issue.severity === "error" ? (
                  <AlertCircle className="h-3 w-3 text-destructive shrink-0" />
                ) : (
                  <AlertTriangle className="h-3 w-3 text-yellow-600 dark:text-yellow-400 shrink-0" />
                )}
                <span>{issue.message}</span>
              </button>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Alert>
  );
}
