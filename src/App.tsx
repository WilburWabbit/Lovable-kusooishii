import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import Index from "./pages/Index";
import BrowsePage from "./pages/BrowsePage";
import ProductDetailPage from "./pages/ProductDetailPage";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import AccountPage from "./pages/AccountPage";
import CartPage from "./pages/CartPage";
import CheckoutSuccessPage from "./pages/CheckoutSuccessPage";
import AboutPage from "./pages/AboutPage";
import FAQPage from "./pages/FAQPage";
import GradingPage from "./pages/GradingPage";
import ContactPage from "./pages/ContactPage";
import ShippingPolicyPage from "./pages/ShippingPolicyPage";
import ReturnsPage from "./pages/ReturnsPage";
import OrderTrackingPage from "./pages/OrderTrackingPage";
import TermsPage from "./pages/TermsPage";
import PrivacyPage from "./pages/PrivacyPage";
import BlueBellClubPage from "./pages/BlueBellClubPage";
import UnsubscribePage from "./pages/UnsubscribePage";
import QboCallbackPage from "./pages/admin/QboCallbackPage";
import EbayCallbackPage from "./pages/admin/EbayCallbackPage";
import GmcCallbackPage from "./pages/admin/GmcCallbackPage";
import WelcomePage from "./pages/WelcomePage";
import NotFound from "./pages/NotFound";
import { RequireAdmin } from "./components/RequireAdmin";

// Admin pages
import PurchaseListPage from "./pages/admin-v2/PurchaseListPage";
import NewPurchaseFormPage from "./pages/admin-v2/NewPurchaseFormPage";
import BatchDetailPage from "./pages/admin-v2/BatchDetailPage";
import ProductListPage from "./pages/admin-v2/ProductListPage";
import ProductDetailAdminPage from "./pages/admin-v2/ProductDetailPage";
import OrderListPage from "./pages/admin-v2/OrderListPage";
import OrderDetailPage from "./pages/admin-v2/OrderDetailPage";
import PayoutListPage from "./pages/admin-v2/PayoutListPage";
import CustomerListPage from "./pages/admin-v2/CustomerListPage";
import CustomerDetailPage from "./pages/admin-v2/CustomerDetailPage";
import AdminSettingsPage from "./pages/admin-v2/SettingsPage";
import DataSyncPage from "./pages/admin-v2/DataSyncPage";
import IntakePage from "./pages/admin-v2/IntakePage";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            {/* Storefront */}
            <Route path="/" element={<Index />} />
            <Route path="/browse" element={<BrowsePage />} />
            <Route path="/sets/:mpn" element={<ProductDetailPage />} />
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

            {/* Welcome (eBay QR landing — unauthenticated) */}
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
            <Route path="/admin/settings" element={<RequireAdmin><AdminSettingsPage /></RequireAdmin>} />
            <Route path="/admin/data-sync" element={<RequireAdmin><DataSyncPage /></RequireAdmin>} />
            <Route path="/admin/intake" element={<RequireAdmin><IntakePage /></RequireAdmin>} />
            <Route path="/admin/qbo-callback" element={<RequireAdmin><QboCallbackPage /></RequireAdmin>} />
            <Route path="/admin/ebay-callback" element={<RequireAdmin><EbayCallbackPage /></RequireAdmin>} />
            <Route path="/admin/gmc-callback" element={<RequireAdmin><GmcCallbackPage /></RequireAdmin>} />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
