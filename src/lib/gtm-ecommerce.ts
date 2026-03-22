import type { Product } from '@/lib/store';

declare global {
  interface Window { dataLayer: Record<string, unknown>[]; }
}

interface CartItem extends Product { quantity: number; }

function pushEvent(event: Record<string, unknown>) {
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ ecommerce: null });
  window.dataLayer.push(event);
}

function toGA4Item(product: Product, quantity = 1) {
  return {
    item_id: product.setNumber || product.id,
    item_name: product.name,
    item_category: product.theme,
    price: product.price,
    quantity,
  };
}

export function trackViewItem(product: Product) {
  pushEvent({
    event: 'view_item',
    ecommerce: { currency: 'GBP', value: product.price, items: [toGA4Item(product)] },
  });
}

export function trackAddToCart(product: Product, quantity = 1) {
  pushEvent({
    event: 'add_to_cart',
    ecommerce: { currency: 'GBP', value: product.price * quantity, items: [toGA4Item(product, quantity)] },
  });
}

export function trackBeginCheckout(cartItems: CartItem[], cartTotal: number) {
  pushEvent({
    event: 'begin_checkout',
    ecommerce: { currency: 'GBP', value: cartTotal, items: cartItems.map(i => toGA4Item(i, i.quantity)) },
  });
}

export function trackPurchase(transactionId: string, cartItems: CartItem[], cartTotal: number, shipping: number) {
  pushEvent({
    event: 'purchase',
    ecommerce: {
      transaction_id: transactionId, currency: 'GBP', value: cartTotal + shipping, shipping,
      items: cartItems.map(i => toGA4Item(i, i.quantity)),
    },
  });
}
