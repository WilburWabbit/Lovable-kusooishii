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
import GmcCallbackPage from "./pages/admin/GmcCallbackPage";
import UsersSettingsPage from "./pages/admin/UsersSettingsPage";
import VatRatesSettingsPage from "./pages/admin/VatRatesSettingsPage";
import IntegrationsSettingsPage from "./pages/admin/IntegrationsSettingsPage";
import SellingFeesSettingsPage from "./pages/admin/SellingFeesSettingsPage";
import ShippingRatesSettingsPage from "./pages/admin/ShippingRatesSettingsPage";
import PricingDashboardPage from "./pages/admin/PricingDashboardPage";
import { LegoCatalogPage } from "./pages/admin/LegoCatalogPage";
import NotFound from "./pages/NotFound";
import { RequireAdmin } from "./components/RequireAdmin";

// Admin V2 pages
import PurchaseListPage from "./pages/admin-v2/PurchaseListPage";
import NewPurchaseFormPage from "./pages/admin-v2/NewPurchaseFormPage";
import BatchDetailPage from "./pages/admin-v2/BatchDetailPage";
import ProductListPage from "./pages/admin-v2/ProductListPage";
import V2ProductDetailPage from "./pages/admin-v2/ProductDetailPage";
import OrderListPage from "./pages/admin-v2/OrderListPage";
import OrderDetailPage from "./pages/admin-v2/OrderDetailPage";
import PayoutListPage from "./pages/admin-v2/PayoutListPage";
import CustomerListPage from "./pages/admin-v2/CustomerListPage";
import CustomerDetailPage from "./pages/admin-v2/CustomerDetailPage";
import V2SettingsPage from "./pages/admin-v2/SettingsPage";
import DataSyncPage from "./pages/admin-v2/DataSyncPage";
import V2IntakePage from "./pages/admin-v2/IntakePage";

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

            {/* Auth */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />

            {/* Member */}
            <Route path="/account" element={<AccountPage />} />

            {/* Back Office */}
            <Route path="/admin" element={<RequireAdmin><AdminDashboard /></RequireAdmin>} />
            <Route path="/admin/intake" element={<RequireAdmin><IntakePage /></RequireAdmin>} />
            <Route path="/admin/inventory" element={<RequireAdmin><InventoryPage /></RequireAdmin>} />
            <Route path="/admin/lego-catalog" element={<RequireAdmin><LegoCatalogPage /></RequireAdmin>} />
            <Route path="/admin/products" element={<RequireAdmin><ProductsPage /></RequireAdmin>} />
            <Route path="/admin/products/:id" element={<RequireAdmin><ProductDetailAdminPage /></RequireAdmin>} />
            <Route path="/admin/listings" element={<RequireAdmin><ListingsPage /></RequireAdmin>} />
            <Route path="/admin/pricing" element={<RequireAdmin><PricingDashboardPage /></RequireAdmin>} />
            <Route path="/admin/orders" element={<RequireAdmin><OrdersPage /></RequireAdmin>} />
            <Route path="/admin/customers" element={<RequireAdmin><CustomersPage /></RequireAdmin>} />
            <Route path="/admin/reconciliation" element={<RequireAdmin><ReconciliationPage /></RequireAdmin>} />
            <Route path="/admin/demand" element={<RequireAdmin><DemandPage /></RequireAdmin>} />
            <Route path="/admin/analytics" element={<RequireAdmin><AnalyticsPage /></RequireAdmin>} />
            <Route path="/admin/audit" element={<RequireAdmin><AuditPage /></RequireAdmin>} />
            <Route path="/admin/settings" element={<RequireAdmin><SettingsPage /></RequireAdmin>} />
            <Route path="/admin/settings/integrations" element={<RequireAdmin><IntegrationsSettingsPage /></RequireAdmin>} />
            <Route path="/admin/settings/selling-fees" element={<RequireAdmin><SellingFeesSettingsPage /></RequireAdmin>} />
            <Route path="/admin/settings/shipping-rates" element={<RequireAdmin><ShippingRatesSettingsPage /></RequireAdmin>} />
            <Route path="/admin/settings/users" element={<RequireAdmin><UsersSettingsPage /></RequireAdmin>} />
            <Route path="/admin/settings/vat-rates" element={<RequireAdmin><VatRatesSettingsPage /></RequireAdmin>} />
            <Route path="/admin/qbo-callback" element={<RequireAdmin><QboCallbackPage /></RequireAdmin>} />
            <Route path="/admin/ebay-callback" element={<RequireAdmin><EbayCallbackPage /></RequireAdmin>} />
            <Route path="/admin/gmc-callback" element={<RequireAdmin><GmcCallbackPage /></RequireAdmin>} />

            {/* Admin V2 */}
            <Route path="/admin/v2/purchases" element={<RequireAdmin><PurchaseListPage /></RequireAdmin>} />
            <Route path="/admin/v2/purchases/new" element={<RequireAdmin><NewPurchaseFormPage /></RequireAdmin>} />
            <Route path="/admin/v2/purchases/:batchId" element={<RequireAdmin><BatchDetailPage /></RequireAdmin>} />
            <Route path="/admin/v2/products" element={<RequireAdmin><ProductListPage /></RequireAdmin>} />
            <Route path="/admin/v2/products/:mpn" element={<RequireAdmin><V2ProductDetailPage /></RequireAdmin>} />
            <Route path="/admin/v2/orders" element={<RequireAdmin><OrderListPage /></RequireAdmin>} />
            <Route path="/admin/v2/orders/:orderId" element={<RequireAdmin><OrderDetailPage /></RequireAdmin>} />
            <Route path="/admin/v2/customers" element={<RequireAdmin><CustomerListPage /></RequireAdmin>} />
            <Route path="/admin/v2/customers/:customerId" element={<RequireAdmin><CustomerDetailPage /></RequireAdmin>} />
            <Route path="/admin/v2/payouts" element={<RequireAdmin><PayoutListPage /></RequireAdmin>} />
            <Route path="/admin/v2/settings" element={<RequireAdmin><V2SettingsPage /></RequireAdmin>} />
            <Route path="/admin/v2/data-sync" element={<RequireAdmin><DataSyncPage /></RequireAdmin>} />
            <Route path="/admin/v2/intake" element={<RequireAdmin><V2IntakePage /></RequireAdmin>} />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
