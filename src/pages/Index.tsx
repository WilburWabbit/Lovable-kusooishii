import { Link } from "react-router-dom";
import { StorefrontLayout } from "@/components/StorefrontLayout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowRight, Star, Shield, Truck } from "lucide-react";
import heroImage from "@/assets/hero-lego.jpg";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const gradeLabels: Record<string, string> = {
  "1": "Mint",
  "2": "Excellent",
  "3": "Good",
  "4": "Acceptable",
};

export default function HomePage() {
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
      return (data as any[]).slice(0, 6);
    },
  });

  return (
    <StorefrontLayout>
      {/* Hero */}
      <section className="relative overflow-hidden bg-kuso-ink">
        <div className="absolute inset-0">
          <img
            src={heroImage}
            alt="Premium LEGO set with dramatic lighting"
            className="h-full w-full object-cover opacity-60"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-kuso-ink/90 via-kuso-ink/60 to-transparent" />
        </div>
        <div className="container relative z-10 py-24 lg:py-36">
          <div className="max-w-xl">
            <p className="font-display text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              Curated Resale
            </p>
            <h1 className="mt-4 font-display text-4xl font-bold leading-tight text-primary-foreground lg:text-6xl">
              Sets worth<br />
              collecting<span className="text-primary">.</span>
            </h1>
            <p className="mt-6 font-body text-base leading-relaxed text-primary-foreground/70 lg:text-lg">
              Graded, verified, and priced for adult collectors who know what they want. Every set condition-checked before it ships.
            </p>
            <div className="mt-8 flex gap-3">
              <Button asChild size="lg" className="font-display font-semibold">
                <Link to="/browse">
                  Browse Sets <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="border-primary-foreground/20 font-display font-semibold text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground">
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
            { icon: Shield, title: "Condition Graded", desc: "Every set inspected and rated 1–4" },
            { icon: Star, title: "Version Tracked", desc: "MPN version suffixes preserved" },
            { icon: Truck, title: "Club Collection", desc: "Free pickup at local LEGO clubs" },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="flex items-center gap-4 px-6 py-6">
              <Icon className="h-5 w-5 shrink-0 text-primary" />
              <div>
                <p className="font-display text-sm font-semibold text-foreground">{title}</p>
                <p className="font-body text-xs text-muted-foreground">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Featured Sets */}
      <section className="bg-background py-16 lg:py-24">
        <div className="container">
          <div className="flex items-end justify-between">
            <div>
              <p className="font-display text-xs font-semibold uppercase tracking-[0.2em] text-primary">Featured</p>
              <h2 className="mt-2 font-display text-2xl font-bold text-foreground lg:text-3xl">
                Latest arrivals
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
                  <Link
                    key={set.product_id}
                    to={`/sets/${set.mpn}`}
                    className="group relative flex flex-col overflow-hidden border border-border bg-card transition-all hover:shadow-md"
                  >
                    {/* Image */}
                    <div className="aspect-square bg-kuso-mist">
                      {set.img_url ? (
                        <img
                          src={set.img_url}
                          alt={set.name}
                          className="h-full w-full object-contain p-4"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center p-8">
                          <span className="font-display text-4xl font-bold text-muted-foreground/20">
                            {set.mpn.split("-")[0]}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Badges */}
                    <div className="absolute left-3 top-3 flex gap-1.5">
                      {set.retired_flag && (
                        <span className="bg-primary px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-wider text-primary-foreground">
                          Retired
                        </span>
                      )}
                      {set.best_grade && (
                        <span className="bg-foreground px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-wider text-background">
                          Grade {set.best_grade}
                        </span>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex flex-1 flex-col p-4">
                      <p className="font-body text-xs text-muted-foreground">
                        {set.theme_name ?? "Uncategorised"} · {set.mpn}
                      </p>
                      <h3 className="mt-1 font-display text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                        {set.name}
                      </h3>
                      <div className="mt-auto pt-3 flex items-baseline justify-between">
                        <span className="font-display text-lg font-bold text-foreground">
                          {set.min_price != null ? `£${Number(set.min_price).toFixed(2)}` : "—"}
                        </span>
                        <span className="font-body text-xs text-muted-foreground">
                          {set.best_grade ? gradeLabels[set.best_grade] ?? `Grade ${set.best_grade}` : ""}
                        </span>
                      </div>
                    </div>
                  </Link>
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
            Want something we don't have<span className="text-primary">?</span>
          </h2>
          <p className="mx-auto mt-4 max-w-md font-body text-sm text-muted-foreground">
            Add it to your wishlist. We track demand and source accordingly. Members get stock alerts when sets land.
          </p>
          <div className="mt-8">
            <Button asChild size="lg" className="font-display font-semibold">
              <Link to="/login">Create Account</Link>
            </Button>
          </div>
        </div>
      </section>
    </StorefrontLayout>
  );
}
