import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HomeTab } from "@/components/admin/content/HomeTab";
import { AboutTab } from "@/components/admin/content/AboutTab";
import { FAQTab } from "@/components/admin/content/FAQTab";
import { ContactTab } from "@/components/admin/content/ContactTab";
import { HeaderTab, FooterTab } from "@/components/admin/content/HeaderFooterTab";
import {
  ShippingTab,
  ReturnsTab,
  PrivacyTab,
  TermsTab,
  OrderTrackingTab,
} from "@/components/admin/content/PolicyTab";

export default function ContentEditorPage() {
  return (
    <BackOfficeLayout title="Content Editor">
      <div className="max-w-4xl">
        <p className="font-body text-sm text-muted-foreground mb-6">
          Edit storefront text content. Changes go live immediately after saving.
        </p>

        <Tabs defaultValue="home">
          <TabsList className="flex flex-wrap h-auto gap-1 bg-transparent p-0 mb-6">
            <TabsTrigger value="home" className="font-display text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Home</TabsTrigger>
            <TabsTrigger value="about" className="font-display text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">About</TabsTrigger>
            <TabsTrigger value="faq" className="font-display text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">FAQ</TabsTrigger>
            <TabsTrigger value="contact" className="font-display text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Contact</TabsTrigger>
            <TabsTrigger value="header" className="font-display text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Header</TabsTrigger>
            <TabsTrigger value="footer" className="font-display text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Footer</TabsTrigger>
            <TabsTrigger value="shipping" className="font-display text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Shipping</TabsTrigger>
            <TabsTrigger value="returns" className="font-display text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Returns</TabsTrigger>
            <TabsTrigger value="privacy" className="font-display text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Privacy</TabsTrigger>
            <TabsTrigger value="terms" className="font-display text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Terms</TabsTrigger>
            <TabsTrigger value="order-tracking" className="font-display text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Order Tracking</TabsTrigger>
          </TabsList>

          <TabsContent value="home"><HomeTab /></TabsContent>
          <TabsContent value="about"><AboutTab /></TabsContent>
          <TabsContent value="faq"><FAQTab /></TabsContent>
          <TabsContent value="contact"><ContactTab /></TabsContent>
          <TabsContent value="header"><HeaderTab /></TabsContent>
          <TabsContent value="footer"><FooterTab /></TabsContent>
          <TabsContent value="shipping"><ShippingTab /></TabsContent>
          <TabsContent value="returns"><ReturnsTab /></TabsContent>
          <TabsContent value="privacy"><PrivacyTab /></TabsContent>
          <TabsContent value="terms"><TermsTab /></TabsContent>
          <TabsContent value="order-tracking"><OrderTrackingTab /></TabsContent>
        </Tabs>
      </div>
    </BackOfficeLayout>
  );
}
