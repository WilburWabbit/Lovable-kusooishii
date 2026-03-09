import { StorefrontLayout } from "@/components/StorefrontLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "react-router-dom";
import { Search, SlidersHorizontal } from "lucide-react";

const mockSets = [
  { mpn: "75367-1", name: "Venator-Class Republic Attack Cruiser", theme: "Star Wars", grade: 1, price: 649.99, retired: true, stock: 1 },
  { mpn: "10497-1", name: "Galaxy Explorer", theme: "Icons", grade: 2, price: 119.99, retired: false, stock: 3 },
  { mpn: "21330-1", name: "Home Alone", theme: "Ideas", grade: 1, price: 349.99, retired: true, stock: 1 },
  { mpn: "42151-1", name: "Bugatti Bolide", theme: "Technic", grade: 1, price: 54.99, retired: false, stock: 5 },
  { mpn: "10305-1", name: "Lion Knights' Castle", theme: "Icons", grade: 2, price: 449.99, retired: true, stock: 1 },
  { mpn: "75341-1", name: "Luke Skywalker's Landspeeder", theme: "Star Wars", grade: 1, price: 249.99, retired: true, stock: 2 },
  { mpn: "21334-1", name: "Jazz Quartet", theme: "Ideas", grade: 3, price: 89.99, retired: false, stock: 4 },
  { mpn: "76240-1", name: "Daily Bugle", theme: "Marvel", grade: 1, price: 399.99, retired: true, stock: 1 },
  { mpn: "10300-1", name: "Back to the Future Time Machine", theme: "Icons", grade: 2, price: 199.99, retired: false, stock: 2 },
];

const themes = ["All", "Star Wars", "Icons", "Ideas", "Technic", "Marvel"];
const grades = ["All", "1 — Mint", "2 — Excellent", "3 — Good", "4 — Acceptable"];

const gradeLabels: Record<number, string> = {
  1: "Mint", 2: "Excellent", 3: "Good", 4: "Acceptable",
};

export default function BrowsePage() {
  return (
    <StorefrontLayout>
      <div className="bg-background">
        {/* Header */}
        <div className="border-b border-border bg-kuso-paper py-8">
          <div className="container">
            <h1 className="font-display text-2xl font-bold text-foreground">Browse Sets</h1>
            <p className="mt-1 font-body text-sm text-muted-foreground">
              {mockSets.length} sets available · condition graded · version tracked
            </p>
          </div>
        </div>

        <div className="container py-8">
          <div className="flex flex-col gap-8 lg:flex-row">
            {/* Filters sidebar */}
            <aside className="w-full shrink-0 lg:w-56">
              <div className="flex items-center gap-2 lg:hidden">
                <Button variant="outline" size="sm" className="font-display text-xs">
                  <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" /> Filters
                </Button>
              </div>

              <div className="hidden space-y-6 lg:block">
                {/* Search */}
                <div>
                  <label className="font-display text-xs font-semibold uppercase tracking-widest text-foreground">
                    Search
                  </label>
                  <div className="relative mt-2">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Set name or MPN..." className="pl-8 font-body text-sm" />
                  </div>
                </div>

                {/* Theme filter */}
                <div>
                  <label className="font-display text-xs font-semibold uppercase tracking-widest text-foreground">
                    Theme
                  </label>
                  <div className="mt-2 flex flex-col gap-1">
                    {themes.map((t) => (
                      <button
                        key={t}
                        className={`rounded px-2 py-1.5 text-left font-body text-sm transition-colors ${
                          t === "All"
                            ? "bg-foreground text-background"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Grade filter */}
                <div>
                  <label className="font-display text-xs font-semibold uppercase tracking-widest text-foreground">
                    Condition
                  </label>
                  <div className="mt-2 flex flex-col gap-1">
                    {grades.map((g) => (
                      <button
                        key={g}
                        className={`rounded px-2 py-1.5 text-left font-body text-sm transition-colors ${
                          g === "All"
                            ? "bg-foreground text-background"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        }`}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Retired toggle */}
                <div>
                  <label className="font-display text-xs font-semibold uppercase tracking-widest text-foreground">
                    Status
                  </label>
                  <div className="mt-2 flex gap-1">
                    <button className="rounded bg-foreground px-3 py-1.5 font-body text-xs text-background">All</button>
                    <button className="rounded px-3 py-1.5 font-body text-xs text-muted-foreground hover:bg-muted">Retired</button>
                    <button className="rounded px-3 py-1.5 font-body text-xs text-muted-foreground hover:bg-muted">Current</button>
                  </div>
                </div>
              </div>
            </aside>

            {/* Product grid */}
            <div className="flex-1">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {mockSets.map((set) => (
                  <Link
                    key={set.mpn}
                    to={`/sets/${set.mpn}`}
                    className="group relative flex flex-col overflow-hidden border border-border bg-card transition-all hover:shadow-md"
                  >
                    <div className="aspect-square bg-kuso-mist p-6">
                      <div className="flex h-full items-center justify-center">
                        <span className="font-display text-3xl font-bold text-muted-foreground/20">
                          {set.mpn.split("-")[0]}
                        </span>
                      </div>
                    </div>

                    <div className="absolute left-2 top-2 flex gap-1">
                      {set.retired && (
                        <span className="bg-primary px-1.5 py-0.5 font-display text-[9px] font-bold uppercase tracking-wider text-primary-foreground">
                          Retired
                        </span>
                      )}
                      <span className="bg-foreground px-1.5 py-0.5 font-display text-[9px] font-bold uppercase tracking-wider text-background">
                        G{set.grade}
                      </span>
                    </div>

                    <div className="flex flex-1 flex-col p-3">
                      <p className="font-body text-[11px] text-muted-foreground">{set.theme} · {set.mpn}</p>
                      <h3 className="mt-0.5 font-display text-sm font-semibold text-foreground group-hover:text-primary transition-colors line-clamp-2">
                        {set.name}
                      </h3>
                      <div className="mt-auto flex items-baseline justify-between pt-2">
                        <span className="font-display text-base font-bold text-foreground">£{set.price.toFixed(2)}</span>
                        <span className="font-body text-[11px] text-muted-foreground">
                          {set.stock} in stock
                        </span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </StorefrontLayout>
  );
}
