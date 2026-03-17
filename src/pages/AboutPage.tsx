import { Package, Search, Smile, ShieldCheck, Recycle, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { StorefrontLayout } from '@/components/StorefrontLayout';
import { usePageSeo } from '@/hooks/use-page-seo';

export default function AboutPage() {
  usePageSeo({ title: 'About Us', description: 'Learn how Kuso Oishii rescues returned and damaged-box LEGO® sets from UK retailers and sells them at fair prices.', path: '/about' });

  return (
    <StorefrontLayout>
      {/* Hero */}
      <section className="bg-kuso-ink py-20 md:py-28">
        <div className="container text-center max-w-3xl">
          <h1 className="font-display text-4xl md:text-5xl font-bold text-primary-foreground mb-6">
            We rescue LEGO® sets that retailers gave up on<span className="text-primary">.</span>
          </h1>
          <p className="font-body text-lg text-primary-foreground/70">
            Returned stock. Dented boxes. Open bags. Perfectly good bricks heading for limbo. We grab them, inspect them properly, and sell them to people who actually want to build.
          </p>
        </div>
      </section>

      {/* Story */}
      <section className="py-16 md:py-20">
        <div className="container max-w-3xl">
          <h2 className="font-display text-3xl font-bold text-foreground mb-8">The Story</h2>
          <div className="space-y-5 font-body text-muted-foreground leading-relaxed">
            <p>Here's what happens when you return a LEGO® set to a big retailer: they open the box to check it, slap a "returned" sticker on it, and it goes into a warehouse where nobody quite knows what to do with it. The box might have a dent. A bag might be open. Most times, the set is still in mint condition. Either way, there's nothing actually wrong with the bricks — but the retailer can't sell it as new, so it sits there until the inevitable happens and it gets thrown into a skip.    </p>
            <p>That's where we come in. Kuso Oishii buys that stock from UK retailers, wholesalers, and trusted collectors. We inspect every set — weigh sealed bags, hand-count open ones, photograph the box condition, and write up honest notes so you know exactly what you're getting.</p>
            <p>It's circular commerce without the greenwash. We're not saving the planet — we're just making sure perfectly good LEGO® doesn't go to waste. And you get sets at fair prices without the "is this legit?" anxiety.</p>
          </div>
        </div>
      </section>

      {/* Difference */}
      <section className="py-16 md:py-20 bg-muted/30">
        <div className="container">
          <h2 className="font-display text-3xl font-bold text-foreground text-center mb-12">The Kuso Oishii Difference</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-5xl mx-auto">
            {[
            { icon: ShieldCheck, title: 'Radical Honesty', desc: "Every set has detailed condition notes. Dented box? We'll say so. Missing a minifig arm? You'll know before you buy." },
            { icon: Search, title: 'Collector Detail', desc: 'Set numbers, minifig IDs, bag-by-bag inspection notes. We speak AFOL because we are AFOLs.' },
            { icon: Package, title: 'Fair Prices', desc: "No markup games. No 'rare find' surcharges. Rescued stock at rescued prices. Simple." },
            { icon: Smile, title: 'No Corporate Waffle', desc: "We don't 'elevate experiences.' We sell LEGO®. You build it. Everyone's happy." }].
            map(({ icon: Icon, title, desc }) =>
            <Card key={title} className="border-none shadow-md">
                <CardContent className="p-6 text-center space-y-3">
                  <Icon className="h-10 w-10 mx-auto text-primary" />
                  <h3 className="font-display font-bold text-foreground text-lg">{title}</h3>
                  <p className="font-body text-sm text-muted-foreground">{desc}</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-16 md:py-20">
        <div className="container max-w-4xl">
          <h2 className="font-display text-3xl font-bold text-foreground text-center mb-12">How It Works</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-center">
            {[
            { n: '1', title: 'We Source', desc: 'Returned, open-box, and damaged-box LEGO® sets from authorised UK retailers. Every set is genuine.' },
            { n: '2', title: 'We Inspect', desc: 'Sealed bags get weighed. Open bags get hand-counted. Box condition photographed. Honest notes written.' },
            { n: '3', title: 'You Build', desc: "Pick your set, read the condition notes, and get building. No surprises, no anxiety, just bricks." }].
            map(({ n, title, desc }) =>
            <div key={n} className="space-y-4 relative">
                {n !== '1' && <ArrowRight className="hidden md:block absolute -left-4 top-8 h-6 w-6 text-muted-foreground/40" />}
                <div className="w-16 h-16 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-display text-2xl font-bold mx-auto">{n}</div>
                <h3 className="font-display text-xl font-bold text-foreground">{title}</h3>
                <p className="font-body text-muted-foreground text-sm">{desc}</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Sustainability */}
      <section className="py-16 md:py-20 bg-muted/30">
        <div className="container max-w-3xl text-center">
          <Recycle className="h-12 w-12 mx-auto text-primary mb-6" />
          <h2 className="font-display text-3xl font-bold text-foreground mb-6">Circular, Not Preachy</h2>
          <p className="font-body text-muted-foreground leading-relaxed mb-8">
            Every set we sell is one that didn't end up in clearance limbo or worse. We're not planting trees or offsetting carbon — we're just keeping good LEGO® in circulation. That's it. No manifesto required.
          </p>
          <Button asChild size="lg" className="font-display font-semibold">
            <Link to="/browse">Browse the Rescued Stock</Link>
          </Button>
        </div>
      </section>
    </StorefrontLayout>);

}