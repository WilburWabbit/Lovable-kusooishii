import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Trash2, Star, Sparkles, Loader2, GripVertical,
} from "lucide-react";

export interface MediaItem {
  id: string;
  media_asset_id: string;
  original_url: string;
  alt_text: string | null;
  sort_order: number;
  is_primary: boolean;
  mime_type: string | null;
  width: number | null;
  height: number | null;
}

interface SortableMediaItemProps {
  item: MediaItem;
  altText: string;
  onAltTextChange: (mediaAssetId: string, value: string) => void;
  onSaveAlt: (item: MediaItem) => void;
  onGenerateAlt: (item: MediaItem) => void;
  onSetPrimary: (item: MediaItem) => void;
  onDelete: (item: MediaItem) => void;
  savingAlt: string | null;
  generatingAlt: string | null;
  settingPrimary: string | null;
  deleting: string | null;
}

export function SortableMediaItem({
  item,
  altText,
  onAltTextChange,
  onSaveAlt,
  onGenerateAlt,
  onSetPrimary,
  onDelete,
  savingAlt,
  generatingAlt,
  settingPrimary,
  deleting,
}: SortableMediaItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex gap-3 border rounded-lg p-3 border-border bg-background"
    >
      {/* Drag handle */}
      <div
        className="flex items-center cursor-grab active:cursor-grabbing touch-none"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4 text-muted-foreground" />
      </div>

      {/* Thumbnail */}
      <div className="relative h-20 w-20 shrink-0 rounded overflow-hidden bg-muted">
        <img
          src={item.original_url}
          alt={altText || "Product image"}
          className="h-full w-full object-cover"
        />
        {item.is_primary && (
          <Badge className="absolute top-1 left-1 text-[8px] px-1 py-0">Primary</Badge>
        )}
      </div>

      {/* Alt text + actions */}
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-center gap-2">
          <Input
            value={altText}
            onChange={(e) => onAltTextChange(item.media_asset_id, e.target.value)}
            placeholder="Alt text…"
            className="text-xs h-7 flex-1"
          />
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            disabled={savingAlt === item.media_asset_id}
            onClick={() => onSaveAlt(item)}
          >
            {savingAlt === item.media_asset_id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
          </Button>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[10px] px-2"
            disabled={generatingAlt === item.media_asset_id}
            onClick={() => onGenerateAlt(item)}
          >
            {generatingAlt === item.media_asset_id ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3 mr-1" />
            )}
            AI Alt Text
          </Button>
          <Button
            size="sm"
            variant={item.is_primary ? "default" : "outline"}
            className="h-6 text-[10px] px-2"
            disabled={item.is_primary || settingPrimary === item.id}
            onClick={() => onSetPrimary(item)}
          >
            {settingPrimary === item.id ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Star className={`h-3 w-3 mr-0.5 ${item.is_primary ? "fill-current" : ""}`} />
            )}
            Primary
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[10px] px-2 text-destructive hover:text-destructive"
            disabled={deleting === item.id}
            onClick={() => onDelete(item)}
          >
            {deleting === item.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[10px] px-2 text-muted-foreground cursor-not-allowed opacity-50"
            disabled
            title="Coming soon — requires schema update to assign images to variants"
          >
            Variant
          </Button>
        </div>
      </div>
    </div>
  );
}
