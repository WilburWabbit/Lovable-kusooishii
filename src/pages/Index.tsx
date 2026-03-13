import { Link } from "react-router-dom";
import { StorefrontLayout } from "@/components/StorefrontLayout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowRight, Shield, Truck, Bell } from "lucide-react";
import heroImage from "@/assets/hero-lego.jpg";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useStorefrontContent } from "@/hooks/useStorefrontContent";
import { HOME_DEFAULTS, type HomeContent } from "@/lib/content-defaults";

const gradeLabels: Record<string, string> = {
  "1": "Mint",
  "2": "Excellent",
  "3": "Good",
  "4": "Acceptable"
};

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  shield: Shield,
  truck: Truck,
  bell: Bell,
};

const iconClassMap: Record<string, string> = {
  shield: "text-primary",
  truck: "text-primary",
  bell: "text-blue-500",
};

export default function HomePage() {
  const { data: featuredSets, isLoading } = useQuery({
    queryKey: ["featured_sets"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("browse_catalog", {
        search_term: null,
        filter_theme_id: null,
        filter_grade: null,
        filter_retired: null
      });
      if (error) throw error;
      return (data as any[]).slice(0, 6);
    }
  });

  const { data: content } = useStorefrontContent('home', HOME_DEFAULTS as unknown as Record<string, unknown>);
  const c = content as unknown as HomeContent;

  return (
    <StorefrontLayout>
      {/* Hero */}
      <section className="relative overflow-hidden bg-kuso-ink">
        <div className="absolute inset-0">
          <img
            src={heroImage}
            alt="Premium LEGO set with dramatic lighting"
            className="h-full w-full object-cover opacity-60" />
          <div className="absolute inset-0 bg-gradient-to-r from-kuso-ink/90 via-kuso-ink/60 to-transparent" />
        </div>
        <div className="container relative z-10 py-24 lg:py-36">
          <div className="max-w-xl">
            <p className="font-display font-semibold uppercase tracking-[0.2em] text-primary text-lg">
              {c.hero.tagline}
            </p>
            <h1 className="mt-4 font-display text-4xl font-bold leading-tight text-primary-foreground lg:text-6xl">
              {c.hero.heading.replace(/\.$/, '')}<span className="text-primary">.</span>
            </h1>
            <p className="mt-6 font-body text-base leading-relaxed text-primary-foreground/70 lg:text-lg">
              {c.hero.description}
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
          {c.valueProps.map(({ title, desc, iconKey }) => {
            const Icon = iconMap[iconKey] || Shield;
            const iconClass = iconClassMap[iconKey] || "text-primary";
            return (
              <div key={title} className="flex items-center gap-4 px-6 py-6">
                <Icon className={`h-5 w-5 shrink-0 ${iconClass}`} />
                <div>
                  <p className="font-display font-semibold text-foreground text-base">{title}</p>
                  <p className="font-body text-muted-foreground text-sm">{desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Featured Sets */}
      <section className="bg-background py-16 lg:py-24">
        <div className="container">
          <div className="flex items-end justify-between">
            <div>
              <p className="font-display font-semibold uppercase tracking-[0.2em] text-primary text-sm">Featured</p>
              <h2 className="mt-2 font-display text-2xl font-bold text-foreground lg:text-3xl">
                Latest arrivals
              </h2>
            </div>
            <Link
              to="/browse"
              className="hidden font-display text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:block">
              View all →
            </Link>
          </div>

          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {isLoading ?
            Array.from({ length: 6 }).map((_, i) =>
            <div key={i} className="border border-border">
                    <Skeleton className="aspect-square w-full rounded-none" />
                    <div className="space-y-2 p-4">
                      <Skeleton className="h-3 w-24" />
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-5 w-16" />
                    </div>
                  </div>
            ) :
            featuredSets?.map((set) =>
            <Link
              key={set.product_id}
              to={`/sets/${set.mpn}`}
              className="group relative flex flex-col overflow-hidden border border-border bg-card transition-all hover:shadow-md">
                    {/* Image */}
                    <div className="aspect-square bg-background">
                      {set.img_url ?
                <img
                  src={set.img_url}
                  alt={set.name}
                  className="h-full w-full object-contain p-4" /> :
                <div className="flex h-full items-center justify-center p-8">
                          <span className="font-display text-4xl font-bold text-muted-foreground/20">
                            {set.mpn.split("-")[0]}
                          </span>
                        </div>
                }
                    </div>

                    {/* Badges */}
                    <div className="absolute left-3 top-3 flex gap-1.5">
                      {set.retired_flag &&
                <span className="bg-primary px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-wider text-primary-foreground">
                          Retired
                        </span>
                }
                      {set.best_grade &&
                <span className="bg-foreground px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-wider text-background">
                          Grade {set.best_grade}
                        </span>
                }
                    </div>

                    {/* Info */}
                    <div className="flex flex-1 flex-col p-4">
                      <h3 className="font-display font-semibold text-foreground group-hover:text-primary transition-colors text-lg">
                        {set.name}
                      </h3>
                      <p className="mt-1 font-body text-muted-foreground text-sm">
                        {set.theme_name ?? "Uncategorised"} · {set.mpn}
                      </p>
                      <div className="mt-auto pt-3 flex items-baseline justify-between">
                        <span className="font-display text-lg font-bold text-foreground">
                          {set.min_price != null ? `£${Number(set.min_price).toFixed(2)}` : "—"}
                        </span>
                        <span className="font-body text-muted-foreground text-sm">
                          {set.best_grade ? gradeLabels[set.best_grade] ?? `Grade ${set.best_grade}` : ""}
                        </span>
                      </div>
                    </div>
                  </Link>
            )}
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
            {c.cta.heading}<span className="text-primary">?</span>
          </h2>
          <p className="mx-auto mt-4 max-w-md font-body text-muted-foreground text-base">
            {c.cta.description}
          </p>
          <div className="mt-8">
            <Button asChild size="lg" className="font-display font-semibold">
              <Link to={c.cta.buttonLink}>{c.cta.buttonText}</Link>
            </Button>
          </div>
        </div>
      </section>
    </StorefrontLayout>);
}
