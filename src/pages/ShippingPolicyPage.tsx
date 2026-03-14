import { StorefrontLayout } from '@/components/StorefrontLayout';
import { usePageSeo } from '@/hooks/use-page-seo';

export default function ShippingPolicyPage() {
  usePageSeo({ title: 'Shipping Policy', description: 'UK shipping options, processing times, and packaging info for Kuso Oishii LEGO® orders.', path: '/shipping-policy' });

  return (
    <StorefrontLayout>
      <div className="container py-12 max-w-4xl">
        <h1 className="font-display text-4xl font-bold text-center mb-4 text-foreground">Shipping Policy</h1>
        <p className="font-body text-muted-foreground text-center mb-8">UK shipping from Brookville, Norfolk</p>

        <div className="space-y-8">
          <section>
            <h2 className="font-display text-2xl font-semibold mb-4 text-foreground">Shipping Options</h2>
            <div className="space-y-4">
              {[
                { title: 'Standard — Free', desc: 'Via Evri. Tracked delivery in 3–5 working days. Free on all orders — no minimum spend.' },
                { title: 'Express — Paid', desc: 'Via Royal Mail Tracked 24 or Parcelforce (depending on parcel size). 1–2 working days. Price calculated at checkout.' },
                { title: 'Collection — Free', desc: 'Collect for free at the Blue Bell LEGO® Club. Available at the next scheduled club meet.' },
              ].map(({ title, desc }) => (
                <div key={title} className="p-4 rounded-sm border border-border">
                  <h3 className="font-display font-semibold mb-2">{title}</h3>
                  <p className="font-body text-muted-foreground text-sm">{desc}</p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="font-display text-2xl font-semibold mb-4 text-foreground">Processing Time</h2>
            <p className="font-body text-muted-foreground">Orders are dispatched within 1–2 working days. We don't ship on weekends or bank holidays.</p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-semibold mb-4 text-foreground">Shipping Area</h2>
            <p className="font-body text-muted-foreground">We currently ship to mainland UK only. Scottish Highlands, Northern Ireland, and Channel Islands may incur additional charges. International shipping is not yet available.</p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-semibold mb-4 text-foreground">Packaging</h2>
            <p className="font-body text-muted-foreground">Every set is carefully packaged to prevent transit damage. We use recycled packaging materials where possible.</p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-semibold mb-4 text-foreground">Issues?</h2>
            <p className="font-body text-muted-foreground">If your order arrives damaged or goes missing, contact us at hello@kusooishii.com. We'll sort it.</p>
          </section>
        </div>
      </div>
    </StorefrontLayout>
  );
}
