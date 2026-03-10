import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StorefrontLayout } from '@/components/StorefrontLayout';
import { useStore } from '@/lib/store';
import { usePageSeo } from '@/hooks/use-page-seo';

export default function CheckoutSuccessPage() {
  usePageSeo({ title: 'Order Confirmed', description: 'Your Kuso Oishii order has been placed successfully.', path: '/checkout/success', noIndex: true });
  const clearCart = useStore(state => state.clearCart);
  const [params] = useSearchParams();
  const sessionId = params.get('session_id');

  useEffect(() => { clearCart(); }, [clearCart]);

  return (
    <StorefrontLayout>
      <div className="flex items-center justify-center py-24">
        <div className="text-center max-w-md">
          <CheckCircle className="h-20 w-20 mx-auto mb-6 text-green-600" />
          <h1 className="font-display text-3xl font-bold text-foreground mb-4">Order Confirmed!</h1>
          <p className="font-body text-muted-foreground mb-2">
            Thanks for rescuing some bricks. You'll receive an email confirmation shortly.
          </p>
          {sessionId && (
            <p className="font-body text-xs text-muted-foreground mb-8">Reference: {sessionId.slice(0, 20)}…</p>
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
