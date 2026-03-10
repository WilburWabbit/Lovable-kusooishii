import { useState } from 'react';
import { Mail, MapPin, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StorefrontLayout } from '@/components/StorefrontLayout';
import { usePageSeo } from '@/hooks/use-page-seo';
import { toast } from 'sonner';

export default function ContactPage() {
  usePageSeo({ title: 'Contact Us', description: 'Get in touch with Kuso Oishii. Questions about orders, returns, or LEGO sets?', path: '/contact' });
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitting(true);
    setTimeout(() => {
      toast.success("Message sent — we'll get back to you within 1 working day.");
      setSubmitting(false);
      (e.target as HTMLFormElement).reset();
    }, 800);
  };

  return (
    <StorefrontLayout>
      <div className="container py-12 max-w-4xl">
        <div className="text-center mb-12">
          <h1 className="font-display text-4xl font-bold text-foreground mb-4">Contact Us</h1>
          <p className="font-body text-muted-foreground max-w-xl mx-auto">Got a question about an order, a set, or anything else? Drop us a message.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="space-y-6 lg:order-2">
            <Card>
              <CardContent className="p-6 space-y-5">
                {[
                  { icon: Mail, title: 'Email', content: <a href="mailto:hello@kusooishii.com" className="font-body text-sm text-muted-foreground hover:text-foreground transition-colors">hello@kusooishii.com</a> },
                  { icon: MapPin, title: 'Location', content: <p className="font-body text-sm text-muted-foreground">Brookville, Norfolk, UK</p> },
                  { icon: Clock, title: 'Response Time', content: <p className="font-body text-sm text-muted-foreground">We reply within 1 working day, Monday to Friday.</p> },
                ].map(({ icon: Icon, title, content }) => (
                  <div key={title} className="flex items-start gap-3">
                    <Icon className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                    <div>
                      <p className="font-display text-sm font-medium text-foreground">{title}</p>
                      {content}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-2 lg:order-1">
            <Card>
              <CardHeader><CardTitle className="font-display">Send us a message</CardTitle></CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block font-display text-sm font-medium text-foreground mb-1.5">Name</label>
                      <Input placeholder="Your name" required className="font-body" />
                    </div>
                    <div>
                      <label className="block font-display text-sm font-medium text-foreground mb-1.5">Email</label>
                      <Input type="email" placeholder="you@example.com" required className="font-body" />
                    </div>
                  </div>
                  <div>
                    <label className="block font-display text-sm font-medium text-foreground mb-1.5">Subject</label>
                    <Select required>
                      <SelectTrigger className="font-body"><SelectValue placeholder="What's this about?" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="order">Order issue</SelectItem>
                        <SelectItem value="product">Product question</SelectItem>
                        <SelectItem value="returns">Returns</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="block font-display text-sm font-medium text-foreground mb-1.5">Message</label>
                    <Textarea placeholder="Tell us what's up..." rows={6} required className="font-body" />
                  </div>
                  <Button type="submit" className="w-full font-display" size="lg" disabled={submitting}>
                    {submitting ? 'Sending...' : 'Send Message'}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </StorefrontLayout>
  );
}
