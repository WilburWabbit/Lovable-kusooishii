import { Link, useNavigate } from "react-router-dom";
import { Search, ShoppingBag, User, Menu, X, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

export function StorefrontHeader() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
    toast.success("Signed out.");
  };

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="container flex h-16 items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2">
          <span className="font-display text-xl font-bold tracking-tight text-foreground">
            KUSO<span className="text-primary">.</span>OISHII
          </span>
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden items-center gap-8 md:flex">
          <Link to="/browse" className="font-body text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
            Browse Sets
          </Link>
          <Link to="/browse?retired=true" className="font-body text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
            Retired
          </Link>
          <Link to="/browse?theme=star-wars" className="font-body text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
            Themes
          </Link>
          <Link to="/grading" className="font-body text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
            Grading Guide
          </Link>
        </nav>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
            <Search className="h-5 w-5" />
          </Button>

          {user ? (
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
                  <p className="font-body text-[11px] text-muted-foreground truncate">
                    {user.email}
                  </p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild className="font-body text-sm cursor-pointer">
                  <Link to="/account">My Account</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild className="font-body text-sm cursor-pointer">
                  <Link to="/account?tab=wishlist">Wishlist</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild className="font-body text-sm cursor-pointer">
                  <Link to="/account?tab=orders">Orders</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut} className="font-body text-sm cursor-pointer text-destructive">
                  <LogOut className="mr-2 h-3.5 w-3.5" /> Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button variant="ghost" size="icon" asChild className="text-muted-foreground hover:text-foreground">
              <Link to="/login">
                <User className="h-5 w-5" />
              </Link>
            </Button>
          )}

          <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground">
            <ShoppingBag className="h-5 w-5" />
            <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
              0
            </span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground md:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {/* Mobile Nav */}
      {mobileMenuOpen && (
        <div className="border-t border-border bg-background px-4 py-6 md:hidden">
          <nav className="flex flex-col gap-4">
            <Link to="/browse" className="font-body text-sm font-medium text-foreground" onClick={() => setMobileMenuOpen(false)}>
              Browse Sets
            </Link>
            <Link to="/browse?retired=true" className="font-body text-sm font-medium text-foreground" onClick={() => setMobileMenuOpen(false)}>
              Retired
            </Link>
            <Link to="/browse?theme=star-wars" className="font-body text-sm font-medium text-foreground" onClick={() => setMobileMenuOpen(false)}>
              Themes
            </Link>
            <Link to="/grading" className="font-body text-sm font-medium text-foreground" onClick={() => setMobileMenuOpen(false)}>
              Grading Guide
            </Link>
            {user ? (
              <>
                <Link to="/account" className="font-body text-sm font-medium text-foreground" onClick={() => setMobileMenuOpen(false)}>
                  My Account
                </Link>
                <button onClick={() => { handleSignOut(); setMobileMenuOpen(false); }} className="text-left font-body text-sm font-medium text-destructive">
                  Sign Out
                </button>
              </>
            ) : (
              <Link to="/login" className="font-body text-sm font-medium text-primary" onClick={() => setMobileMenuOpen(false)}>
                Sign In
              </Link>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
