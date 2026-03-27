import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { StorefrontLayout } from "@/components/StorefrontLayout";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <StorefrontLayout>
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center max-w-md">
          <h1 className="mb-4 font-display text-6xl font-bold text-foreground">404</h1>
          <p className="mb-2 font-display text-xl font-semibold text-foreground">Can't find what you were looking for?</p>
          <p className="mb-8 font-body text-sm text-muted-foreground">Neither could we.</p>
          <a href="/browse" className="font-display text-sm font-medium text-primary hover:underline">
            Go browse the store while we keep looking →
          </a>
        </div>
      </div>
    </StorefrontLayout>
  );
};

export default NotFound;
