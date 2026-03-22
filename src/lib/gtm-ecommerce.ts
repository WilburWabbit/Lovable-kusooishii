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

// ── User identification & auth events ────────────────────────

/** Push user_id so GA4 can stitch sessions across devices. Pass null on sign-out. */
export function setGTMUserId(userId: string | null) {
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ user_id: userId });
}

export function trackLogin(method: string) {
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event: 'login', method });
}

export function trackSignUp(method: string) {
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event: 'sign_up', method });
}

/**
 * Stash the auth action (login or sign_up) and method before an OAuth redirect.
 * The auth provider picks this up when onAuthStateChange fires SIGNED_IN.
 */
export function stashAuthAction(action: 'login' | 'sign_up', method: string) {
  try {
    sessionStorage.setItem('kuso_auth_action', JSON.stringify({ action, method }));
  } catch { /* sessionStorage unavailable */ }
}

/** Consume a stashed auth action (returns null if none). */
export function consumeAuthAction(): { action: 'login' | 'sign_up'; method: string } | null {
  try {
    const raw = sessionStorage.getItem('kuso_auth_action');
    if (!raw) return null;
    sessionStorage.removeItem('kuso_auth_action');
    return JSON.parse(raw);
  } catch { return null; }
}
