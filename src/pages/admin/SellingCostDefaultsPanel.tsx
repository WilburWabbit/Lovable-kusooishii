import { useState, useEffect, useCallback } from "react";
import { invokeWithAuth } from "@/lib/invokeWithAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface DefaultEntry {
  key: string;
  value: number;
}

const LABELS: Record<string, { label: string; suffix: string; description: string; group?: string }> = {
  packaging_cost: { label: "Packaging Cost", suffix: "£", description: "Flat cost per shipment for packaging materials", group: "Cost" },
  risk_reserve_rate: { label: "Risk Reserve Rate", suffix: "%", description: "Percentage of sale price held as reserve for returns/damage", group: "Cost" },
  minimum_profit_amount: { label: "Minimum Profit", suffix: "£", description: "Minimum profit amount required per sale", group: "Pricing" },
  minimum_margin_rate: { label: "Minimum Margin Rate", suffix: "", description: "Minimum margin rate (e.g. 0.15 = 15%)", group: "Pricing" },
  condition_multiplier_1: { label: "Grade 1 Multiplier", suffix: "×", description: "Market price multiplier for Sealed/New condition", group: "Condition" },
  condition_multiplier_2: { label: "Grade 2 Multiplier", suffix: "×", description: "Market price multiplier for Like New condition", group: "Condition" },
  condition_multiplier_3: { label: "Grade 3 Multiplier", suffix: "×", description: "Market price multiplier for Good condition", group: "Condition" },
  condition_multiplier_4: { label: "Grade 4 Multiplier", suffix: "×", description: "Market price multiplier for Fair condition", group: "Condition" },
};

export function SellingCostDefaultsPanel() {
  const { toast } = useToast();
  const [defaults, setDefaults] = useState<DefaultEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await invokeWithAuth<DefaultEntry[]>("admin-data", { action: "list-selling-cost-defaults" });
      setDefaults(data ?? []);
    } catch (err) {
      toast({ title: "Failed to load defaults", description: (err as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const saveDefault = async (key: string, value: number) => {
    setSaving(key);
    try {
      await invokeWithAuth("admin-data", { action: "upsert-selling-cost-default", key, value });
      toast({ title: "Default saved" });
    } catch (err) {
      toast({ title: "Save failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const updateValue = (key: string, value: number) => {
    setDefaults(prev => prev.map(d => d.key === key ? { ...d, value } : d));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-base">Selling Cost Defaults</CardTitle>
        <CardDescription className="font-body text-xs">
          Global defaults used in the cost-to-sell calculation for all channels.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <div className="space-y-6">
            {/* Group defaults by category */}
            {["Cost", "Pricing", "Condition"].map((group) => {
              const groupDefaults = defaults.filter((d) => {
                const meta = LABELS[d.key];
                return meta?.group === group;
              });
              if (groupDefaults.length === 0) return null;
              return (
                <div key={group}>
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">{group}</h4>
                  <div className="space-y-4">
                    {groupDefaults.map((d) => {
                      const meta = LABELS[d.key] ?? { label: d.key, suffix: "", description: "" };
                      return (
                        <div key={d.key} className="flex items-end gap-3">
                          <div className="flex-1 space-y-1">
                            <Label>{meta.label}</Label>
                            <p className="text-xs text-muted-foreground">{meta.description}</p>
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm text-muted-foreground">{meta.suffix}</span>
                              <Input
                                type="number"
                                step="0.01"
                                className="w-32"
                                value={d.value}
                                onChange={(e) => updateValue(d.key, Number(e.target.value))}
                              />
                            </div>
                          </div>
                          <Button size="sm" variant="outline" onClick={() => saveDefault(d.key, d.value)} disabled={saving === d.key}>
                            {saving === d.key ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
                            Save
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {/* Ungrouped defaults */}
            {defaults.filter((d) => !LABELS[d.key]?.group).map((d) => {
              const meta = LABELS[d.key] ?? { label: d.key, suffix: "", description: "" };
              return (
                <div key={d.key} className="flex items-end gap-3">
                  <div className="flex-1 space-y-1">
                    <Label>{meta.label}</Label>
                    <p className="text-xs text-muted-foreground">{meta.description}</p>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm text-muted-foreground">{meta.suffix}</span>
                      <Input
                        type="number"
                        step="0.01"
                        className="w-32"
                        value={d.value}
                        onChange={(e) => updateValue(d.key, Number(e.target.value))}
                      />
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => saveDefault(d.key, d.value)} disabled={saving === d.key}>
                    {saving === d.key ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
                    Save
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
