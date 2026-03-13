import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Save, Loader2 } from "lucide-react";
import { useStorefrontContent, useSaveContent } from "@/hooks/useStorefrontContent";

interface ContentTabShellProps<T extends Record<string, unknown>> {
  pageKey: string;
  defaults: T;
  children: (value: T, setValue: (v: T) => void) => React.ReactNode;
}

export function ContentTabShell<T extends Record<string, unknown>>({
  pageKey,
  defaults,
  children,
}: ContentTabShellProps<T>) {
  const { data, isLoading } = useStorefrontContent(pageKey, defaults);
  const save = useSaveContent<T>(pageKey);
  const [local, setLocal] = useState<T>(defaults);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (data) {
      setLocal(data);
      setDirty(false);
    }
  }, [data]);

  const handleChange = useCallback((v: T) => {
    setLocal(v);
    setDirty(true);
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {children(local, handleChange)}
      <div className="flex justify-end pt-4 border-t border-border">
        <Button
          onClick={() => save.mutate(local)}
          disabled={!dirty || save.isPending}
          className="font-display"
        >
          {save.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Save Changes
        </Button>
      </div>
    </div>
  );
}
