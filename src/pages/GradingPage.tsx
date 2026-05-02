import { Link } from "react-router-dom";
import { StorefrontLayout } from "@/components/StorefrontLayout";
import { Button } from "@/components/ui/button";
import { useSeoDocumentPageSeo } from "@/hooks/use-seo-document";
import { GRADE_DETAILS } from "@/lib/grades";
import { pageBreadcrumbJsonLd } from "@/lib/seo-jsonld";
import { ArrowRight } from "lucide-react";

const grades = Object.entries(GRADE_DETAILS).map(([key, val]) => ({
  grade: key,
  ...val,
}));

export default function GradingPage() {
  useSeoDocumentPageSeo("route:/grading", {
    title: "How We Grade",
    description: "Our 1–5 grading scale explained. Every LEGO® set is inspected and condition-rated before listing.",
    path: "/grading",
    jsonLd: pageBreadcrumbJsonLd("How We Grade", "/grading"),
  });

  return (
    <StorefrontLayout>
      <div className="bg-background">
        {/* Hero */}
        <div className="border-b border-border bg-kuso-paper py-12 lg:py-16">
          <div className="container max-w-3xl text-center">
            <p className="font-display text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              No Surprises
            </p>
            <h1 className="mt-3 font-display text-3xl font-bold text-foreground lg:text-4xl">
              How We Grade
            </h1>
            <p className="mx-auto mt-4 max-w-lg font-body text-sm leading-relaxed text-muted-foreground">
              Every set is inspected by hand and assigned a grade from 1 to 5.
              The grade covers the box, the contents, and whether everything's there — not the
              bricks themselves, which are always genuine LEGO®.
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
                <img
                  src={g.icon}
                  alt={`Grade ${g.grade} — ${g.label}`}
                  className="h-10 w-10 shrink-0 object-contain"
                />
                <div>
                  <h2 className="font-display text-base font-bold text-foreground">
                    Grade {g.grade} — {g.label}
                  </h2>
                  <p className="mt-1 font-body text-sm leading-relaxed text-muted-foreground">
                    {g.longDesc}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-12 rounded bg-kuso-paper p-6 text-center">
            <p className="font-body text-sm text-muted-foreground">
              Every brick is genuine LEGO®, sourced from authorised UK retailers.
              Grading covers packaging and completeness — the bricks are always the real deal.
            </p>
          </div>

          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Button asChild size="lg" className="font-display font-semibold">
              <Link to="/browse">
                Browse Sets <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="font-display">
              <Link to="/faq">Read the FAQ</Link>
            </Button>
          </div>
        </div>
      </div>
    </StorefrontLayout>
  );
}
