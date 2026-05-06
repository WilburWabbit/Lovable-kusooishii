import { Mono } from "./ui-primitives";

export interface TraceMetadataItem {
  label: string;
  value: string | number | null | undefined;
}

function traceValue(value: TraceMetadataItem["value"]): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function shortTrace(value: string): string {
  if (value.length <= 18) return value;
  if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value)) return `${value.slice(0, 8)}...${value.slice(-4)}`;
  return `${value.slice(0, 14)}...`;
}

export function TraceMetadata({
  items,
  max = 4,
  className = "",
}: {
  items: TraceMetadataItem[];
  max?: number;
  className?: string;
}) {
  const visible = items
    .map((item) => ({ ...item, text: traceValue(item.value) }))
    .filter((item): item is TraceMetadataItem & { text: string } => Boolean(item.text))
    .slice(0, max);

  if (visible.length === 0) return null;

  return (
    <div className={`flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-zinc-500 ${className}`}>
      {visible.map((item) => (
        <span key={`${item.label}:${item.text}`} title={`${item.label}: ${item.text}`} className="inline-flex items-center gap-1">
          <span>{item.label}</span>
          <Mono color="dim" className="text-[10px]">{shortTrace(item.text)}</Mono>
        </span>
      ))}
    </div>
  );
}
