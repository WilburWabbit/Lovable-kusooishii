import { StorefrontLayout } from '@/components/StorefrontLayout';
import { usePageSeo } from '@/hooks/use-page-seo';

export default function PrivacyPage() {
  usePageSeo({ title: 'Privacy Policy', description: 'How Kuso Oishii collects, uses, and protects your personal data under UK GDPR.', path: '/privacy' });

  return (
    <StorefrontLayout>
      <div className="container py-12 max-w-4xl">
        <div className="text-center mb-12">
          <h1 className="font-display text-4xl font-bold text-foreground mb-4">Privacy Policy</h1>
          <p className="font-body text-muted-foreground">Last updated: {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>

        <div className="bg-card rounded-sm border border-border p-8 space-y-8">
          <div>
            <h2 className="font-display text-xl font-semibold mb-3 text-foreground">Who We Are</h2>
            <p className="font-body text-muted-foreground text-sm">Kuso Oishii is a LEGO® resale business based in Brookville, Norfolk, UK. We rescue and resell quality LEGO® stock at fair prices.</p>
          </div>

          <div>
            <h2 className="font-display text-xl font-semibold mb-3 text-foreground">Information We Collect</h2>
            <ul className="list-disc list-inside font-body text-muted-foreground text-sm space-y-1">
              <li>Name and contact information (when you place an order or contact us)</li>
              <li>Shipping and billing addresses</li>
              <li>Payment information (processed securely via our payment provider)</li>
              <li>Purchase history</li>
              <li>Device and browser information (via cookies)</li>
            </ul>
          </div>

          <div>
            <h2 className="font-display text-xl font-semibold mb-3 text-foreground">How We Use Your Information</h2>
            <ul className="list-disc list-inside font-body text-muted-foreground text-sm space-y-1">
              <li>Process and fulfil your orders</li>
              <li>Send order confirmations and shipping updates</li>
              <li>Respond to your questions and support requests</li>
              <li>Send marketing emails (only with your consent)</li>
              <li>Improve our website and service</li>
            </ul>
          </div>

          <div>
            <h2 className="font-display text-xl font-semibold mb-3 text-foreground">Your Rights (UK GDPR)</h2>
            <p className="font-body text-muted-foreground text-sm mb-2">Under UK data protection law, you have the right to:</p>
            <ul className="list-disc list-inside font-body text-muted-foreground text-sm space-y-1">
              <li>Access your personal data</li>
              <li>Correct inaccurate data</li>
              <li>Request deletion of your data</li>
              <li>Object to processing</li>
              <li>Data portability</li>
              <li>Withdraw consent at any time</li>
            </ul>
          </div>

          <div>
            <h2 className="font-display text-xl font-semibold mb-3 text-foreground">Cookies</h2>
            <p className="font-body text-muted-foreground text-sm">We use essential cookies for site functionality and analytics cookies to understand how you use our site. You can manage cookie preferences in your browser settings.</p>
          </div>

          <div>
            <h2 className="font-display text-xl font-semibold mb-3 text-foreground">Data Security</h2>
            <p className="font-body text-muted-foreground text-sm">We implement appropriate security measures to protect your data. Payment processing is handled by secure third-party providers — we never store card details.</p>
          </div>

          <div>
            <h2 className="font-display text-xl font-semibold mb-3 text-foreground">Contact</h2>
            <div className="bg-muted rounded-sm p-4">
              <p className="font-display font-medium text-sm">Kuso Oishii — Data Protection</p>
              <p className="font-body text-muted-foreground text-sm">Email: privacy@kusooishii.com</p>
              <p className="font-body text-muted-foreground text-sm">Location: Brookville, Norfolk, UK</p>
            </div>
          </div>

          <p className="font-body text-xs text-muted-foreground">
            LEGO® is a trademark of the LEGO® Group of companies, which does not sponsor, authorise or endorse this site.
          </p>
        </div>
      </div>
    </StorefrontLayout>
  );
}
