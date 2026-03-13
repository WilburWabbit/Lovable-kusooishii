import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { StorefrontLayout } from '@/components/StorefrontLayout';
import { usePageSeo } from '@/hooks/use-page-seo';
import { useStorefrontContent } from '@/hooks/useStorefrontContent';
import { FAQ_DEFAULTS, type FAQContent } from '@/lib/content-defaults';

export default function FAQPage() {
  usePageSeo({ title: 'Frequently Asked Questions', description: 'Answers to common questions about LEGO® set conditions, ordering, shipping, and returns at Kuso Oishii.', path: '/faq' });

  const { data: content } = useStorefrontContent('faq', FAQ_DEFAULTS as unknown as Record<string, unknown>);
  const c = content as unknown as FAQContent;

  return (
    <StorefrontLayout>
      <div className="container py-12 max-w-3xl">
        <div className="text-center mb-12">
          <h1 className="font-display text-4xl font-bold text-foreground mb-4">{c.pageTitle}</h1>
          <p className="font-body text-muted-foreground">{c.pageSubtitle}</p>
        </div>

        {c.sections.map(section => (
          <section key={section.title} className="mb-12">
            <h2 className="font-display text-2xl font-bold text-foreground mb-6 flex items-center gap-3">
              {section.title}
              {section.badge && <Badge variant="outline" className="font-body text-xs font-normal">{section.badge}</Badge>}
            </h2>
            <Accordion type="single" collapsible className="space-y-2">
              {section.items.map(item => (
                <AccordionItem key={item.id} value={item.id} className="border rounded-sm px-4">
                  <AccordionTrigger className="hover:no-underline">
                    <span className="text-left font-display font-semibold text-sm">{item.q}</span>
                  </AccordionTrigger>
                  <AccordionContent className="font-body text-muted-foreground text-sm">{item.a}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </section>
        ))}

        <div className="text-center pt-8 border-t border-border">
          <p className="font-body text-muted-foreground mb-4">{c.ctaText}</p>
          <Link to="/contact" className="font-display text-primary hover:underline font-medium">{c.ctaLinkText}</Link>
        </div>
      </div>
    </StorefrontLayout>
  );
}
