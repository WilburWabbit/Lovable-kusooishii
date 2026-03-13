import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface CharLimitFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "input" | "textarea";
  maxLen?: number;
  hint?: string;
  placeholder?: string;
  className?: string;
}

export function CharLimitField({
  id,
  label,
  value,
  onChange,
  type = "input",
  maxLen,
  hint,
  placeholder,
  className,
}: CharLimitFieldProps) {
  const len = value.length;
  const ratio = maxLen ? len / maxLen : 0;
  const isOver = maxLen ? len > maxLen : false;
  const isNear = maxLen ? ratio >= 0.9 && !isOver : false;

  const borderClass = isOver
    ? "border-destructive ring-1 ring-destructive/20"
    : isNear
      ? "border-yellow-500"
      : "";

  return (
    <div className={`${isOver ? "bg-destructive/5 rounded-md p-1.5 -m-1.5" : ""} ${className ?? ""}`}>
      <div className="flex items-center justify-between mb-1.5">
        <Label htmlFor={id} className="text-xs">
          {label}
        </Label>
        {maxLen && (
          <span
            className={`text-[10px] font-mono ${
              isOver ? "text-destructive font-semibold" : isNear ? "text-yellow-600 dark:text-yellow-400" : "text-muted-foreground"
            }`}
          >
            {len}/{maxLen}
          </span>
        )}
      </div>
      {type === "textarea" ? (
        <Textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`text-sm min-h-[80px] ${borderClass}`}
          placeholder={hint ?? placeholder ?? `Enter ${label.toLowerCase()}…`}
        />
      ) : (
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`text-sm ${borderClass}`}
          placeholder={placeholder ?? `Enter ${label.toLowerCase()}…`}
        />
      )}
    </div>
  );
}
