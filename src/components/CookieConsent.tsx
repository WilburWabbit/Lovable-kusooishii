import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Cookie } from 'lucide-react';

const COOKIE_CONSENT_KEY = 'kuso-oishii-cookie-consent';

const CookieConsent = () => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem(COOKIE_CONSENT_KEY);
    if (!consent) {
      const timer = setTimeout(() => setVisible(true), 800);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleAccept = () => { localStorage.setItem(COOKIE_CONSENT_KEY, 'accepted'); setVisible(false); };
  const handleReject = () => { localStorage.setItem(COOKIE_CONSENT_KEY, 'rejected'); setVisible(false); };

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[100] p-4 md:p-6">
      <div className="container mx-auto max-w-3xl">
        <div className="bg-card border border-border rounded-lg shadow-lg p-5 md:p-6">
          <div className="flex items-start gap-4">
            <Cookie className="h-6 w-6 text-primary shrink-0 mt-0.5" />
            <div className="flex-1 space-y-3">
              <p className="font-display text-sm font-semibold text-foreground">We use cookies</p>
              <p className="font-body text-xs text-muted-foreground leading-relaxed">
                We use essential cookies to keep things running and optional analytics cookies to understand how you browse.
                No third-party advertising cookies. Ever. Read our{' '}
                <Link to="/privacy" className="text-primary hover:underline">Privacy Policy</Link> for the full picture.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={handleAccept}>Accept All</Button>
                <Button size="sm" variant="outline" onClick={handleReject}>Essential Only</Button>
                <Link to="/privacy" className="font-body text-xs text-muted-foreground hover:text-foreground transition-colors ml-1">Manage Cookies</Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CookieConsent;
