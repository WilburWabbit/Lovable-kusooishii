import { Link } from "react-router-dom";

interface MobileCardProps {
  to: string;
  children: React.ReactNode;
}

export function MobileCard({ to, children }: MobileCardProps) {
  return (
    <Link
      to={to}
      className="block p-4 border-b border-zinc-200 active:bg-zinc-100 transition-colors"
    >
      {children}
    </Link>
  );
}
