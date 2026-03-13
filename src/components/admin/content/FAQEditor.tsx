import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ArrayEditor } from "./ArrayEditor";
import type { FAQSection } from "@/lib/content-defaults";

interface FAQEditorProps {
  sections: FAQSection[];
  onChange: (sections: FAQSection[]) => void;
}

export function FAQEditor({ sections, onChange }: FAQEditorProps) {
  return (
    <ArrayEditor
      items={sections}
      onChange={onChange}
      addLabel="Add section"
      createItem={() => ({ title: "", items: [{ id: crypto.randomUUID().slice(0, 8), q: "", a: "" }] })}
      renderItem={(section, _si, updateSection) => (
        <div className="border border-border rounded-sm p-3 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="font-display text-xs">Section title</Label>
              <Input
                value={section.title}
                onChange={(e) => updateSection({ ...section, title: e.target.value })}
                className="font-body"
              />
            </div>
            <div>
              <Label className="font-display text-xs">Badge (optional)</Label>
              <Input
                value={section.badge ?? ""}
                onChange={(e) =>
                  updateSection({ ...section, badge: e.target.value || undefined })
                }
                placeholder="e.g. Important"
                className="font-body"
              />
            </div>
          </div>

          <div className="pl-4 border-l-2 border-muted">
            <Label className="font-display text-xs mb-2 block">Questions</Label>
            <ArrayEditor
              items={section.items}
              onChange={(items) => updateSection({ ...section, items })}
              addLabel="Add question"
              createItem={() => ({ id: crypto.randomUUID().slice(0, 8), q: "", a: "" })}
              renderItem={(item, _qi, updateItem) => (
                <div className="space-y-2 border border-border rounded-sm p-2 bg-muted/30">
                  <div>
                    <Label className="font-display text-xs">Question</Label>
                    <Input
                      value={item.q}
                      onChange={(e) => updateItem({ ...item, q: e.target.value })}
                      className="font-body text-sm"
                    />
                  </div>
                  <div>
                    <Label className="font-display text-xs">Answer</Label>
                    <Textarea
                      value={item.a}
                      onChange={(e) => updateItem({ ...item, a: e.target.value })}
                      rows={3}
                      className="font-body text-sm"
                    />
                  </div>
                </div>
              )}
            />
          </div>
        </div>
      )}
    />
  );
}
