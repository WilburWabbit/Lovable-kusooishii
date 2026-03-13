import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

export function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { loading, user, isStaffOrAdmin } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="font-body text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!user || !isStaffOrAdmin) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
