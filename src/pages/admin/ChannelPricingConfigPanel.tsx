import { useState, useEffect, useCallback } from "react";
import { invokeWithAuth } from "@/lib/invokeWithAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Loader2, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";

interface ChannelConfig {
  channel: string;
  auto_price_enabled: boolean;
  max_increase_pct: number | null;
  max_increase_amount: number | null;
  max_decrease_pct: number | null;
  max_decrease_amount: number | null;
}

const CHANNEL_LABELS: Record<string, string> = {
  ebay: "eBay",
  bricklink: "BrickLink",
  brickowl: "BrickOwl",
  web: "Website",
};

export function ChannelPricingConfigPanel() {
  const { toast } = useToast();
  const [configs, setConfigs] = useState<ChannelConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      const data = await invokeWithAuth<ChannelConfig[]>("admin-data", { action: "list-channel-pricing-config" });
      setConfigs(data);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const update = (channel: string, field: keyof ChannelConfig, value: any) => {
    setConfigs((prev) =>
      prev.map((c) => (c.channel === channel ? { ...c, [field]: value } : c))
    );
    setDirty((prev) => ({ ...prev, [channel]: true }));
  };

  const save = async (config: ChannelConfig) => {
    setSaving(config.channel);
    try {
      await invokeWithAuth("admin-data", {
        action: "upsert-channel-pricing-config",
        ...config,
      });
      toast({ title: "Saved", description: `${CHANNEL_LABELS[config.channel]} pricing config updated` });
      setDirty((prev) => ({ ...prev, [config.channel]: false }));
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center p-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Auto-Pricing by Channel</CardTitle>
        <CardDescription>
          When enabled, calculating pricing will automatically update the listed price if the change is within the configured thresholds.
          Leave threshold fields empty for no limit.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {configs.map((config) => (
          <div key={config.channel} className="rounded-lg border p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-medium">{CHANNEL_LABELS[config.channel] ?? config.channel}</span>
                {config.auto_price_enabled && <Badge variant="default" className="text-[10px]">Auto</Badge>}
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  checked={config.auto_price_enabled}
                  onCheckedChange={(v) => update(config.channel, "auto_price_enabled", v)}
                />
                <Label className="text-xs">Enabled</Label>
              </div>
            </div>

            {config.auto_price_enabled && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-3">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Max Price Increase</p>
                  <div className="space-y-1">
                    <Label className="text-xs">Percentage</Label>
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        placeholder="No limit"
                        className="h-8 text-sm"
                        value={config.max_increase_pct != null ? (config.max_increase_pct * 100).toString() : ""}
                        onChange={(e) => update(config.channel, "max_increase_pct", e.target.value ? parseFloat(e.target.value) / 100 : null)}
                      />
                      <span className="text-xs text-muted-foreground">%</span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Fixed Amount</Label>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">£</span>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="No limit"
                        className="h-8 text-sm"
                        value={config.max_increase_amount?.toString() ?? ""}
                        onChange={(e) => update(config.channel, "max_increase_amount", e.target.value ? parseFloat(e.target.value) : null)}
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Max Price Decrease</p>
                  <div className="space-y-1">
                    <Label className="text-xs">Percentage</Label>
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        placeholder="No limit"
                        className="h-8 text-sm"
                        value={config.max_decrease_pct != null ? (config.max_decrease_pct * 100).toString() : ""}
                        onChange={(e) => update(config.channel, "max_decrease_pct", e.target.value ? parseFloat(e.target.value) / 100 : null)}
                      />
                      <span className="text-xs text-muted-foreground">%</span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Fixed Amount</Label>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">£</span>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="No limit"
                        className="h-8 text-sm"
                        value={config.max_decrease_amount?.toString() ?? ""}
                        onChange={(e) => update(config.channel, "max_decrease_amount", e.target.value ? parseFloat(e.target.value) : null)}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {dirty[config.channel] && (
              <Button size="sm" onClick={() => save(config)} disabled={saving === config.channel}>
                {saving === config.channel ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Save className="h-3 w-3 mr-1" />}
                Save
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
