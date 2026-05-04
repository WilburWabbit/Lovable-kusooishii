import { Link } from "react-router-dom";
import { StorefrontLayout } from "@/components/StorefrontLayout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowRight, Shield, Truck, Bell } from "lucide-react";
import heroImage from "@/assets/hero-lego.jpg";
import logoImage from "@/assets/kuso-logo.png";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { BrowseCatalogCard, type BrowseCatalogItem } from "@/components/BrowseCatalogCard";
import { usePageSeo } from "@/hooks/use-page-seo";

export default function HomePage() {
  usePageSeo({
    title: "Kuso Oishii — LEGO® for Obsessive Grown-Ups",
    description: "Graded LEGO® sets and minifigures for adult collectors in the UK with clear condition grading and fair pricing.",
    path: "/"
  });
  const { data: featuredSets, isLoading } = useQuery({
    queryKey: ["featured_sets"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("browse_catalog", {
        search_term: null,
        filter_theme_id: null,
        filter_grade: null,
        filter_retired: null,
      });
      if (error) throw error;
      return ((data as BrowseCatalogItem[]) ?? [])
        .sort((a, b) => (b.release_year ?? 0) - (a.release_year ?? 0))
        .slice(0, 6);
    },
  });

  return (
    <StorefrontLayout>
      {/* Hero */}
      <section className="relative overflow-hidden bg-kuso-ink">
        <div className="absolute inset-0">
          <img
            src={heroImage}
            alt="Premium LEGO® set with dramatic lighting"
            className="h-full w-full object-cover opacity-60"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-kuso-ink/90 via-kuso-ink/60 to-transparent" />
        </div>
        <div className="container relative z-10 py-24 lg:py-36">
          <div className="max-w-xl">
            <p className="font-display text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              LEGO® for Obsessive Grown-Ups
            </p>
            <h1 className="mt-4 font-display text-4xl font-bold leading-tight text-primary-foreground lg:text-6xl">
              Sets worth<br />
              obsessing over<span className="text-primary">.</span>
            </h1>
            <p className="mt-6 font-body text-base leading-relaxed text-primary-foreground/70 lg:text-lg">
              Handpicked sets, obsessive condition grading, and none of the usual corporate fluff. Every set inspected by hand before it's listed. If it's in the shop, it's the real deal.
            </p>
            <div className="mt-8 flex gap-3">
              <Button asChild size="lg" className="font-display font-semibold">
                <Link to="/browse">
                  Browse Sets <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="border-primary font-display font-semibold text-primary hover:bg-primary hover:text-primary-foreground">
                <Link to="/grading">
                  How We Grade
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Value Props */}
      <section className="border-b border-border bg-background">
        <div className="container grid gap-0 divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {[
            { icon: Shield, title: "Condition Graded", desc: "Every set inspected and graded 1–5. No vague listings. No surprises.", iconClass: "text-primary", to: "/grading" },
            { icon: Truck, title: "Free UK Shipping", desc: "Standard on every order. Express available if you can't wait.", iconClass: "text-primary", to: "/shipping-policy" },
            { icon: Bell, title: "Blue Bell LEGO® Club", desc: "5% off for you. 5% donated to the Blue Bell.", iconClass: "text-blue-500", to: "/bluebell" },
          ].map(({ icon: Icon, title, desc, iconClass, to }) => (
            <Link key={title} to={to} className="flex items-center gap-4 px-6 py-6 transition-colors hover:bg-muted/50">
              <Icon className={`h-5 w-5 shrink-0 ${iconClass}`} />
              <div>
                <p className="font-display text-sm font-semibold text-foreground">{title}</p>
                <p className="font-body text-xs text-muted-foreground">{desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Featured Sets */}
      <section className="bg-background py-16 lg:py-24">
        <div className="container">
          <div className="flex items-end justify-between">
            <div>
              <p className="font-display text-xs font-semibold uppercase tracking-[0.2em] text-primary">New Arrivals</p>
              <h2 className="mt-2 font-display text-2xl font-bold text-foreground lg:text-3xl">
                Fresh picks
              </h2>
            </div>
            <Link
              to="/browse"
              className="hidden font-display text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:block"
            >
              View all →
            </Link>
          </div>

          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {isLoading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="border border-border">
                    <Skeleton className="aspect-square w-full rounded-none" />
                    <div className="space-y-2 p-4">
                      <Skeleton className="h-3 w-24" />
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-5 w-16" />
                    </div>
                  </div>
                ))
              : featuredSets?.map((set) => (
                  <BrowseCatalogCard key={set.product_id} item={set} />
                ))}
          </div>

          <div className="mt-8 text-center sm:hidden">
            <Link to="/browse" className="font-display text-sm font-medium text-primary">
              View all sets →
            </Link>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border bg-kuso-paper py-16 lg:py-24">
        <div className="container text-center">
          <h2 className="font-display text-2xl font-bold text-foreground lg:text-3xl">
            After something specific<span className="text-primary">?</span>
          </h2>
          <p className="mx-auto mt-4 max-w-md font-body text-sm text-muted-foreground">
            Add it to your wishlist and we'll go hunting. Members get stock alerts the moment a set lands. No spam. Just bricks.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="font-display font-semibold">
              <Link to="/signup">Create Account</Link>
            </Button>
            <Button
              asChild
              variant="outline"
              size="lg"
              className="border-primary bg-background font-display font-semibold text-primary hover:bg-primary hover:text-primary-foreground"
            >
              <Link to="/login">Sign In</Link>
            </Button>
          </div>
        </div>
      </section>
    </StorefrontLayout>
  );
}
