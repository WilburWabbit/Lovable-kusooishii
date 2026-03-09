import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index";
import BrowsePage from "./pages/BrowsePage";
import ProductDetailPage from "./pages/ProductDetailPage";
import AdminDashboard from "./pages/admin/Dashboard";
import {
  IntakePage,
  InventoryPage,
  ListingsPage,
  OrdersPage,
  ReconciliationPage,
  DemandPage,
  AnalyticsPage,
  AuditPage,
  SettingsPage,
} from "./pages/admin/AdminPages";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          {/* Storefront */}
          <Route path="/" element={<Index />} />
          <Route path="/browse" element={<BrowsePage />} />
          <Route path="/sets/:mpn" element={<ProductDetailPage />} />

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

          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
