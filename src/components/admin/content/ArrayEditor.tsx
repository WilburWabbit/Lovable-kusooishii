import { Button } from "@/components/ui/button";
import { ArrowUp, ArrowDown, Trash2, Plus } from "lucide-react";

interface ArrayEditorProps<T> {
  items: T[];
  onChange: (items: T[]) => void;
  renderItem: (item: T, index: number, update: (val: T) => void) => React.ReactNode;
  createItem: () => T;
  addLabel?: string;
}

export function ArrayEditor<T>({
  items,
  onChange,
  renderItem,
  createItem,
  addLabel = "Add item",
}: ArrayEditorProps<T>) {
  const move = (from: number, dir: -1 | 1) => {
    const to = from + dir;
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    [next[from], next[to]] = [next[to], next[from]];
    onChange(next);
  };

  const remove = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  const update = (index: number, val: T) => {
    const next = [...items];
    next[index] = val;
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <div key={i} className="flex gap-2 items-start">
          <div className="flex flex-col gap-0.5 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              disabled={i === 0}
              onClick={() => move(i, -1)}
            >
              <ArrowUp className="h-3 w-3" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              disabled={i === items.length - 1}
              onClick={() => move(i, 1)}
            >
              <ArrowDown className="h-3 w-3" />
            </Button>
          </div>
          <div className="flex-1 min-w-0">
            {renderItem(item, i, (val) => update(i, val))}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive shrink-0 mt-1"
            onClick={() => remove(i)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...items, createItem()])}
        className="font-body"
      >
        <Plus className="h-3.5 w-3.5 mr-1.5" />
        {addLabel}
      </Button>
    </div>
  );
}
