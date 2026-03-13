import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ContentTabShell } from "./ContentTabShell";
import { FAQEditor } from "./FAQEditor";
import { FAQ_DEFAULTS, type FAQContent } from "@/lib/content-defaults";

export function FAQTab() {
  return (
    <ContentTabShell pageKey="faq" defaults={FAQ_DEFAULTS as unknown as Record<string, unknown>}>
      {(value, setValue) => {
        const v = value as unknown as FAQContent;
        const set = (patch: Partial<FAQContent>) =>
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
              <CardHeader><CardTitle className="font-display text-sm">FAQ Sections & Questions</CardTitle></CardHeader>
              <CardContent>
                <FAQEditor sections={v.sections} onChange={(sections) => set({ sections })} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="font-display text-sm">Footer CTA</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label className="font-display text-xs">CTA text</Label>
                  <Input value={v.ctaText} onChange={(e) => set({ ctaText: e.target.value })} className="font-body" />
                </div>
                <div>
                  <Label className="font-display text-xs">Link text</Label>
                  <Input value={v.ctaLinkText} onChange={(e) => set({ ctaLinkText: e.target.value })} className="font-body" />
                </div>
              </CardContent>
            </Card>
          </>
        );
      }}
    </ContentTabShell>
  );
}
