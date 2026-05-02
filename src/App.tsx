import { lazy, Suspense, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { RequireAdmin } from "./components/RequireAdmin";
import { useSeoDocumentPageSeo } from "@/hooks/use-seo-document";

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
const SeoGeoPage = lazy(() => import("./pages/admin-v2/SeoGeoPage"));
const TranscriptsPage = lazy(() => import("./pages/admin-v2/TranscriptsPage"));
const QboCallbackPage = lazy(() => import("./pages/admin/QboCallbackPage"));
const EbayCallbackPage = lazy(() => import("./pages/admin/EbayCallbackPage"));
const GmcCallbackPage = lazy(() => import("./pages/admin/GmcCallbackPage"));

// Lazy-load 404
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

interface NoIndexRouteProps {
  title: string;
  description: string;
  path: string;
  documentKey?: string;
  children: ReactNode;
}

function NoIndexRoute({ title, description, path, documentKey, children }: NoIndexRouteProps) {
  useSeoDocumentPageSeo(documentKey ?? `route:${path}`, { title, description, path, noIndex: true });
  return <>{children}</>;
}

function AdminRoute({ path, children }: Pick<NoIndexRouteProps, "path" | "children">) {
  return (
    <NoIndexRoute
      title="Admin"
      description="Private Kuso Oishii administration area."
      path={path}
      documentKey="route:/admin"
    >
      <RequireAdmin>{children}</RequireAdmin>
    </NoIndexRoute>
  );
}

function LegacyProductRedirect() {
  const { mpn } = useParams<{ mpn: string }>();
  return <Navigate to={mpn ? `/sets/${encodeURIComponent(mpn)}` : "/browse"} replace />;
}

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
            <Route path="/unsubscribe" element={<NoIndexRoute title="Unsubscribe" description="Manage Kuso Oishii email preferences." path="/unsubscribe"><UnsubscribePage /></NoIndexRoute>} />

            {/* Welcome — eBay QR landing (unauthenticated) */}
            <Route path="/welcome/:code" element={<NoIndexRoute title="Welcome" description="Private Kuso Oishii customer welcome page." path="/welcome"><WelcomePage /></NoIndexRoute>} />

            {/* Auth */}
            <Route path="/login" element={<NoIndexRoute title="Sign In" description="Sign in to your Kuso Oishii account." path="/login"><LoginPage /></NoIndexRoute>} />
            <Route path="/signup" element={<NoIndexRoute title="Create Account" description="Create a Kuso Oishii account." path="/signup"><SignupPage /></NoIndexRoute>} />
            <Route path="/forgot-password" element={<NoIndexRoute title="Reset Password" description="Request a Kuso Oishii password reset link." path="/forgot-password"><ForgotPasswordPage /></NoIndexRoute>} />
            <Route path="/reset-password" element={<NoIndexRoute title="Set New Password" description="Set a new Kuso Oishii account password." path="/reset-password"><ResetPasswordPage /></NoIndexRoute>} />

            {/* Member */}
            <Route path="/account" element={<NoIndexRoute title="Account" description="Private Kuso Oishii member account area." path="/account"><AccountPage /></NoIndexRoute>} />

            {/* Admin */}
            <Route path="/admin/purchases" element={<AdminRoute path="/admin/purchases"><PurchaseListPage /></AdminRoute>} />
            <Route path="/admin/purchases/new" element={<AdminRoute path="/admin/purchases/new"><NewPurchaseFormPage /></AdminRoute>} />
            <Route path="/admin/purchases/:batchId" element={<AdminRoute path="/admin/purchases"><BatchDetailPage /></AdminRoute>} />
            <Route path="/admin/products" element={<AdminRoute path="/admin/products"><ProductListPage /></AdminRoute>} />
            <Route path="/admin/products/:mpn" element={<AdminRoute path="/admin/products"><ProductDetailAdminPage /></AdminRoute>} />
            <Route path="/admin/orders" element={<AdminRoute path="/admin/orders"><OrderListPage /></AdminRoute>} />
            <Route path="/admin/orders/:orderId" element={<AdminRoute path="/admin/orders"><OrderDetailPage /></AdminRoute>} />
            <Route path="/admin/customers" element={<AdminRoute path="/admin/customers"><CustomerListPage /></AdminRoute>} />
            <Route path="/admin/customers/:customerId" element={<AdminRoute path="/admin/customers"><CustomerDetailPage /></AdminRoute>} />
            <Route path="/admin/payouts" element={<AdminRoute path="/admin/payouts"><PayoutListPage /></AdminRoute>} />
            <Route path="/admin/payouts/:payoutId" element={<AdminRoute path="/admin/payouts"><PayoutDetailPage /></AdminRoute>} />
            <Route path="/admin/pricing" element={<AdminRoute path="/admin/pricing"><ChannelFeesPage /></AdminRoute>} />
            <Route path="/admin/shipping-rates" element={<AdminRoute path="/admin/shipping-rates"><ShippingRatesPage /></AdminRoute>} />
            <Route path="/admin/data-sync" element={<AdminRoute path="/admin/data-sync"><DataSyncPage /></AdminRoute>} />
            <Route path="/admin/intake" element={<AdminRoute path="/admin/intake"><IntakePage /></AdminRoute>} />
            <Route path="/admin/operations" element={<AdminRoute path="/admin/operations"><OperationsPage /></AdminRoute>} />
            <Route path="/admin/settings/channel-mappings" element={<AdminRoute path="/admin/settings/channel-mappings"><ChannelMappingsSettingsPage /></AdminRoute>} />
            <Route path="/admin/settings/seo-geo" element={<AdminRoute path="/admin/settings/seo-geo"><SeoGeoPage /></AdminRoute>} />
            <Route path="/admin/settings/app-health" element={<AdminRoute path="/admin/settings/app-health"><AppHealthPage /></AdminRoute>} />
            <Route path="/admin/qbo-callback" element={<AdminRoute path="/admin/qbo-callback"><QboCallbackPage /></AdminRoute>} />
            <Route path="/admin/ebay-callback" element={<AdminRoute path="/admin/ebay-callback"><EbayCallbackPage /></AdminRoute>} />
            <Route path="/admin/gmc-callback" element={<AdminRoute path="/admin/gmc-callback"><GmcCallbackPage /></AdminRoute>} />

            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
