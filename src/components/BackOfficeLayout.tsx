import { Link, useNavigate } from "react-router-dom";
import { User, LogOut, Shield } from "lucide-react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { BackOfficeSidebar } from "@/components/BackOfficeSidebar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

interface BackOfficeLayoutProps {
  children: React.ReactNode;
  title?: string;
}

export function BackOfficeLayout({ children, title }: BackOfficeLayoutProps) {
  const { user, profile, signOut, isStaffOrAdmin } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
    toast.success("Signed out.");
  };

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
            <div className="ml-auto">
              {user && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
                      <User className="h-5 w-5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <div className="px-2 py-1.5">
                      <p className="font-display text-xs font-semibold text-foreground">
                        {profile?.display_name || "Member"}
                      </p>
                      <p className="font-body text-[11px] text-muted-foreground truncate">{user.email}</p>
                    </div>
                    <DropdownMenuSeparator />
                    {isStaffOrAdmin && (
                      <DropdownMenuItem asChild className="font-body text-sm cursor-pointer">
                        <Link to="/admin"><Shield className="mr-2 h-3.5 w-3.5" /> Admin</Link>
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem asChild className="font-body text-sm cursor-pointer">
                      <Link to="/account">My Account</Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleSignOut} className="font-body text-sm cursor-pointer text-destructive">
                      <LogOut className="mr-2 h-3.5 w-3.5" /> Sign Out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </header>
          <main className="flex-1 bg-kuso-mist p-3 md:p-6">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}
