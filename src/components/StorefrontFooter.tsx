import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import kusoLogo from '@/assets/kuso-logo.png';
import { Instagram, Twitter, Mail, MapPin, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export function StorefrontFooter() {
  const [footerEmail, setFooterEmail] = useState('');
  const navigate = useNavigate();

  // Check if any non-Mint (grade > 1) items exist for Deals link visibility
  const { data: hasDeals } = useQuery({
    queryKey: ['has_deals'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('browse_catalog', {
        search_term: null, filter_theme_id: null, filter_grade: null, filter_retired: null,
      });
      if (error) throw error;
      return (data as any[]).some(
        (p) => p.best_grade != null && parseInt(p.best_grade, 10) > 1
      );
    },
    staleTime: 5 * 60 * 1000,
  });

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
              Affordable LEGO®, responsibly re-sold. Rescued stock from UK retailers at fair prices.
            </p>
            <div className="flex items-center gap-2 text-primary-foreground/50 text-sm">
              <MapPin className="h-4 w-4" />
              <span className="font-body">Brookville, Norfolk UK</span>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="icon" className="text-primary-foreground/70 hover:text-primary-foreground" asChild>
                <a href="https://www.instagram.com/kuso_oishii/" target="_blank" rel="noopener noreferrer" aria-label="Instagram">
                  <Instagram className="h-5 w-5" />
                </a>
              </Button>
            </div>
          </div>

          {/* Quick Links */}
          <div className="space-y-4">
            <h4 className="font-display font-semibold uppercase tracking-widest text-primary text-base">Quick Links</h4>
            <nav className="flex flex-col gap-2">
              <Link to="/browse" className="font-body text-sm text-primary-foreground/60 hover:text-primary-foreground transition-colors">Shop All Sets</Link>
              <Link to="/browse?view=themes" className="font-body text-sm text-primary-foreground/60 hover:text-primary-foreground transition-colors">Browse Themes</Link>
              <Link to="/browse?new=true" className="font-body text-sm text-primary-foreground/60 hover:text-primary-foreground transition-colors">Just Landed</Link>
              {hasDeals && <Link to="/browse?deals=true" className="font-body text-sm text-primary-foreground/60 hover:text-primary-foreground transition-colors">Deals</Link>}
              <Link to="/bluebell" className="font-body text-sm text-blue-400 hover:text-blue-300 transition-colors">Blue Bell LEGO® Club</Link>
              <Link to="/about" className="font-body text-sm text-primary-foreground/60 hover:text-primary-foreground transition-colors">About Us</Link>
            </nav>
          </div>

          {/* Customer Service */}
          <div className="space-y-4">
            <h4 className="font-display font-semibold uppercase tracking-widest text-primary text-base">Customer Service</h4>
            <nav className="flex flex-col gap-2">
              <Link to="/faq" className="font-body text-sm text-primary-foreground/60 hover:text-primary-foreground transition-colors">FAQ</Link>
              <Link to="/contact" className="font-body text-sm text-primary-foreground/60 hover:text-primary-foreground transition-colors">Contact Us</Link>
              <Link to="/order-tracking" className="font-body text-sm text-primary-foreground/60 hover:text-primary-foreground transition-colors">Track Your Order</Link>
              <Link to="/returns-exchanges" className="font-body text-sm text-primary-foreground/60 hover:text-primary-foreground transition-colors">Returns & Exchanges</Link>
              <Link to="/shipping-policy" className="font-body text-sm text-primary-foreground/60 hover:text-primary-foreground transition-colors">Shipping Info</Link>
            </nav>
          </div>

          {/* Join */}
          <div className="space-y-4">
            <h4 className="font-display font-semibold uppercase tracking-widest text-primary text-base">First Dibs</h4>
            <p className="font-body text-sm text-primary-foreground/60">
              Create an account for wishlists, stock alerts, and club perks. No spam. Just bricks.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const params = footerEmail ? `?email=${encodeURIComponent(footerEmail)}` : '';
                navigate(`/signup${params}`);
              }}
              className="flex flex-col gap-2 sm:flex-row"
            >
              <Input
                type="email"
                placeholder="Enter your email"
                value={footerEmail}
                onChange={(e) => setFooterEmail(e.target.value)}
                className="bg-primary-foreground/10 border-primary-foreground/20 text-primary-foreground placeholder:text-primary-foreground/40 flex-1 font-body"
              />
              <Button type="submit" className="font-display whitespace-nowrap">
                <ArrowRight className="h-4 w-4 mr-2" /> Get Started
              </Button>
            </form>
            <p className="font-body text-xs text-primary-foreground/40">
              Already have an account? <Link to="/login" className="text-primary hover:underline">Sign in</Link>
            </p>
          </div>
        </div>

        <div className="mt-8 border-t border-primary-foreground/10 pt-8">
          <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
            <div className="text-center md:text-left space-y-1">
              <p className="font-body text-sm text-primary-foreground/50">
                © {new Date().getFullYear()} Kuso Oishii. All rights reserved.
              </p>
              <p className="font-body text-xs text-primary-foreground/30">
                LEGO®, the LEGO® logo and the Minifigure are trademarks of the LEGO® Group, which does not sponsor, authorise or endorse Kuso Oishii.
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