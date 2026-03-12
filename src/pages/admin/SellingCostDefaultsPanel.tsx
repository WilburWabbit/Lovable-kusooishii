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

const LABELS: Record<string, { label: string; suffix: string; description: string }> = {
  packaging_cost: { label: "Packaging Cost", suffix: "£", description: "Flat cost per shipment for packaging materials" },
  risk_reserve_rate: { label: "Risk Reserve Rate", suffix: "%", description: "Percentage of sale price held as reserve for returns/damage" },
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
          <div className="space-y-4">
            {defaults.map((d) => {
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
