import { StorefrontLayout } from '@/components/StorefrontLayout';
import { usePageSeo } from '@/hooks/use-page-seo';
import { useStorefrontContent } from '@/hooks/useStorefrontContent';
import { TERMS_DEFAULTS, type PolicyContent } from '@/lib/content-defaults';

export default function TermsPage() {
  usePageSeo({ title: 'Terms of Service', description: 'Terms and conditions for using the Kuso Oishii website and purchasing LEGO® sets.', path: '/terms' });

  const { data: content } = useStorefrontContent('terms', TERMS_DEFAULTS as unknown as Record<string, unknown>);
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
              <p className="font-body text-muted-foreground text-sm leading-relaxed whitespace-pre-line">{section.body}</p>
            </div>
          ))}
        </div>
      </div>
    </StorefrontLayout>
  );
}
