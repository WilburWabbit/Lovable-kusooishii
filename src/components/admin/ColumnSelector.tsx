import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { SlidersHorizontal, ChevronUp, ChevronDown } from "lucide-react";

interface ColumnInfo {
  key: string;
  label: string;
}

interface Props {
  allColumns: ColumnInfo[];
  visibleColumns: string[];
  onToggleColumn: (key: string) => void;
  onMoveColumn: (key: string, direction: "up" | "down") => void;
}

export function ColumnSelector({ allColumns, visibleColumns, onToggleColumn, onMoveColumn }: Props) {
  // Show columns in their current visible order, then hidden ones
  const orderedVisible = visibleColumns
    .map((key) => allColumns.find((c) => c.key === key))
    .filter(Boolean) as ColumnInfo[];
  const hidden = allColumns.filter((c) => !visibleColumns.includes(c.key));
  const ordered = [...orderedVisible, ...hidden];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-1.5">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Columns</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2">
        <p className="px-2 py-1 text-xs font-medium text-muted-foreground">Toggle & reorder columns</p>
        <div className="max-h-72 overflow-y-auto space-y-0.5">
          {ordered.map((col) => {
            const isVisible = visibleColumns.includes(col.key);
            const visIdx = visibleColumns.indexOf(col.key);
            return (
              <div key={col.key} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-muted/50">
                <Checkbox
                  checked={isVisible}
                  onCheckedChange={() => onToggleColumn(col.key)}
                  className="h-3.5 w-3.5"
                />
                <span className="flex-1 text-xs">{col.label}</span>
                {isVisible && (
                  <div className="flex gap-0.5">
                    <button
                      className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                      disabled={visIdx <= 0}
                      onClick={() => onMoveColumn(col.key, "up")}
                    >
                      <ChevronUp className="h-3 w-3" />
                    </button>
                    <button
                      className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                      disabled={visIdx >= visibleColumns.length - 1}
                      onClick={() => onMoveColumn(col.key, "down")}
                    >
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
