import { StorefrontLayout } from '@/components/StorefrontLayout';
import { usePageSeo } from '@/hooks/use-page-seo';
import { useStorefrontContent } from '@/hooks/useStorefrontContent';
import { SHIPPING_DEFAULTS, type PolicyContent } from '@/lib/content-defaults';

export default function ShippingPolicyPage() {
  usePageSeo({ title: 'Shipping Policy', description: 'UK shipping options, processing times, and packaging info for Kuso Oishii LEGO® orders.', path: '/shipping-policy' });

  const { data: content } = useStorefrontContent('shipping', SHIPPING_DEFAULTS as unknown as Record<string, unknown>);
  const c = content as unknown as PolicyContent;

  return (
    <StorefrontLayout>
      <div className="container py-12 max-w-4xl">
        <h1 className="font-display text-4xl font-bold text-center mb-4 text-foreground">{c.pageTitle}</h1>
        <p className="font-body text-muted-foreground text-center mb-8">{c.pageSubtitle}</p>

        <div className="space-y-8">
          {c.sections.map((section) => (
            <section key={section.title}>
              <h2 className="font-display text-2xl font-semibold mb-4 text-foreground">{section.title}</h2>
              {section.body.split('\n\n').map((para, i) => (
                <p key={i} className="font-body text-muted-foreground mb-2 whitespace-pre-line">{para}</p>
              ))}
            </section>
          ))}
        </div>
      </div>
    </StorefrontLayout>
  );
}
