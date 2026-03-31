interface StickyActionsProps {
  children: React.ReactNode;
}

export function StickyActions({ children }: StickyActionsProps) {
  return (
    <div className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur border-t border-zinc-200 p-3 flex gap-2">
      {children}
    </div>
  );
}
