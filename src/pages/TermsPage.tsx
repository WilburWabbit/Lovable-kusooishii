import { StorefrontLayout } from '@/components/StorefrontLayout';
import { usePageSeo } from '@/hooks/use-page-seo';

export default function TermsPage() {
  usePageSeo({ title: 'Terms of Service', description: 'Terms and conditions for using the Kuso Oishii website and purchasing LEGO® sets.', path: '/terms' });

  return (
    <StorefrontLayout>
      <div className="container py-12 max-w-4xl">
        <div className="text-center mb-12">
          <h1 className="font-display text-4xl font-bold text-foreground mb-4">Terms of Service</h1>
          <p className="font-body text-muted-foreground">Last updated: {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>

        <div className="bg-card rounded-sm border border-border p-8 space-y-8">
          {[
            { title: '1. Acceptance of Terms', content: 'By accessing and using Kuso Oishii ("we," "our," or "us"), you accept and agree to be bound by these terms. We\'re based in Brookville, Norfolk, UK.' },
            { title: '2. Product Information & Condition', content: 'We sell rescued LEGO® stock — returned, open-box, and damaged-box items from UK retailers. Every set includes honest condition notes. We describe what we know, we don\'t embellish, and we don\'t hide damage.' },
            { title: '3. Pricing', content: 'All prices are in GBP (£) and include VAT where applicable. Prices may change without notice.' },
            { title: '4. Shipping', content: 'We ship within the UK via Evri, Royal Mail, and Parcelforce. Free standard shipping on all orders. Delivery times are estimates and not guaranteed.' },
            { title: '5. Returns', content: 'Sealed items may be returned within 14 days in original condition. Open-box and damaged-box items are sold as-described — please read condition notes carefully. Statutory consumer rights under UK law are not affected.' },
            { title: '6. Intellectual Property', content: 'LEGO® is a trademark of the LEGO® Group of companies, which does not sponsor, authorise or endorse this site. All site content is © Kuso Oishii.' },
            { title: '7. Governing Law', content: 'These terms are governed by the laws of England and Wales.' },
          ].map(({ title, content }) => (
            <div key={title}>
              <h2 className="font-display text-xl font-semibold mb-3 text-foreground">{title}</h2>
              <p className="font-body text-muted-foreground text-sm leading-relaxed">{content}</p>
            </div>
          ))}

          <div>
            <h2 className="font-display text-xl font-semibold mb-3 text-foreground">8. Contact</h2>
            <div className="bg-muted rounded-sm p-4">
              <p className="font-display font-medium text-sm">Kuso Oishii</p>
              <p className="font-body text-muted-foreground text-sm">Email: hello@kusooishii.com</p>
              <p className="font-body text-muted-foreground text-sm">Location: Brookville, Norfolk, UK</p>
            </div>
          </div>
        </div>
      </div>
    </StorefrontLayout>
  );
}
