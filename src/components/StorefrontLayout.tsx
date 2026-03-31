import { useEffect } from "react";
import { StorefrontHeader } from "./StorefrontHeader";
import { StorefrontFooter } from "./StorefrontFooter";
import ScrollToTop from "./ScrollToTop";
import CookieConsent from "./CookieConsent";
import { useGTM } from "@/hooks/use-gtm";

const ORG_SCHEMA = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Kuso Oishii',
  url: 'https://kusooishii.com',
  logo: 'https://kusooishii.com/favicon.ico',
  description: 'Handpicked LEGO® sets with obsessive condition grading. Rescued stock at fair prices.',
  contactPoint: {
    '@type': 'ContactPoint',
    email: 'hello@kusooishii.com',
    contactType: 'customer service',
  },
  address: {
    '@type': 'PostalAddress',
    addressLocality: 'Brookville',
    addressRegion: 'Norfolk',
    addressCountry: 'GB',
  },
  sameAs: [
    'https://www.instagram.com/kusooishii',
  ],
});

interface StorefrontLayoutProps {
  children: React.ReactNode;
}

export function StorefrontLayout({ children }: StorefrontLayoutProps) {
  useGTM();

  // Inject Organization JSON-LD once
  useEffect(() => {
    const id = 'org-jsonld';
    if (document.getElementById(id)) return;
    const script = document.createElement('script');
    script.id = id;
    script.type = 'application/ld+json';
    script.textContent = ORG_SCHEMA;
    document.head.appendChild(script);
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <ScrollToTop />
      <StorefrontHeader />
      <main className="flex-1 overflow-x-hidden">{children}</main>
      <StorefrontFooter />
      <CookieConsent />
    </div>
  );
}
