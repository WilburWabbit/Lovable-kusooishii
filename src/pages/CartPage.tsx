import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Minus, Plus, Trash2, ShoppingBag, Loader2, Truck, Store, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { useStore } from '@/lib/store';
import { useAuth } from '@/hooks/useAuth';
import { StorefrontLayout } from '@/components/StorefrontLayout';
import { trackBeginCheckout } from '@/lib/gtm-ecommerce';
import { toast } from 'sonner';
import { GRADE_LABELS_NUMERIC } from '@/lib/grades';
import BeerIcon from '@/assets/beer-icon.svg';

const shippingOptions = [
{ id: 'standard', label: 'Standard', carrier: 'Evri', price: 0, est: '3–5 working days' },
{ id: 'express', label: 'Express', carrier: 'Royal Mail Tracked 24', price: 5.99, est: '1–2 working days' },
{ id: 'collection', label: 'Collection', carrier: 'Blue Bell LEGO Club', price: 0, est: 'Next club meet' }];


export default function CartPage() {
  const { cart, updateQuantity, removeFromCart, cartTotal } = useStore();
  const { user } = useAuth();
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [selectedShipping, setSelectedShipping] = useState('standard');

  const availableOptions = shippingOptions.filter((o) => o.id !== 'collection' || user);
  const selectedOption = availableOptions.find((o) => o.id === selectedShipping) ?? availableOptions[0];
  const shippingPrice = selectedOption?.price ?? 0;
  const isCollection = selectedShipping === 'collection';
  const subtotal = cartTotal();
  const collectionDiscount = isCollection ? subtotal * 0.05 : 0;
  const blueBellDonation = isCollection ? subtotal * 0.05 : 0;

  const handleCheckout = async () => {
    setIsCheckingOut(true);
    trackBeginCheckout(cart, subtotal);
    try {
      const { data: { session } } = await (await import('@/integrations/supabase/client')).supabase.auth.getSession();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-checkout`,
        {
          method: 'POST',
          headers: { ...headers, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
          body: JSON.stringify({
            items: cart.map((i) => ({
              skuId: i.id,
              quantity: i.quantity
            })),
            shippingMethod: selectedShipping
          })
        }
      );

      const result = await res.json();
      if (result.url) {
        window.location.href = result.url;
      } else {
        throw new Error(result.error || 'Failed to create checkout session');
      }
    } catch (err: any) {
      console.error('Checkout error:', err);
      toast.error(err.message || 'Checkout failed. Please try again.');
    } finally {
      setIsCheckingOut(false);
    }
  };

  if (cart.length === 0) {
    return (
      <StorefrontLayout>
        <div className="flex items-center justify-center py-24">
          <div className="text-center">
            <ShoppingBag className="h-24 w-24 mx-auto mb-6 text-muted-foreground" />
            <h1 className="font-display text-3xl font-bold mb-4">Your cart is empty</h1>
            <p className="font-body text-muted-foreground mb-8">No bricks here yet. Go rescue some sets.</p>
            <Button asChild size="lg" className="font-display font-semibold">
              <Link to="/browse">Shop Sets</Link>
            </Button>
          </div>
        </div>
      </StorefrontLayout>);

  }

  return (
    <StorefrontLayout>
      <div className="container py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            <h1 className="font-display text-3xl font-bold mb-8">Shopping Cart</h1>
            <div className="space-y-4">
              {cart.map((item) =>
              <Card key={item.id}>
                  <CardContent className="p-4">
                    <div className="flex flex-col sm:flex-row gap-4">
                      <div className="w-full sm:w-24 h-24 bg-kuso-mist rounded-sm overflow-hidden shrink-0">
                        {item.image ?
                      <img src={item.image} alt={item.name} className="w-full h-full object-cover" /> :

                      <div className="flex h-full items-center justify-center font-display text-xl text-muted-foreground/30">{item.setNumber.split('-')[0]}</div>
                      }
                      </div>
                      <div className="flex-1 space-y-2">
                        <div>
                          <h3 className="font-display text-sm font-semibold">{item.name}</h3>
                          <p className="font-body text-xs text-muted-foreground">#{item.setNumber} · {item.theme}</p>
                          <Badge variant="secondary" className="mt-1 font-display text-[10px]">{GRADE_LABELS_NUMERIC[item.conditionGrade] || `Grade ${item.conditionGrade}`}</Badge>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => updateQuantity(item.id, item.quantity - 1)}>
                              <Minus className="h-3 w-3" />
                            </Button>
                            <span className="w-6 text-center font-display text-sm font-medium">{item.quantity}</span>
                            <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => updateQuantity(item.id, item.quantity + 1)}>
                              <Plus className="h-3 w-3" />
                            </Button>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="font-display text-base font-bold">£{(item.price * item.quantity).toFixed(2)}</span>
                            <Button variant="ghost" size="icon" className="text-destructive h-7 w-7" onClick={() => removeFromCart(item.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>

          {/* Summary */}
          <div>
            <Card className="sticky top-20">
              <CardContent className="p-6">
                <h2 className="font-display text-lg font-bold mb-6">Order Summary</h2>
                <div className="space-y-4">
                  <div className="flex justify-between font-body text-sm">
                    <span>Subtotal</span>
                    <span className="font-medium">£{subtotal.toFixed(2)}</span>
                  </div>

                  <div className="space-y-3">
                    <span className="font-display text-xs font-semibold uppercase tracking-widest">Shipping</span>
                    <RadioGroup value={selectedShipping} onValueChange={setSelectedShipping} className="space-y-2">
                      {availableOptions.map((opt) =>
                      <div key={opt.id} className="flex items-start gap-3 rounded-sm border border-border p-3 cursor-pointer hover:bg-muted/50 transition-colors">
                          <RadioGroupItem value={opt.id} id={`ship-${opt.id}`} className="mt-0.5" />
                          <Label htmlFor={`ship-${opt.id}`} className="flex-1 cursor-pointer space-y-0.5">
                            <div className="flex items-center justify-between">
                              <span className="font-display text-xs font-medium flex items-center gap-1.5">
                                {opt.id === 'collection' ? <Store className="h-3.5 w-3.5" /> : <Truck className="h-3.5 w-3.5" />}
                                {opt.label}
                              </span>
                              <span className="font-display text-xs font-semibold">{opt.price === 0 ? 'Free' : `£${opt.price.toFixed(2)}`}</span>
                            </div>
                            <p className="font-body text-[11px] text-muted-foreground">{opt.carrier} · {opt.est}</p>
                          </Label>
                        </div>
                      )}
                    </RadioGroup>
                    {!user && <p className="font-body text-[11px] text-muted-foreground"><Link to="/login" className="text-primary underline">Sign in</Link> to collect at the <Link to="/bluebell" className="text-primary underline">Blue Bell LEGO Club</Link></p>}
                  </div>

                  {isCollection &&
                  <div className="flex justify-between font-body text-xs text-blue-600">
                      <span className="flex items-center gap-1.5"><Tag className="h-3.5 w-3.5" />Member collection discount (5%)</span>
                      <span>−£{collectionDiscount.toFixed(2)}</span>
                    </div>
                  }

                  {isCollection &&
                  <div className="flex justify-between font-body text-xs text-blue-600">
                      <span className="flex items-center gap-1.5"><img src={BeerIcon} alt="" className="h-3.5 w-3.5 text-blue-600" style={{ filter: 'invert(29%) sepia(98%) saturate(1834%) hue-rotate(212deg) brightness(95%) contrast(93%)' }} />Blue Bell Donation (5%)</span>
                      <span>(£{blueBellDonation.toFixed(2)})</span>
                    </div>
                  }

                  <Separator />
                  <div className="flex justify-between font-display text-lg font-bold">
                    <span>Total</span>
                    <span>£{(subtotal + shippingPrice - collectionDiscount).toFixed(2)}</span>
                  </div>
                </div>
                <div className="mt-6 space-y-3">
                  <Button onClick={handleCheckout} className="w-full font-display" size="lg" disabled={isCheckingOut}>
                    {isCheckingOut ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing…</> : 'Proceed to Checkout'}
                  </Button>
                  <Button asChild variant="outline" className="w-full font-display">
                    <Link to="/browse">Continue Shopping</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </StorefrontLayout>);

}