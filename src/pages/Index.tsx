import { Link } from "react-router-dom";
import { StorefrontLayout } from "@/components/StorefrontLayout";
import { Button } from "@/components/ui/button";
import { ArrowRight, Star, Shield, Truck } from "lucide-react";
import heroImage from "@/assets/hero-lego.jpg";

// Mock featured products
const featuredSets = [
  { mpn: "75367-1", name: "Venator-Class Republic Attack Cruiser", theme: "Star Wars", grade: 1, price: 649.99, retired: true },
  { mpn: "10497-1", name: "Galaxy Explorer", theme: "Icons", grade: 2, price: 119.99, retired: false },
  { mpn: "21330-1", name: "Home Alone", theme: "Ideas", grade: 1, price: 349.99, retired: true },
  { mpn: "42151-1", name: "Bugatti Bolide", theme: "Technic", grade: 1, price: 54.99, retired: false },
  { mpn: "10305-1", name: "Lion Knights' Castle", theme: "Icons", grade: 2, price: 449.99, retired: true },
  { mpn: "75341-1", name: "Luke Skywalker's Landspeeder", theme: "Star Wars", grade: 1, price: 249.99, retired: true },
];

const gradeLabels: Record<number, string> = {
  1: "Mint",
  2: "Excellent",
  3: "Good",
  4: "Acceptable",
};

export default function HomePage() {
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
            {featuredSets.map((set) => (
              <Link
                key={set.mpn}
                to={`/sets/${set.mpn}`}
                className="group relative flex flex-col overflow-hidden border border-border bg-card transition-all hover:shadow-md"
              >
                {/* Image placeholder */}
                <div className="aspect-square bg-kuso-mist p-8">
                  <div className="flex h-full items-center justify-center">
                    <span className="font-display text-4xl font-bold text-muted-foreground/20">
                      {set.mpn.split("-")[0]}
                    </span>
                  </div>
                </div>

                {/* Badges */}
                <div className="absolute left-3 top-3 flex gap-1.5">
                  {set.retired && (
                    <span className="bg-primary px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-wider text-primary-foreground">
                      Retired
                    </span>
                  )}
                  <span className="bg-foreground px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-wider text-background">
                    Grade {set.grade}
                  </span>
                </div>

                {/* Info */}
                <div className="flex flex-1 flex-col p-4">
                  <p className="font-body text-xs text-muted-foreground">{set.theme} · {set.mpn}</p>
                  <h3 className="mt-1 font-display text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                    {set.name}
                  </h3>
                  <div className="mt-auto pt-3 flex items-baseline justify-between">
                    <span className="font-display text-lg font-bold text-foreground">
                      £{set.price.toFixed(2)}
                    </span>
                    <span className="font-body text-xs text-muted-foreground">
                      {gradeLabels[set.grade]}
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
