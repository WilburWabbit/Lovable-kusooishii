import { StorefrontLayout } from '@/components/StorefrontLayout';
import { usePageSeo } from '@/hooks/use-page-seo';

export default function ReturnsPage() {
  usePageSeo({ title: 'Returns & Exchanges', description: 'Return policy for Kuso Oishii LEGO® sets. 14-day returns, missing pieces policy, and how to start a return.', path: '/returns-exchanges' });

  return (
    <StorefrontLayout>
      <div className="container py-12 max-w-4xl">
        <h1 className="font-display text-4xl font-bold text-center mb-4 text-foreground">Returns & Exchanges</h1>
        <p className="font-body text-muted-foreground text-center mb-8">Straight talk on returns — no waffle</p>

        <div className="space-y-8">
          <section>
            <h2 className="font-display text-2xl font-semibold mb-4 text-foreground">Return Policy</h2>
            <p className="font-body text-muted-foreground mb-4">We sell rescued stock at fair prices. Here's how returns work:</p>
            <div className="space-y-4">
              <div className="p-4 rounded-sm border-l-4 border-l-green-500 bg-card">
                <h3 className="font-display font-semibold mb-2">Sealed Sets</h3>
                <p className="font-body text-sm text-muted-foreground">Return within 14 days in original condition for a full refund. Return shipping is on you unless the item was misdescribed.</p>
              </div>
              <div className="p-4 rounded-sm border-l-4 border-l-amber-500 bg-card">
                <h3 className="font-display font-semibold mb-2">Open-Box Sets</h3>
                <p className="font-body text-sm text-muted-foreground">Sold as-described. Please read condition notes before buying. Returns only if the item doesn't match our description.</p>
              </div>
              <div className="p-4 rounded-sm border-l-4 border-l-destructive bg-card">
                <h3 className="font-display font-semibold mb-2">Damaged-Box Sets</h3>
                <p className="font-body text-sm text-muted-foreground">Sold as-described. Box damage is cosmetic — we tell you exactly what to expect. Returns only if contents don't match our notes.</p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="font-display text-2xl font-semibold mb-4 text-foreground">How to Return</h2>
            <div className="space-y-4">
              {[
                { n: '1', title: 'Email Us', desc: 'Contact hello@kusooishii.com with your order number and reason for return.' },
                { n: '2', title: "We'll Confirm", desc: "We'll let you know if your return is eligible and send instructions." },
                { n: '3', title: 'Ship It Back', desc: 'Send the item back to us. We recommend tracked postage.' },
                { n: '4', title: 'Refund', desc: 'Refund processed within 3–5 working days of receiving the item.' },
              ].map(({ n, title, desc }) => (
                <div key={n} className="flex items-start gap-4">
                  <span className="shrink-0 w-8 h-8 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-display font-semibold text-sm">{n}</span>
                  <div>
                    <h3 className="font-display font-semibold mb-1">{title}</h3>
                    <p className="font-body text-muted-foreground text-sm">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="font-display text-2xl font-semibold mb-4 text-foreground">Missing Pieces?</h2>
            <p className="font-body text-muted-foreground">If we said it's complete and something's missing, that's on us. Get in touch and we'll make it right — replacement parts, partial refund, or full return. No arguments.</p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-semibold mb-4 text-foreground">Your Statutory Rights</h2>
            <p className="font-body text-muted-foreground">Nothing in this policy affects your statutory consumer rights under UK law.</p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-semibold mb-4 text-foreground">Contact</h2>
            <ul className="space-y-2 font-body text-muted-foreground text-sm">
              <li>Email: hello@kusooishii.com</li>
              <li>Location: Brookville, Norfolk, UK</li>
            </ul>
          </section>
        </div>
      </div>
    </StorefrontLayout>
  );
}
