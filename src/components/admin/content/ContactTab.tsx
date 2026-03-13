import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ContentTabShell } from "./ContentTabShell";
import { CONTACT_DEFAULTS, type ContactContent } from "@/lib/content-defaults";

export function ContactTab() {
  return (
    <ContentTabShell pageKey="contact" defaults={CONTACT_DEFAULTS as unknown as Record<string, unknown>}>
      {(value, setValue) => {
        const v = value as unknown as ContactContent;
        const set = (patch: Partial<ContactContent>) =>
          setValue({ ...value, ...patch } as unknown as Record<string, unknown>);
        return (
          <Card>
            <CardHeader><CardTitle className="font-display text-sm">Contact Page</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="font-display text-xs">Page title</Label>
                <Input value={v.pageTitle} onChange={(e) => set({ pageTitle: e.target.value })} className="font-body" />
              </div>
              <div>
                <Label className="font-display text-xs">Description</Label>
                <Textarea value={v.pageDescription} onChange={(e) => set({ pageDescription: e.target.value })} rows={2} className="font-body text-sm" />
              </div>
              <div>
                <Label className="font-display text-xs">Email</Label>
                <Input value={v.email} onChange={(e) => set({ email: e.target.value })} className="font-body" />
              </div>
              <div>
                <Label className="font-display text-xs">Location</Label>
                <Input value={v.location} onChange={(e) => set({ location: e.target.value })} className="font-body" />
              </div>
              <div>
                <Label className="font-display text-xs">Response time</Label>
                <Input value={v.responseTime} onChange={(e) => set({ responseTime: e.target.value })} className="font-body" />
              </div>
            </CardContent>
          </Card>
        );
      }}
    </ContentTabShell>
  );
}
