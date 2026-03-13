import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Loader2, Save, X, ImageIcon } from "lucide-react";
import { invokeWithAuth } from "@/lib/invokeWithAuth";
import { toast } from "sonner";

interface AgeRangeExtractorProps {
  productId: string;
  mpn: string;
  currentAgeRange: string | null;
  onSaved: () => void;
}

interface ExtractionResult {
  age_range: string | null;
  confidence: "high" | "not_found" | "low";
  image_used: string | null;
  raw_response?: string;
}

export function AgeRangeExtractor({ productId, mpn, currentAgeRange, onSaved }: AgeRangeExtractorProps) {
  const [url, setUrl] = useState("");
  const [directImageUrl, setDirectImageUrl] = useState("");
  const [showImageFallback, setShowImageFallback] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [editedValue, setEditedValue] = useState("");

  const handleExtract = async (useDirectImage = false) => {
    const payload = useDirectImage
      ? { action: "extract-age-range" as const, image_url: directImageUrl }
      : { action: "extract-age-range" as const, url };

    setExtracting(true);
    setResult(null);
    try {
      const res = await invokeWithAuth<ExtractionResult>("chatgpt", payload);
      setResult(res);
      setEditedValue(res.age_range ?? "");
      if (res.confidence === "not_found") {
        toast.info("Age mark not found in the image");
      }
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (msg.includes("502") || msg.includes("403") || msg.includes("Failed to fetch")) {
        setShowImageFallback(true);
        toast.error("Could not fetch the page. Try pasting a direct image URL instead.");
      } else {
        toast.error(msg);
      }
    } finally {
      setExtracting(false);
    }
  };

  const handleSave = async () => {
    const value = editedValue.trim();
    if (!value) return;
    setSaving(true);
    try {
      await invokeWithAuth("admin-data", {
        action: "update-product",
        product_id: productId,
        age_range: value,
      });
      toast.success(`Age range set to ${value}`);
      setResult(null);
      setUrl("");
      setDirectImageUrl("");
      onSaved();
    } catch (err: any) {
      toast.error(err?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDismiss = () => {
    setResult(null);
    setEditedValue("");
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">
            Age Mark Extraction
          </CardTitle>
          {currentAgeRange && (
            <Badge variant="outline" className="text-xs">
              Current: {currentAgeRange}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* BrickEconomy URL input */}
        <div className="flex gap-2">
          <Input
            placeholder="https://www.brickeconomy.com/set/..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={extracting}
            className="text-sm"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={extracting || !url.trim()}
            onClick={() => handleExtract(false)}
          >
            {extracting ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />
            )}
            {extracting ? "Extracting…" : "Extract"}
          </Button>
        </div>

        {/* Direct image URL fallback */}
        {showImageFallback && (
          <div className="flex gap-2">
            <Input
              placeholder="Direct image URL (fallback)"
              value={directImageUrl}
              onChange={(e) => setDirectImageUrl(e.target.value)}
              disabled={extracting}
              className="text-sm"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={extracting || !directImageUrl.trim()}
              onClick={() => handleExtract(true)}
            >
              <ImageIcon className="h-3.5 w-3.5 mr-1.5" />
              Analyse
            </Button>
          </div>
        )}

        {/* Result display */}
        {result && result.confidence !== "not_found" && (
          <div className="rounded-md border p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Detected:</span>
              {result.confidence === "high" ? (
                <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                  {result.age_range}
                </Badge>
              ) : (
                <>
                  <Input
                    value={editedValue}
                    onChange={(e) => setEditedValue(e.target.value)}
                    className="h-7 w-20 text-sm"
                  />
                  <Badge
                    variant="outline"
                    className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                  >
                    Low confidence
                  </Badge>
                </>
              )}
            </div>
            {result.confidence === "low" && result.raw_response && (
              <p className="text-xs text-muted-foreground">
                Model response: "{result.raw_response}"
              </p>
            )}
            {result.image_used && (
              <img
                src={result.image_used}
                alt={`Set ${mpn} packaging`}
                className="h-24 rounded border border-border object-contain"
              />
            )}
            <div className="flex gap-2 pt-1">
              <Button size="sm" disabled={saving || !editedValue.trim()} onClick={handleSave}>
                <Save className="h-3.5 w-3.5 mr-1.5" />
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button size="sm" variant="ghost" onClick={handleDismiss}>
                <X className="h-3.5 w-3.5 mr-1.5" />
                Dismiss
              </Button>
            </div>
          </div>
        )}

        {result && result.confidence === "not_found" && (
          <p className="text-xs text-muted-foreground">
            No age mark could be identified in the image. Try a different image or enter the value manually.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
