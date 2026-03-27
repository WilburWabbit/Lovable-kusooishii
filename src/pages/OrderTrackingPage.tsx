import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Package, Truck, MapPin, CheckCircle } from 'lucide-react';
import { StorefrontLayout } from '@/components/StorefrontLayout';
import { usePageSeo } from '@/hooks/use-page-seo';
import { Link } from 'react-router-dom';

export default function OrderTrackingPage() {
  usePageSeo({ title: 'Track Your Order', description: 'Track your Kuso Oishii LEGO® order with your order number and email address.', path: '/order-tracking' });
  const [trackingNumber, setTrackingNumber] = useState('');
  const [orderEmail, setOrderEmail] = useState('');
  const [trackingResult, setTrackingResult] = useState<any>(null);

  const handleTrackOrder = () => {
    if (trackingNumber && orderEmail) {
      setTrackingResult({
        orderNumber: trackingNumber,
        status: 'In Transit',
        estimatedDelivery: '20 January 2025',
        steps: [
          { status: 'Order Placed', date: '15 Jan 2025 — 14:30', completed: true },
          { status: 'Order Processed', date: '16 Jan 2025 — 09:15', completed: true },
          { status: 'Dispatched', date: '17 Jan 2025 — 11:45', completed: true },
          { status: 'In Transit', date: '18 Jan 2025 — 15:20', completed: true },
          { status: 'Out for Delivery', date: 'Pending', completed: false },
          { status: 'Delivered', date: 'Pending', completed: false },
        ],
      });
    }
  };

  return (
    <StorefrontLayout>
      <div className="container py-12 max-w-4xl">
        <h1 className="font-display text-4xl font-bold text-center mb-4 text-foreground">Track Your Order</h1>
        <p className="font-body text-muted-foreground text-center mb-8">Enter your order number and email to track your bricks.</p>

        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="font-display flex items-center gap-2"><Package className="h-5 w-5" /> Find Your Parcel</CardTitle>
            <CardDescription className="font-body">Enter your order number and the email you used at checkout.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="tracking" className="font-display text-sm">Order Number / Tracking Number</Label>
                <Input id="tracking" placeholder="e.g., KO-0000123" value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} className="font-body" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email" className="font-display text-sm">Email Address</Label>
                <Input id="email" type="email" placeholder="you@example.com" value={orderEmail} onChange={(e) => setOrderEmail(e.target.value)} className="font-body" />
              </div>
            </div>
            <Button onClick={handleTrackOrder} className="w-full font-display" disabled={!trackingNumber || !orderEmail}>
              <Package className="h-4 w-4 mr-2" /> Track Order
            </Button>
          </CardContent>
        </Card>

        {trackingResult && (
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="font-display flex items-center justify-between">
                <span>Order #{trackingResult.orderNumber}</span>
                <span className="text-primary">{trackingResult.status}</span>
              </CardTitle>
              <CardDescription className="font-body flex items-center gap-2">
                <Truck className="h-4 w-4" /> Estimated Delivery: {trackingResult.estimatedDelivery}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {trackingResult.steps.map((step: any, i: number) => (
                  <div key={i} className="flex items-start gap-4">
                    {step.completed ? <CheckCircle className="h-6 w-6 text-green-600 shrink-0" /> : <div className="w-6 h-6 rounded-full border-2 border-muted-foreground shrink-0" />}
                    <div>
                      <h3 className={`font-display font-semibold text-sm ${step.completed ? 'text-foreground' : 'text-muted-foreground'}`}>{step.status}</h3>
                      <p className="font-body text-xs text-muted-foreground">{step.date}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <Card>
            <CardHeader><CardTitle className="font-display flex items-center gap-2"><MapPin className="h-5 w-5" /> Shipping Info</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="font-body text-muted-foreground text-sm">Most orders are processed within 1–2 working days and dispatched from Norfolk.</p>
              <ul className="font-body text-sm text-muted-foreground space-y-1">
                <li>• Standard via Evri (3–5 days): Free</li>
                <li>• Express via Royal Mail / Parcelforce (1–2 days): Paid</li>
                <li>• Collection at Blue Bell LEGO® Club: Free</li>
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="font-display">Need a Hand?</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="font-body text-muted-foreground text-sm">Can't find your order or something looks off?</p>
              <Button variant="outline" className="w-full font-display" asChild><Link to="/contact">Contact Support</Link></Button>
              <Button variant="outline" className="w-full font-display" asChild><Link to="/returns-exchanges">Returns & Exchanges</Link></Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </StorefrontLayout>
  );
}
