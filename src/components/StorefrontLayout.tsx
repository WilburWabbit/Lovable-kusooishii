import { StorefrontHeader } from "./StorefrontHeader";
import { StorefrontFooter } from "./StorefrontFooter";
import ScrollToTop from "./ScrollToTop";
import CookieConsent from "./CookieConsent";
import { useGTM } from "@/hooks/use-gtm";

interface StorefrontLayoutProps {
  children: React.ReactNode;
}

export function StorefrontLayout({ children }: StorefrontLayoutProps) {
  useGTM();

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
