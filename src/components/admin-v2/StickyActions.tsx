import type { ReactNode } from "react";

interface StickyActionsProps {
  children: ReactNode;
}

export function StickyActions({ children }: StickyActionsProps) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white/95 px-4 py-3 shadow-[0_-8px_24px_rgba(24,24,27,0.08)] backdrop-blur lg:hidden">
      <div className="mx-auto flex max-w-3xl gap-2">
        {children}
      </div>
    </div>
  );
}
