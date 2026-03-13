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
import ContactPage from "./pages/ContactPage";
import ShippingPolicyPage from "./pages/ShippingPolicyPage";
import ReturnsPage from "./pages/ReturnsPage";
import OrderTrackingPage from "./pages/OrderTrackingPage";
import TermsPage from "./pages/TermsPage";
import PrivacyPage from "./pages/PrivacyPage";
import AdminDashboard from "./pages/admin/Dashboard";
import {
  ReconciliationPage,
  DemandPage,
  AnalyticsPage,
  AuditPage,
  SettingsPage,
} from "./pages/admin/AdminPages";
import { ListingsPage } from "./pages/admin/ListingsPage";
import { OrdersPage } from "./pages/admin/OrdersPage";
import { CustomersPage } from "./pages/admin/CustomersPage";
import { InventoryPage } from "./pages/admin/InventoryPage";
import { IntakePage } from "./pages/admin/IntakePage";
import { ProductsPage } from "./pages/admin/ProductsPage";
import ProductDetailAdminPage from "./pages/admin/ProductDetailAdminPage";
import QboCallbackPage from "./pages/admin/QboCallbackPage";
import EbayCallbackPage from "./pages/admin/EbayCallbackPage";
import UsersSettingsPage from "./pages/admin/UsersSettingsPage";
import VatRatesSettingsPage from "./pages/admin/VatRatesSettingsPage";
import IntegrationsSettingsPage from "./pages/admin/IntegrationsSettingsPage";
import SellingFeesSettingsPage from "./pages/admin/SellingFeesSettingsPage";
import ShippingRatesSettingsPage from "./pages/admin/ShippingRatesSettingsPage";
import PricingDashboardPage from "./pages/admin/PricingDashboardPage";
import NotFound from "./pages/NotFound";
import { RequireAdmin } from "./components/RequireAdmin";

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
            <Route path="/contact" element={<ContactPage />} />
            <Route path="/shipping-policy" element={<ShippingPolicyPage />} />
            <Route path="/returns-exchanges" element={<ReturnsPage />} />
            <Route path="/order-tracking" element={<OrderTrackingPage />} />
            <Route path="/terms" element={<TermsPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />

            {/* Auth */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />

            {/* Member */}
            <Route path="/account" element={<AccountPage />} />

            {/* Back Office */}
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/admin/intake" element={<IntakePage />} />
            <Route path="/admin/inventory" element={<InventoryPage />} />
            <Route path="/admin/products" element={<ProductsPage />} />
            <Route path="/admin/products/:id" element={<ProductDetailAdminPage />} />
            <Route path="/admin/listings" element={<ListingsPage />} />
            <Route path="/admin/pricing" element={<PricingDashboardPage />} />
            <Route path="/admin/orders" element={<OrdersPage />} />
            <Route path="/admin/customers" element={<CustomersPage />} />
            <Route path="/admin/reconciliation" element={<ReconciliationPage />} />
            <Route path="/admin/demand" element={<DemandPage />} />
            <Route path="/admin/analytics" element={<AnalyticsPage />} />
            <Route path="/admin/audit" element={<AuditPage />} />
            <Route path="/admin/settings" element={<SettingsPage />} />
            <Route path="/admin/settings/integrations" element={<IntegrationsSettingsPage />} />
            <Route path="/admin/settings/selling-fees" element={<SellingFeesSettingsPage />} />
            <Route path="/admin/settings/shipping-rates" element={<ShippingRatesSettingsPage />} />
            <Route path="/admin/settings/users" element={<UsersSettingsPage />} />
            <Route path="/admin/settings/vat-rates" element={<VatRatesSettingsPage />} />
            <Route path="/admin/qbo-callback" element={<QboCallbackPage />} />
            <Route path="/admin/ebay-callback" element={<EbayCallbackPage />} />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
