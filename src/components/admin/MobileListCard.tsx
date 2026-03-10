import { Card, CardContent } from "@/components/ui/card";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface MobileListCardProps {
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
  showChevron?: boolean;
}

export function MobileListCard({ onClick, children, className, showChevron = true }: MobileListCardProps) {
  return (
    <Card
      className={cn("cursor-pointer active:bg-muted/50 transition-colors", className)}
      onClick={onClick}
    >
      <CardContent className="p-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">{children}</div>
        {showChevron && <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
      </CardContent>
    </Card>
  );
}

interface MobileListCardRowProps {
  children: React.ReactNode;
  className?: string;
}

export function MobileCardTitle({ children, className }: MobileListCardRowProps) {
  return <p className={cn("text-sm font-medium truncate", className)}>{children}</p>;
}

export function MobileCardMeta({ children, className }: MobileListCardRowProps) {
  return <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground", className)}>{children}</div>;
}

export function MobileCardBadges({ children, className }: MobileListCardRowProps) {
  return <div className={cn("flex flex-wrap items-center gap-1.5 mt-1", className)}>{children}</div>;
}
