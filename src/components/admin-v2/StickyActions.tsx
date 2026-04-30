import React from "react";

export function StickyActions({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 flex gap-2 p-3 bg-background/95 backdrop-blur border-t border-border md:hidden">
      {children}
    </div>
  );
}
