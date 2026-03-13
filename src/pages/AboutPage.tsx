import { Package, Search, Smile, ShieldCheck, Recycle, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { StorefrontLayout } from '@/components/StorefrontLayout';
import { usePageSeo } from '@/hooks/use-page-seo';
import { useStorefrontContent } from '@/hooks/useStorefrontContent';
import { ABOUT_DEFAULTS, type AboutContent } from '@/lib/content-defaults';

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  shieldCheck: ShieldCheck,
  search: Search,
  package: Package,
  smile: Smile,
};

export default function AboutPage() {
  usePageSeo({ title: 'About Us', description: 'Learn how Kuso Oishii rescues returned and damaged-box LEGO® sets from UK retailers and sells them at fair prices.', path: '/about' });

  const { data: content } = useStorefrontContent('about', ABOUT_DEFAULTS as unknown as Record<string, unknown>);
  const c = content as unknown as AboutContent;

  return (
    <StorefrontLayout>
      {/* Hero */}
      <section className="bg-kuso-ink py-20 md:py-28">
        <div className="container text-center max-w-3xl">
          <h1 className="font-display text-4xl md:text-5xl font-bold text-primary-foreground mb-6">
            {c.hero.heading}<span className="text-primary">.</span>
          </h1>
          <p className="font-body text-lg text-primary-foreground/70">
            {c.hero.description}
          </p>
        </div>
      </section>

      {/* Story */}
      <section className="py-16 md:py-20">
        <div className="container max-w-3xl">
          <h2 className="font-display text-3xl font-bold text-foreground mb-8">{c.storyHeading}</h2>
          <div className="space-y-5 font-body text-muted-foreground leading-relaxed">
            {c.storyParagraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </div>
      </section>

      {/* Difference */}
      <section className="py-16 md:py-20 bg-muted/30">
        <div className="container">
          <h2 className="font-display text-3xl font-bold text-foreground text-center mb-12">{c.differenceHeading}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-5xl mx-auto">
            {c.differenceCards.map(({ iconKey, title, desc }) => {
              const Icon = iconMap[iconKey] || ShieldCheck;
              return (
                <Card key={title} className="border-none shadow-md">
                  <CardContent className="p-6 text-center space-y-3">
                    <Icon className="h-10 w-10 mx-auto text-primary" />
                    <h3 className="font-display font-bold text-foreground text-lg">{title}</h3>
                    <p className="font-body text-sm text-muted-foreground">{desc}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-16 md:py-20">
        <div className="container max-w-4xl">
          <h2 className="font-display text-3xl font-bold text-foreground text-center mb-12">{c.howItWorksHeading}</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-center">
            {c.howItWorksSteps.map(({ title, desc }, i) => (
              <div key={i} className="space-y-4 relative">
                {i !== 0 && <ArrowRight className="hidden md:block absolute -left-4 top-8 h-6 w-6 text-muted-foreground/40" />}
                <div className="w-16 h-16 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-display text-2xl font-bold mx-auto">{i + 1}</div>
                <h3 className="font-display text-xl font-bold text-foreground">{title}</h3>
                <p className="font-body text-muted-foreground text-sm">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Sustainability */}
      <section className="py-16 md:py-20 bg-muted/30">
        <div className="container max-w-3xl text-center">
          <Recycle className="h-12 w-12 mx-auto text-primary mb-6" />
          <h2 className="font-display text-3xl font-bold text-foreground mb-6">{c.circular.heading}</h2>
          <p className="font-body text-muted-foreground leading-relaxed mb-8">
            {c.circular.description}
          </p>
          <Button asChild size="lg" className="font-display font-semibold">
            <Link to={c.circular.buttonLink}>{c.circular.buttonText}</Link>
          </Button>
        </div>
      </section>
    </StorefrontLayout>);
}
