import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ContentTabShell } from "./ContentTabShell";
import { ArrayEditor } from "./ArrayEditor";
import {
  HEADER_DEFAULTS, type HeaderContent,
  FOOTER_DEFAULTS, type FooterContent,
} from "@/lib/content-defaults";

export function HeaderTab() {
  return (
    <ContentTabShell pageKey="header" defaults={HEADER_DEFAULTS as unknown as Record<string, unknown>}>
      {(value, setValue) => {
        const v = value as unknown as HeaderContent;
        const set = (patch: Partial<HeaderContent>) =>
          setValue({ ...value, ...patch } as unknown as Record<string, unknown>);
        return (
          <>
            <Card>
              <CardHeader><CardTitle className="font-display text-sm">Header</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label className="font-display text-xs">Logo text</Label>
                  <Input value={v.logo} onChange={(e) => set({ logo: e.target.value })} className="font-body" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="font-display text-sm">Navigation Items</CardTitle></CardHeader>
              <CardContent>
                <ArrayEditor
                  items={v.navItems}
                  onChange={(navItems) => set({ navItems })}
                  addLabel="Add nav item"
                  createItem={() => ({ name: "", path: "/" })}
                  renderItem={(item, _i, update) => (
                    <div className="grid grid-cols-2 gap-2 border border-border rounded-sm p-2">
                      <div>
                        <Label className="font-display text-xs">Label</Label>
                        <Input value={item.name} onChange={(e) => update({ ...item, name: e.target.value })} className="font-body text-sm" />
                      </div>
                      <div>
                        <Label className="font-display text-xs">Path</Label>
                        <Input value={item.path} onChange={(e) => update({ ...item, path: e.target.value })} className="font-body text-sm" />
                      </div>
                    </div>
                  )}
                />
              </CardContent>
            </Card>
          </>
        );
      }}
    </ContentTabShell>
  );
}

export function FooterTab() {
  return (
    <ContentTabShell pageKey="footer" defaults={FOOTER_DEFAULTS as unknown as Record<string, unknown>}>
      {(value, setValue) => {
        const v = value as unknown as FooterContent;
        const set = (patch: Partial<FooterContent>) =>
          setValue({ ...value, ...patch } as unknown as Record<string, unknown>);
        return (
          <>
            <Card>
              <CardHeader><CardTitle className="font-display text-sm">Brand</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label className="font-display text-xs">Tagline</Label>
                  <Textarea value={v.brandTagline} onChange={(e) => set({ brandTagline: e.target.value })} rows={2} className="font-body text-sm" />
                </div>
                <div>
                  <Label className="font-display text-xs">Location</Label>
                  <Input value={v.location} onChange={(e) => set({ location: e.target.value })} className="font-body" />
                </div>
                <div>
                  <Label className="font-display text-xs">Instagram URL</Label>
                  <Input value={v.instagramUrl} onChange={(e) => set({ instagramUrl: e.target.value })} className="font-body" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="font-display text-sm">Quick Links</CardTitle></CardHeader>
              <CardContent>
                <ArrayEditor
                  items={v.quickLinks}
                  onChange={(quickLinks) => set({ quickLinks })}
                  addLabel="Add link"
                  createItem={() => ({ label: "", path: "/" })}
                  renderItem={(item, _i, update) => (
                    <div className="grid grid-cols-2 gap-2 border border-border rounded-sm p-2">
                      <div>
                        <Label className="font-display text-xs">Label</Label>
                        <Input value={item.label} onChange={(e) => update({ ...item, label: e.target.value })} className="font-body text-sm" />
                      </div>
                      <div>
                        <Label className="font-display text-xs">Path</Label>
                        <Input value={item.path} onChange={(e) => update({ ...item, path: e.target.value })} className="font-body text-sm" />
                      </div>
                    </div>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="font-display text-sm">Customer Service Links</CardTitle></CardHeader>
              <CardContent>
                <ArrayEditor
                  items={v.customerServiceLinks}
                  onChange={(customerServiceLinks) => set({ customerServiceLinks })}
                  addLabel="Add link"
                  createItem={() => ({ label: "", path: "/" })}
                  renderItem={(item, _i, update) => (
                    <div className="grid grid-cols-2 gap-2 border border-border rounded-sm p-2">
                      <div>
                        <Label className="font-display text-xs">Label</Label>
                        <Input value={item.label} onChange={(e) => update({ ...item, label: e.target.value })} className="font-body text-sm" />
                      </div>
                      <div>
                        <Label className="font-display text-xs">Path</Label>
                        <Input value={item.path} onChange={(e) => update({ ...item, path: e.target.value })} className="font-body text-sm" />
                      </div>
                    </div>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="font-display text-sm">Newsletter</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label className="font-display text-xs">Heading</Label>
                  <Input value={v.newsletterHeading} onChange={(e) => set({ newsletterHeading: e.target.value })} className="font-body" />
                </div>
                <div>
                  <Label className="font-display text-xs">Description</Label>
                  <Input value={v.newsletterDescription} onChange={(e) => set({ newsletterDescription: e.target.value })} className="font-body" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="font-display text-sm">Legal</CardTitle></CardHeader>
              <CardContent>
                <div>
                  <Label className="font-display text-xs">LEGO trademark disclaimer</Label>
                  <Textarea value={v.disclaimer} onChange={(e) => set({ disclaimer: e.target.value })} rows={2} className="font-body text-sm" />
                </div>
              </CardContent>
            </Card>
          </>
        );
      }}
    </ContentTabShell>
  );
}
