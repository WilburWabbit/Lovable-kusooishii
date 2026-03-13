import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ContentTabShell } from "./ContentTabShell";
import { ArrayEditor } from "./ArrayEditor";
import { ABOUT_DEFAULTS, type AboutContent } from "@/lib/content-defaults";

export function AboutTab() {
  return (
    <ContentTabShell pageKey="about" defaults={ABOUT_DEFAULTS as unknown as Record<string, unknown>}>
      {(value, setValue) => {
        const v = value as unknown as AboutContent;
        const set = (patch: Partial<AboutContent>) =>
          setValue({ ...value, ...patch } as unknown as Record<string, unknown>);
        return (
          <>
            <Card>
              <CardHeader><CardTitle className="font-display text-sm">Hero Section</CardTitle></CardHeader>
              <CardContent className="space-y-3">
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
              <CardHeader><CardTitle className="font-display text-sm">The Story</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label className="font-display text-xs">Section heading</Label>
                  <Input value={v.storyHeading} onChange={(e) => set({ storyHeading: e.target.value })} className="font-body" />
                </div>
                <div>
                  <Label className="font-display text-xs">Paragraphs</Label>
                  <ArrayEditor
                    items={v.storyParagraphs}
                    onChange={(p) => set({ storyParagraphs: p })}
                    addLabel="Add paragraph"
                    createItem={() => ""}
                    renderItem={(item, _i, update) => (
                      <Textarea value={item} onChange={(e) => update(e.target.value)} rows={4} className="font-body text-sm" />
                    )}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="font-display text-sm">The Difference</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label className="font-display text-xs">Section heading</Label>
                  <Input value={v.differenceHeading} onChange={(e) => set({ differenceHeading: e.target.value })} className="font-body" />
                </div>
                <ArrayEditor
                  items={v.differenceCards}
                  onChange={(c) => set({ differenceCards: c })}
                  addLabel="Add card"
                  createItem={() => ({ title: "", desc: "", iconKey: "shieldCheck" })}
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
                        <Input value={item.iconKey} onChange={(e) => update({ ...item, iconKey: e.target.value })} className="font-body text-sm" />
                      </div>
                    </div>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="font-display text-sm">How It Works</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label className="font-display text-xs">Section heading</Label>
                  <Input value={v.howItWorksHeading} onChange={(e) => set({ howItWorksHeading: e.target.value })} className="font-body" />
                </div>
                <ArrayEditor
                  items={v.howItWorksSteps}
                  onChange={(s) => set({ howItWorksSteps: s })}
                  addLabel="Add step"
                  createItem={() => ({ title: "", desc: "" })}
                  renderItem={(item, _i, update) => (
                    <div className="grid grid-cols-2 gap-2 border border-border rounded-sm p-2">
                      <div>
                        <Label className="font-display text-xs">Title</Label>
                        <Input value={item.title} onChange={(e) => update({ ...item, title: e.target.value })} className="font-body text-sm" />
                      </div>
                      <div>
                        <Label className="font-display text-xs">Description</Label>
                        <Input value={item.desc} onChange={(e) => update({ ...item, desc: e.target.value })} className="font-body text-sm" />
                      </div>
                    </div>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="font-display text-sm">Circular / Sustainability</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label className="font-display text-xs">Heading</Label>
                  <Input value={v.circular.heading} onChange={(e) => set({ circular: { ...v.circular, heading: e.target.value } })} className="font-body" />
                </div>
                <div>
                  <Label className="font-display text-xs">Description</Label>
                  <Textarea value={v.circular.description} onChange={(e) => set({ circular: { ...v.circular, description: e.target.value } })} rows={3} className="font-body text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="font-display text-xs">Button text</Label>
                    <Input value={v.circular.buttonText} onChange={(e) => set({ circular: { ...v.circular, buttonText: e.target.value } })} className="font-body" />
                  </div>
                  <div>
                    <Label className="font-display text-xs">Button link</Label>
                    <Input value={v.circular.buttonLink} onChange={(e) => set({ circular: { ...v.circular, buttonLink: e.target.value } })} className="font-body" />
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
