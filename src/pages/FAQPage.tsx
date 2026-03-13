import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { StorefrontLayout } from '@/components/StorefrontLayout';
import { usePageSeo } from '@/hooks/use-page-seo';
import { GRADE_DETAILS } from '@/lib/grades';

export default function FAQPage() {
  usePageSeo({ title: 'Frequently Asked Questions', description: 'Answers to common questions about LEGO® set conditions, ordering, shipping, and returns at Kuso Oishii.', path: '/faq' });

  const sections = [
    {
      title: 'Condition Grades',
      badge: 'Important',
      items: [
        { id: 'grading-overview', q: 'How does your grading system work?', a: 'Every set is inspected and assigned a grade from 1 (Mint) to 5 (Fair) based on the condition of the box, contents, and completeness. See our full grading guide at /grading.' },
        { id: 'grade-1', q: `Grade 1 — ${GRADE_DETAILS["1"].label}`, a: GRADE_DETAILS["1"].desc },
        { id: 'grade-2', q: `Grade 2 — ${GRADE_DETAILS["2"].label}`, a: GRADE_DETAILS["2"].desc },
        { id: 'grade-3', q: `Grade 3 — ${GRADE_DETAILS["3"].label}`, a: GRADE_DETAILS["3"].desc },
        { id: 'grade-4', q: `Grade 4 — ${GRADE_DETAILS["4"].label}`, a: GRADE_DETAILS["4"].desc },
        { id: 'grade-5', q: `Grade 5 — ${GRADE_DETAILS["5"].label}`, a: GRADE_DETAILS["5"].desc },
      ],
    },
    {
      title: 'Buyer Education',
      items: [
        { id: 'genuine', q: 'Are these genuine LEGO® sets?', a: 'Yes, 100%. Every set comes from authorised UK retailers — they\'re returns, open-box, or damaged-box stock. We don\'t touch knock-offs.' },
        { id: 'piececount', q: 'How do you verify piece counts?', a: 'For sealed bags, we weigh them against known references. For opened bags, we hand-count. If anything is missing, we list it clearly in the condition notes.' },
        { id: 'instructions', q: 'Do sets come with instructions?', a: 'If the set included printed instructions and they\'re present, yes. If missing, we\'ll say so. LEGO\'s free digital instructions at lego.com/buildinginstructions cover every set.' },
      ],
    },
    {
      title: 'Ordering & Payment',
      items: [
        { id: 'payment', q: 'What payment methods do you accept?', a: 'Visa, Mastercard, American Express, and PayPal via Stripe. We never see or store your card details.' },
        { id: 'confirmation', q: 'Will I get an order confirmation?', a: 'Yes — email confirmation immediately after placing your order, and a second email with tracking info once we ship.' },
        { id: 'cancel', q: 'Can I cancel my order?', a: 'If we haven\'t shipped it yet, yes — email us at hello@kusooishii.com. Once dispatched, follow the returns process.' },
      ],
    },
    {
      title: 'Shipping & Delivery',
      items: [
        { id: 'options', q: 'What are the shipping options?', a: 'Standard (Free) via Evri, 3–5 working days. Express (Paid) via Royal Mail Tracked 24 or Parcelforce, 1–2 working days. Collection (Free) at the Blue Bell LEGO Club.' },
        { id: 'international', q: 'Do you ship internationally?', a: 'Not yet — UK mainland only for now. International shipping is something we\'re looking at for the future.' },
      ],
    },
    {
      title: 'Returns & Refunds',
      items: [
        { id: 'returns', q: 'What\'s the return policy?', a: 'Sealed sets: 14-day return in original condition. Open-box and damaged-box: sold as-described. If something arrives damaged in transit or doesn\'t match the listing, get in touch.' },
        { id: 'missing', q: 'What if pieces are missing?', a: 'If we listed a set as complete and you find missing pieces, email us with photos. We\'ll source missing parts, offer a partial refund, or arrange a return.' },
      ],
    },
  ];

  return (
    <StorefrontLayout>
      <div className="container py-12 max-w-3xl">
        <div className="text-center mb-12">
          <h1 className="font-display text-4xl font-bold text-foreground mb-4">FAQ</h1>
          <p className="font-body text-muted-foreground">Straight answers. No waffle.</p>
        </div>

        {sections.map(section => (
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
          <p className="font-body text-muted-foreground mb-4">Still got a question?</p>
          <Link to="/contact" className="font-display text-primary hover:underline font-medium">Get in touch →</Link>
        </div>
      </div>
    </StorefrontLayout>
  );
}
