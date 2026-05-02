import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { RequireAdmin } from "./components/RequireAdmin";

// Eagerly load homepage (LCP-critical)
import Index from "./pages/Index";

// Lazy-load storefront pages
const BrowsePage = lazy(() => import("./pages/BrowsePage"));
const ProductDetailPage = lazy(() => import("./pages/ProductDetailPage"));
const CartPage = lazy(() => import("./pages/CartPage"));
const CheckoutSuccessPage = lazy(() => import("./pages/CheckoutSuccessPage"));

// Lazy-load content pages
const AboutPage = lazy(() => import("./pages/AboutPage"));
const FAQPage = lazy(() => import("./pages/FAQPage"));
const GradingPage = lazy(() => import("./pages/GradingPage"));
const ContactPage = lazy(() => import("./pages/ContactPage"));
const ShippingPolicyPage = lazy(() => import("./pages/ShippingPolicyPage"));
const ReturnsPage = lazy(() => import("./pages/ReturnsPage"));
const OrderTrackingPage = lazy(() => import("./pages/OrderTrackingPage"));
const TermsPage = lazy(() => import("./pages/TermsPage"));
const PrivacyPage = lazy(() => import("./pages/PrivacyPage"));
const BlueBellClubPage = lazy(() => import("./pages/BlueBellClubPage"));
const UnsubscribePage = lazy(() => import("./pages/UnsubscribePage"));

// Lazy-load auth pages
const LoginPage = lazy(() => import("./pages/LoginPage"));
const SignupPage = lazy(() => import("./pages/SignupPage"));
const ForgotPasswordPage = lazy(() => import("./pages/ForgotPasswordPage"));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage"));

// Lazy-load member pages
const AccountPage = lazy(() => import("./pages/AccountPage"));

// Lazy-load eBay QR landing (unauthenticated, infrequently visited)
const WelcomePage = lazy(() => import("./pages/WelcomePage"));

// Lazy-load admin pages
const PurchaseListPage = lazy(() => import("./pages/admin-v2/PurchaseListPage"));
const NewPurchaseFormPage = lazy(() => import("./pages/admin-v2/NewPurchaseFormPage"));
const BatchDetailPage = lazy(() => import("./pages/admin-v2/BatchDetailPage"));
const ProductListPage = lazy(() => import("./pages/admin-v2/ProductListPage"));
const ProductDetailAdminPage = lazy(() => import("./pages/admin-v2/ProductDetailPage"));
const OrderListPage = lazy(() => import("./pages/admin-v2/OrderListPage"));
const OrderDetailPage = lazy(() => import("./pages/admin-v2/OrderDetailPage"));
const PayoutListPage = lazy(() => import("./pages/admin-v2/PayoutListPage"));
const PayoutDetailPage = lazy(() => import("./pages/admin-v2/PayoutDetailPage"));
const CustomerListPage = lazy(() => import("./pages/admin-v2/CustomerListPage"));
const CustomerDetailPage = lazy(() => import("./pages/admin-v2/CustomerDetailPage"));
const ChannelFeesPage = lazy(() => import("./pages/admin-v2/ChannelFeesPage"));
const ShippingRatesPage = lazy(() => import("./pages/admin-v2/ShippingRatesPage"));
const DataSyncPage = lazy(() => import("./pages/admin-v2/DataSyncPage"));
const IntakePage = lazy(() => import("./pages/admin-v2/IntakePage"));
const OperationsPage = lazy(() => import("./pages/admin-v2/OperationsPage"));
const ChannelMappingsSettingsPage = lazy(() => import("./pages/admin-v2/ChannelMappingsSettingsPage"));
const AppHealthPage = lazy(() => import("./pages/admin-v2/AppHealthPage"));
const TranscriptsPage = lazy(() => import("./pages/admin-v2/TranscriptsPage"));
const QboCallbackPage = lazy(() => import("./pages/admin/QboCallbackPage"));
const EbayCallbackPage = lazy(() => import("./pages/admin/EbayCallbackPage"));
const GmcCallbackPage = lazy(() => import("./pages/admin/GmcCallbackPage"));

// Lazy-load 404
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Suspense fallback={<div className="flex h-screen items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>}>
          <Routes>
            {/* Storefront */}
            <Route path="/" element={<Index />} />
            <Route path="/browse" element={<BrowsePage />} />
            <Route path="/themes" element={<Navigate to="/browse?view=themes" replace />} />
            <Route path="/new-arrivals" element={<Navigate to="/browse?new=true" replace />} />
            <Route path="/deals" element={<Navigate to="/browse?deals=true" replace />} />
            <Route path="/sets/:mpn" element={<ProductDetailPage />} />
            <Route path="/shop/p/:mpn" element={<Navigate to="/sets/:mpn" replace />} />
            <Route path="/cart" element={<CartPage />} />
            <Route path="/checkout/success" element={<CheckoutSuccessPage />} />

            {/* Content */}
            <Route path="/about" element={<AboutPage />} />
            <Route path="/faq" element={<FAQPage />} />
            <Route path="/grading" element={<GradingPage />} />
            <Route path="/contact" element={<ContactPage />} />
            <Route path="/shipping-policy" element={<ShippingPolicyPage />} />
            <Route path="/returns-exchanges" element={<ReturnsPage />} />
            <Route path="/order-tracking" element={<OrderTrackingPage />} />
            <Route path="/terms" element={<TermsPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="/bluebell" element={<BlueBellClubPage />} />
            <Route path="/unsubscribe" element={<UnsubscribePage />} />

            {/* Welcome — eBay QR landing (unauthenticated) */}
            <Route path="/welcome/:code" element={<WelcomePage />} />

            {/* Auth */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />

            {/* Member */}
            <Route path="/account" element={<AccountPage />} />

            {/* Admin */}
            <Route path="/admin/purchases" element={<RequireAdmin><PurchaseListPage /></RequireAdmin>} />
            <Route path="/admin/purchases/new" element={<RequireAdmin><NewPurchaseFormPage /></RequireAdmin>} />
            <Route path="/admin/purchases/:batchId" element={<RequireAdmin><BatchDetailPage /></RequireAdmin>} />
            <Route path="/admin/products" element={<RequireAdmin><ProductListPage /></RequireAdmin>} />
            <Route path="/admin/products/:mpn" element={<RequireAdmin><ProductDetailAdminPage /></RequireAdmin>} />
            <Route path="/admin/orders" element={<RequireAdmin><OrderListPage /></RequireAdmin>} />
            <Route path="/admin/orders/:orderId" element={<RequireAdmin><OrderDetailPage /></RequireAdmin>} />
            <Route path="/admin/customers" element={<RequireAdmin><CustomerListPage /></RequireAdmin>} />
            <Route path="/admin/customers/:customerId" element={<RequireAdmin><CustomerDetailPage /></RequireAdmin>} />
            <Route path="/admin/payouts" element={<RequireAdmin><PayoutListPage /></RequireAdmin>} />
            <Route path="/admin/payouts/:payoutId" element={<RequireAdmin><PayoutDetailPage /></RequireAdmin>} />
            <Route path="/admin/pricing" element={<RequireAdmin><ChannelFeesPage /></RequireAdmin>} />
            <Route path="/admin/shipping-rates" element={<RequireAdmin><ShippingRatesPage /></RequireAdmin>} />
            <Route path="/admin/data-sync" element={<RequireAdmin><DataSyncPage /></RequireAdmin>} />
            <Route path="/admin/intake" element={<RequireAdmin><IntakePage /></RequireAdmin>} />
            <Route path="/admin/operations" element={<RequireAdmin><OperationsPage /></RequireAdmin>} />
            <Route path="/admin/settings/channel-mappings" element={<RequireAdmin><ChannelMappingsSettingsPage /></RequireAdmin>} />
            <Route path="/admin/settings/app-health" element={<RequireAdmin><AppHealthPage /></RequireAdmin>} />
            <Route path="/admin/system/transcripts" element={<RequireAdmin><TranscriptsPage /></RequireAdmin>} />
            <Route path="/admin/qbo-callback" element={<RequireAdmin><QboCallbackPage /></RequireAdmin>} />
            <Route path="/admin/ebay-callback" element={<RequireAdmin><EbayCallbackPage /></RequireAdmin>} />
            <Route path="/admin/gmc-callback" element={<RequireAdmin><GmcCallbackPage /></RequireAdmin>} />

            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
