import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { BackOfficeSidebar } from "@/components/BackOfficeSidebar";

interface BackOfficeLayoutProps {
  children: React.ReactNode;
  title?: string;
}

export function BackOfficeLayout({ children, title }: BackOfficeLayoutProps) {
  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <BackOfficeSidebar />
        <div className="flex flex-1 flex-col">
          <header className="flex h-14 items-center gap-4 border-b border-border bg-background px-4">
            <SidebarTrigger />
            {title && (
              <h1 className="font-display text-sm font-semibold text-foreground">{title}</h1>
            )}
          </header>
          <main className="flex-1 bg-kuso-mist p-3 md:p-6">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}
