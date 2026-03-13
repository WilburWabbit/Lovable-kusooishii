import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Product {
  id: string;
  name: string;
  setNumber: string;
  price: number;
  rrp: number;
  image: string;
  images: string[];
  theme: string;
  themeId: string | null;
  pieceCount: number;
  condition: string;
  conditionGrade: number;
  ageRange: string;
  hook: string;
  description: string;
  highlights: string[];
  stock: number;
  retired: boolean;
  yearReleased: number | null;
  callToAction?: string;
  sealedPrice?: number;
  subtheme?: string;
  seoTitle?: string;
  seoDescription?: string;
  weightKg?: number;
}

export interface WishlistItem {
  id: string;
  source: 'storefront' | 'catalogue';
  setNumber?: string;
  name?: string;
  imgUrl?: string;
  theme?: string;
  subtheme?: string;
  year?: number;
  addedAt: string;
}

interface CartItem extends Product {
  quantity: number;
}

interface FilterState {
  themes: string[];
  priceRange: [number, number];
  conditions: string[];
  yearRange: [number, number];
  retiredOnly: boolean;
  showSoldOut: boolean;
}

interface StoreState {
  products: Product[];
  cart: CartItem[];
  wishlistItems: WishlistItem[];
  recentlyViewed: string[];
  searchQuery: string;
  filters: FilterState;
  addToCart: (product: Product) => void;
  removeFromCart: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => void;
  clearCart: () => void;
  cartTotal: () => number;
  cartCount: () => number;
  getProductsByTheme: (theme: string) => Product[];
  getAvailableThemes: () => string[];
  addToWishlist: (productId: string) => void;
  addCatalogueToWishlist: (s: { setNumber: string; name: string; imgUrl?: string; theme?: string; subtheme?: string; year?: number }) => void;
  removeFromWishlist: (id: string) => void;
  isInWishlist: (productId: string) => boolean;
  isCatalogueInWishlist: (setNumber: string) => boolean;
  getWishlistProducts: () => Product[];
  getWishlistCatalogueItems: () => WishlistItem[];
  addToRecentlyViewed: (productId: string) => void;
  getRecentlyViewedProducts: () => Product[];
  setSearchQuery: (query: string) => void;
  searchProducts: (query?: string) => Product[];
  setFilters: (filters: FilterState) => void;
  getFilteredProducts: (baseProducts?: Product[]) => Product[];
  clearFilters: () => void;
  getPriceRange: (baseProducts?: Product[]) => [number, number];
  getRecommendedProducts: (productId: string, limit?: number) => Product[];
  setProducts: (products: Product[]) => void;
}

export const useStore = create<StoreState>()(
  persist(
    (set, get) => ({
      products: [],
      cart: [],
      wishlistItems: [],
      recentlyViewed: [],
      searchQuery: '',
      filters: {
        themes: [],
        priceRange: [0, 1000],
        conditions: [],
        yearRange: [2000, 2030],
        retiredOnly: false,
        showSoldOut: false,
      },

      addToCart: (product) => {
        const existing = get().cart.find(item => item.id === product.id);
        if (existing) {
          set(state => ({
            cart: state.cart.map(item =>
              item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
            ),
          }));
        } else {
          set(state => ({ cart: [...state.cart, { ...product, quantity: 1 }] }));
        }
      },

      removeFromCart: (id) => set(state => ({ cart: state.cart.filter(item => item.id !== id) })),

      updateQuantity: (id, quantity) => {
        if (quantity <= 0) { get().removeFromCart(id); return; }
        set(state => ({ cart: state.cart.map(item => item.id === id ? { ...item, quantity } : item) }));
      },

      clearCart: () => set({ cart: [] }),
      cartTotal: () => get().cart.reduce((t, i) => t + i.price * i.quantity, 0),
      cartCount: () => get().cart.reduce((t, i) => t + i.quantity, 0),
      getProductsByTheme: (theme) => get().products.filter(p => p.theme === theme),
      getAvailableThemes: () => [...new Set(get().products.map(p => p.theme))].sort(),

      addToWishlist: (productId) => {
        if (get().wishlistItems.some(i => i.source === 'storefront' && i.id === productId)) return;
        set(state => ({ wishlistItems: [...state.wishlistItems, { id: productId, source: 'storefront', addedAt: new Date().toISOString() }] }));
      },

      addCatalogueToWishlist: (s) => {
        if (get().wishlistItems.some(i => i.source === 'catalogue' && i.setNumber === s.setNumber)) return;
        set(state => ({
          wishlistItems: [...state.wishlistItems, {
            id: `cat-${s.setNumber}`, source: 'catalogue', setNumber: s.setNumber,
            name: s.name, imgUrl: s.imgUrl, theme: s.theme, subtheme: s.subtheme,
            year: s.year, addedAt: new Date().toISOString(),
          }],
        }));
      },

      removeFromWishlist: (id) => set(state => ({ wishlistItems: state.wishlistItems.filter(i => i.id !== id) })),
      isInWishlist: (productId) => get().wishlistItems.some(i => i.source === 'storefront' && i.id === productId),
      isCatalogueInWishlist: (setNumber) => get().wishlistItems.some(i => i.source === 'catalogue' && i.setNumber === setNumber),
      getWishlistProducts: () => {
        const ids = get().wishlistItems.filter(i => i.source === 'storefront').map(i => i.id);
        return get().products.filter(p => ids.includes(p.id));
      },
      getWishlistCatalogueItems: () => get().wishlistItems.filter(i => i.source === 'catalogue'),

      addToRecentlyViewed: (productId) => {
        set(state => {
          const filtered = state.recentlyViewed.filter(id => id !== productId);
          return { recentlyViewed: [productId, ...filtered].slice(0, 10) };
        });
      },
      getRecentlyViewedProducts: () => get().recentlyViewed.map(id => get().products.find(p => p.id === id)).filter(Boolean) as Product[],

      setSearchQuery: (query) => set({ searchQuery: query }),
      searchProducts: (query) => {
        const q = (query || get().searchQuery).toLowerCase();
        if (!q.trim()) return get().products;
        return get().products.filter(p =>
          p.name.toLowerCase().includes(q) || p.setNumber.includes(q) || p.theme.toLowerCase().includes(q)
        );
      },

      setFilters: (filters) => set({ filters }),
      getFilteredProducts: (baseProducts) => {
        const { filters } = get();
        const products = baseProducts || get().products;
        return products.filter(p => {
          if (!filters.showSoldOut && p.stock === 0) return false;
          if (filters.themes.length > 0 && !filters.themes.includes(p.theme)) return false;
          if (filters.conditions.length > 0 && !filters.conditions.includes(p.condition)) return false;
          if (p.price < filters.priceRange[0] || p.price > filters.priceRange[1]) return false;
          if (filters.retiredOnly && !p.retired) return false;
          if (p.yearReleased != null) {
            if (p.yearReleased < filters.yearRange[0] || p.yearReleased > filters.yearRange[1]) return false;
          }
          return true;
        });
      },

      clearFilters: () => {
        const pr = get().getPriceRange();
        set({ filters: { themes: [], priceRange: pr, conditions: [], yearRange: [2000, 2030], retiredOnly: false, showSoldOut: false } });
      },

      getPriceRange: (baseProducts) => {
        const products = baseProducts || get().products;
        if (products.length === 0) return [0, 1000];
        const prices = products.map(p => p.price);
        return [Math.floor(Math.min(...prices) / 10) * 10, Math.ceil(Math.max(...prices) / 10) * 10];
      },

      getRecommendedProducts: (productId, limit = 4) => {
        const current = get().products.find(p => p.id === productId);
        if (!current) return [];
        const others = get().products.filter(p => p.id !== productId);
        const same = others.filter(p => p.theme === current.theme);
        if (same.length >= limit) return same.slice(0, limit);
        const ids = new Set(same.map(p => p.id));
        return [...same, ...others.filter(p => !ids.has(p.id)).slice(0, limit - same.length)];
      },

      setProducts: (products) => set({ products }),
    }),
    {
      name: 'kuso-oishii-store',
      partialize: (state) => ({
        cart: state.cart,
        wishlistItems: state.wishlistItems,
        recentlyViewed: state.recentlyViewed,
      }),
    }
  )
);
