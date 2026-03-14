import { Link } from "react-router-dom";
import { StorefrontLayout } from "@/components/StorefrontLayout";
import { Button } from "@/components/ui/button";
import { usePageSeo } from "@/hooks/use-page-seo";
import { GRADE_DETAILS } from "@/lib/grades";
import { ArrowRight } from "lucide-react";

const grades = Object.entries(GRADE_DETAILS).map(([key, val]) => ({
  grade: key,
  ...val,
}));

export default function GradingPage() {
  usePageSeo({
    title: "How We Grade",
    description: "Our 1–5 grading scale explained. Every LEGO® set is inspected and condition-rated before listing.",
    path: "/grading",
  });

  return (
    <StorefrontLayout>
      <div className="bg-background">
        {/* Hero */}
        <div className="border-b border-border bg-kuso-paper py-12 lg:py-16">
          <div className="container max-w-3xl text-center">
            <p className="font-display text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              Transparency
            </p>
            <h1 className="mt-3 font-display text-3xl font-bold text-foreground lg:text-4xl">
              How We Grade
            </h1>
            <p className="mx-auto mt-4 max-w-lg font-body text-sm leading-relaxed text-muted-foreground">
              Every set is inspected by hand and assigned a grade from 1 (Mint) to 5 (Fair).
              The grade reflects the condition of the box, contents, and completeness — not the
              quality of the LEGO® bricks themselves, which are always genuine.
            </p>
          </div>
        </div>

        {/* Grade scale */}
        <div className="container max-w-3xl py-12 lg:py-16">
          <div className="space-y-4">
            {grades.map((g) => (
              <div
                key={g.grade}
                className="flex items-start gap-4 border border-border p-5 transition-colors hover:border-primary"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center bg-foreground font-display text-sm font-bold text-background">
                  G{g.grade}
                </div>
                <div>
                  <h2 className="font-display text-base font-bold text-foreground">
                    Grade {g.grade} — {g.label}
                  </h2>
                  <p className="mt-1 font-body text-sm leading-relaxed text-muted-foreground">
                    {g.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-12 rounded bg-kuso-paper p-6 text-center">
            <p className="font-body text-sm text-muted-foreground">
              All LEGO® bricks are genuine and sourced from authorised UK retailers.
              Grading applies to packaging and completeness only.
            </p>
          </div>

          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Button asChild size="lg" className="font-display font-semibold">
              <Link to="/browse">
                Browse Graded Sets <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="font-display">
              <Link to="/faq">Read Our FAQ</Link>
            </Button>
          </div>
        </div>
      </div>
    </StorefrontLayout>
  );
}
