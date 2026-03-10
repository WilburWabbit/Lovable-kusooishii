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
import AdminDashboard from "./pages/admin/Dashboard";
import {
  ListingsPage,
  ReconciliationPage,
  DemandPage,
  AnalyticsPage,
  AuditPage,
  SettingsPage,
} from "./pages/admin/AdminPages";
import { OrdersPage } from "./pages/admin/OrdersPage";
import { InventoryPage } from "./pages/admin/InventoryPage";
import { IntakePage } from "./pages/admin/IntakePage";
import QboCallbackPage from "./pages/admin/QboCallbackPage";
import UsersSettingsPage from "./pages/admin/UsersSettingsPage";
import VatRatesSettingsPage from "./pages/admin/VatRatesSettingsPage";
import NotFound from "./pages/NotFound";

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
            <Route path="/admin/listings" element={<ListingsPage />} />
            <Route path="/admin/orders" element={<OrdersPage />} />
            <Route path="/admin/reconciliation" element={<ReconciliationPage />} />
            <Route path="/admin/demand" element={<DemandPage />} />
            <Route path="/admin/analytics" element={<AnalyticsPage />} />
            <Route path="/admin/audit" element={<AuditPage />} />
            <Route path="/admin/settings" element={<SettingsPage />} />
            <Route path="/admin/settings/users" element={<UsersSettingsPage />} />
            <Route path="/admin/settings/vat-rates" element={<VatRatesSettingsPage />} />
            <Route path="/admin/qbo-callback" element={<QboCallbackPage />} />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
