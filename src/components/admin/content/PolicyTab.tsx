import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ContentTabShell } from "./ContentTabShell";
import { SectionEditor } from "./SectionEditor";
import type { PolicyContent } from "@/lib/content-defaults";
import {
  SHIPPING_DEFAULTS,
  RETURNS_DEFAULTS,
  PRIVACY_DEFAULTS,
  TERMS_DEFAULTS,
  ORDER_TRACKING_DEFAULTS,
} from "@/lib/content-defaults";

interface PolicyTabProps {
  pageKey: string;
  defaults: PolicyContent;
}

function PolicyTabInner({ pageKey, defaults }: PolicyTabProps) {
  return (
    <ContentTabShell pageKey={pageKey} defaults={defaults as unknown as Record<string, unknown>}>
      {(value, setValue) => {
        const v = value as unknown as PolicyContent;
        const set = (patch: Partial<PolicyContent>) =>
          setValue({ ...value, ...patch } as unknown as Record<string, unknown>);
        return (
          <>
            <Card>
              <CardHeader><CardTitle className="font-display text-sm">Page Header</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label className="font-display text-xs">Title</Label>
                  <Input value={v.pageTitle} onChange={(e) => set({ pageTitle: e.target.value })} className="font-body" />
                </div>
                <div>
                  <Label className="font-display text-xs">Subtitle</Label>
                  <Input value={v.pageSubtitle} onChange={(e) => set({ pageSubtitle: e.target.value })} className="font-body" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="font-display text-sm">Sections</CardTitle></CardHeader>
              <CardContent>
                <SectionEditor sections={v.sections} onChange={(sections) => set({ sections })} />
              </CardContent>
            </Card>
          </>
        );
      }}
    </ContentTabShell>
  );
}

export function ShippingTab() {
  return <PolicyTabInner pageKey="shipping" defaults={SHIPPING_DEFAULTS} />;
}

export function ReturnsTab() {
  return <PolicyTabInner pageKey="returns" defaults={RETURNS_DEFAULTS} />;
}

export function PrivacyTab() {
  return <PolicyTabInner pageKey="privacy" defaults={PRIVACY_DEFAULTS} />;
}

export function TermsTab() {
  return <PolicyTabInner pageKey="terms" defaults={TERMS_DEFAULTS} />;
}

export function OrderTrackingTab() {
  return <PolicyTabInner pageKey="order-tracking" defaults={ORDER_TRACKING_DEFAULTS} />;
}
