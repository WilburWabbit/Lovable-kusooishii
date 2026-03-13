import { StorefrontLayout } from '@/components/StorefrontLayout';
import { usePageSeo } from '@/hooks/use-page-seo';
import { useStorefrontContent } from '@/hooks/useStorefrontContent';
import { PRIVACY_DEFAULTS, type PolicyContent } from '@/lib/content-defaults';

export default function PrivacyPage() {
  usePageSeo({ title: 'Privacy Policy', description: 'How Kuso Oishii collects, uses, and protects your personal data under UK GDPR.', path: '/privacy' });

  const { data: content } = useStorefrontContent('privacy', PRIVACY_DEFAULTS as unknown as Record<string, unknown>);
  const c = content as unknown as PolicyContent;

  return (
    <StorefrontLayout>
      <div className="container py-12 max-w-4xl">
        <div className="text-center mb-12">
          <h1 className="font-display text-4xl font-bold text-foreground mb-4">{c.pageTitle}</h1>
          <p className="font-body text-muted-foreground">Last updated: {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>

        <div className="bg-card rounded-sm border border-border p-8 space-y-8">
          {c.sections.map((section) => (
            <div key={section.title}>
              <h2 className="font-display text-xl font-semibold mb-3 text-foreground">{section.title}</h2>
              {section.body.split('\n').map((line, i) => (
                <p key={i} className="font-body text-muted-foreground text-sm">{line}</p>
              ))}
            </div>
          ))}

          <p className="font-body text-xs text-muted-foreground">
            LEGO® is a trademark of the LEGO Group of companies, which does not sponsor, authorise or endorse this site.
          </p>
        </div>
      </div>
    </StorefrontLayout>
  );
}
