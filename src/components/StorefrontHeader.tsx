import { Link } from "react-router-dom";
import { Search, ShoppingBag, User, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export function StorefrontHeader() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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
          <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
            <User className="h-5 w-5" />
          </Button>
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
          </nav>
        </div>
      )}
    </header>
  );
}
