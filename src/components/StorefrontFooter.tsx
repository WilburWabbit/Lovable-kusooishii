import { Link } from 'react-router-dom';
import kusoLogo from '@/assets/kuso-logo.png';
import { Instagram, Twitter, Mail, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useStorefrontContent } from '@/hooks/useStorefrontContent';
import { FOOTER_DEFAULTS, type FooterContent } from '@/lib/content-defaults';

export function StorefrontFooter() {
  const { data: content } = useStorefrontContent('footer', FOOTER_DEFAULTS as unknown as Record<string, unknown>);
  const c = content as unknown as FooterContent;

  return (
    <footer className="bg-kuso-ink text-primary-foreground">
      <div className="container py-12">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-4">
          {/* Brand */}
          <div className="space-y-4">
            <span className="font-display tracking-tight text-primary-foreground text-2xl font-extrabold">
              KUSO OISHII
            </span>
            <p className="font-body text-sm text-primary-foreground/60">
              {c.brandTagline}
            </p>
            <div className="flex items-center gap-2 text-primary-foreground/50 text-sm">
              <MapPin className="h-4 w-4" />
              <span className="font-body">{c.location}</span>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="icon" className="text-primary-foreground/70 hover:text-primary-foreground" asChild>
                <a href={c.instagramUrl} target="_blank" rel="noopener noreferrer" aria-label="Instagram">
                  <Instagram className="h-5 w-5" />
                </a>
              </Button>
            </div>
          </div>

          {/* Quick Links */}
          <div className="space-y-4">
            <h4 className="font-display font-semibold uppercase tracking-widest text-primary text-base">Quick Links</h4>
            <nav className="flex flex-col gap-2">
              {c.quickLinks.map(({ label, path }) => (
                <Link key={path} to={path} className="font-body text-sm text-primary-foreground/60 hover:text-primary-foreground transition-colors">{label}</Link>
              ))}
            </nav>
          </div>

          {/* Customer Service */}
          <div className="space-y-4">
            <h4 className="font-display font-semibold uppercase tracking-widest text-primary text-base">Customer Service</h4>
            <nav className="flex flex-col gap-2">
              {c.customerServiceLinks.map(({ label, path }) => (
                <Link key={path} to={path} className="font-body text-sm text-primary-foreground/60 hover:text-primary-foreground transition-colors">{label}</Link>
              ))}
            </nav>
          </div>

          {/* Newsletter */}
          <div className="space-y-4">
            <h4 className="font-display font-semibold uppercase tracking-widest text-primary text-base">{c.newsletterHeading}</h4>
            <p className="font-body text-sm text-primary-foreground/60">
              {c.newsletterDescription}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input placeholder="Enter your email" className="bg-primary-foreground/10 border-primary-foreground/20 text-primary-foreground placeholder:text-primary-foreground/40 flex-1 font-body" />
              <Button className="font-display whitespace-nowrap">
                <Mail className="h-4 w-4 mr-2" /> Subscribe
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-8 border-t border-primary-foreground/10 pt-8">
          <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
            <div className="text-center md:text-left space-y-1">
              <p className="font-body text-sm text-primary-foreground/50">
                © {new Date().getFullYear()} Kuso Oishii. All rights reserved.
              </p>
              <p className="font-body text-xs text-primary-foreground/30">
                {c.disclaimer}
              </p>
            </div>
            <div className="flex gap-6">
              <Link to="/privacy" className="font-body text-sm text-primary-foreground/50 hover:text-primary-foreground transition-colors">Privacy Policy</Link>
              <Link to="/terms" className="font-body text-sm text-primary-foreground/50 hover:text-primary-foreground transition-colors">Terms of Service</Link>
            </div>
          </div>
        </div>
      </div>
    </footer>);
}
