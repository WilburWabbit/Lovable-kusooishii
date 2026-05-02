import { useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StorefrontLayout } from '@/components/StorefrontLayout';
import { useStore } from '@/lib/store';
import { useSeoDocumentPageSeo } from '@/hooks/use-seo-document';
import { trackPurchase } from '@/lib/gtm-ecommerce';

export default function CheckoutSuccessPage() {
  useSeoDocumentPageSeo('route:/checkout/success', { title: 'Order Confirmed', description: 'Your Kuso Oishii order has been placed successfully.', path: '/checkout/success', noIndex: true });
  const clearCart = useStore(state => state.clearCart);
  const [params] = useSearchParams();
  const sessionId = params.get('session_id');
  const purchaseTracked = useRef(false);

  useEffect(() => { clearCart(); }, [clearCart]);

  // Fire purchase event once using stashed cart data
  useEffect(() => {
    if (purchaseTracked.current || !sessionId) return;
    try {
      const raw = sessionStorage.getItem('kuso_checkout_cart');
      if (!raw) return;
      purchaseTracked.current = true;
      const { items, total, shipping } = JSON.parse(raw);
      // Build minimal Product-shaped objects for trackPurchase
      const cartItems = items.map((i: any) => ({
        ...i,
        rrp: 0, image: '', images: [], themeId: null, pieceCount: 0,
        condition: '', conditionGrade: 0, ageRange: '', hook: '',
        description: '', highlights: [], stock: 0, retired: false,
        yearReleased: null,
      }));
      trackPurchase(sessionId, cartItems, total, shipping);
      sessionStorage.removeItem('kuso_checkout_cart');
    } catch { /* graceful — tracking failure must never block the success page */ }
  }, [sessionId]);

  return (
    <StorefrontLayout>
      <div className="flex items-center justify-center py-24">
        <div className="text-center max-w-md">
          <CheckCircle className="h-20 w-20 mx-auto mb-6 text-green-600" />
          <h1 className="font-display text-3xl font-bold text-foreground mb-4">Order Confirmed!</h1>
          <p className="font-body text-muted-foreground mb-2">
            Thanks for rescuing some bricks. Confirmation email is on its way — check your inbox (and spam folder, just in case).
          </p>
          {sessionId && (
            <p className="font-body text-xs text-muted-foreground mb-8">Order reference: {sessionId.slice(0, 8)}</p>
          )}
          <div className="flex flex-col gap-3">
            <Button asChild size="lg" className="font-display font-semibold">
              <Link to="/browse">Continue Shopping</Link>
            </Button>
            <Button asChild variant="outline" className="font-display">
              <Link to="/order-tracking">Track Your Order</Link>
            </Button>
          </div>
        </div>
      </div>
    </StorefrontLayout>
  );
}
