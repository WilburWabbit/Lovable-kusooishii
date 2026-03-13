import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ArrayEditor } from "./ArrayEditor";
import type { PolicySection } from "@/lib/content-defaults";

interface SectionEditorProps {
  sections: PolicySection[];
  onChange: (sections: PolicySection[]) => void;
}

export function SectionEditor({ sections, onChange }: SectionEditorProps) {
  return (
    <ArrayEditor
      items={sections}
      onChange={onChange}
      addLabel="Add section"
      createItem={() => ({ title: "", body: "" })}
      renderItem={(item, _i, update) => (
        <div className="space-y-2 border border-border rounded-sm p-3">
          <div>
            <Label className="font-display text-xs">Title</Label>
            <Input
              value={item.title}
              onChange={(e) => update({ ...item, title: e.target.value })}
              className="font-body"
            />
          </div>
          <div>
            <Label className="font-display text-xs">Body</Label>
            <Textarea
              value={item.body}
              onChange={(e) => update({ ...item, body: e.target.value })}
              rows={4}
              className="font-body text-sm"
            />
          </div>
        </div>
      )}
    />
  );
}
