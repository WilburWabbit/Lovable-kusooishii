import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ContentTabShell } from "./ContentTabShell";
import { ArrayEditor } from "./ArrayEditor";
import { HOME_DEFAULTS, type HomeContent } from "@/lib/content-defaults";

export function HomeTab() {
  return (
    <ContentTabShell pageKey="home" defaults={HOME_DEFAULTS as unknown as Record<string, unknown>}>
      {(value, setValue) => {
        const v = value as unknown as HomeContent;
        const set = (patch: Partial<HomeContent>) =>
          setValue({ ...value, ...patch } as unknown as Record<string, unknown>);
        return (
          <>
            <Card>
              <CardHeader><CardTitle className="font-display text-sm">Hero Section</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label className="font-display text-xs">Tagline</Label>
                  <Input value={v.hero.tagline} onChange={(e) => set({ hero: { ...v.hero, tagline: e.target.value } })} className="font-body" />
                </div>
                <div>
                  <Label className="font-display text-xs">Heading</Label>
                  <Input value={v.hero.heading} onChange={(e) => set({ hero: { ...v.hero, heading: e.target.value } })} className="font-body" />
                </div>
                <div>
                  <Label className="font-display text-xs">Description</Label>
                  <Textarea value={v.hero.description} onChange={(e) => set({ hero: { ...v.hero, description: e.target.value } })} rows={3} className="font-body text-sm" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="font-display text-sm">Value Propositions</CardTitle></CardHeader>
              <CardContent>
                <ArrayEditor
                  items={v.valueProps}
                  onChange={(vp) => set({ valueProps: vp })}
                  addLabel="Add value prop"
                  createItem={() => ({ title: "", desc: "", iconKey: "shield" })}
                  renderItem={(item, _i, update) => (
                    <div className="grid grid-cols-3 gap-2 border border-border rounded-sm p-2">
                      <div>
                        <Label className="font-display text-xs">Title</Label>
                        <Input value={item.title} onChange={(e) => update({ ...item, title: e.target.value })} className="font-body text-sm" />
                      </div>
                      <div>
                        <Label className="font-display text-xs">Description</Label>
                        <Input value={item.desc} onChange={(e) => update({ ...item, desc: e.target.value })} className="font-body text-sm" />
                      </div>
                      <div>
                        <Label className="font-display text-xs">Icon key</Label>
                        <Input value={item.iconKey} onChange={(e) => update({ ...item, iconKey: e.target.value })} placeholder="shield, truck, bell" className="font-body text-sm" />
                      </div>
                    </div>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="font-display text-sm">CTA Section</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label className="font-display text-xs">Heading</Label>
                  <Input value={v.cta.heading} onChange={(e) => set({ cta: { ...v.cta, heading: e.target.value } })} className="font-body" />
                </div>
                <div>
                  <Label className="font-display text-xs">Description</Label>
                  <Textarea value={v.cta.description} onChange={(e) => set({ cta: { ...v.cta, description: e.target.value } })} rows={2} className="font-body text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="font-display text-xs">Button text</Label>
                    <Input value={v.cta.buttonText} onChange={(e) => set({ cta: { ...v.cta, buttonText: e.target.value } })} className="font-body" />
                  </div>
                  <div>
                    <Label className="font-display text-xs">Button link</Label>
                    <Input value={v.cta.buttonLink} onChange={(e) => set({ cta: { ...v.cta, buttonLink: e.target.value } })} className="font-body" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        );
      }}
    </ContentTabShell>
  );
}
