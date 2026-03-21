import { useState, useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ShoppingBag, Search, Menu, X, Heart, User, LogOut, Store, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger } from
'@/components/ui/dropdown-menu';
import { useStore } from '@/lib/store';
import { useAuth } from '@/hooks/useAuth';
import SearchBar from '@/components/SearchBar';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export function StorefrontHeader() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const location = useLocation();
  const cartCount = useStore((state) => state.cartCount());
  const wishlistItems = useStore((state) => state.wishlistItems);
  const { user, profile, signOut, isStaffOrAdmin } = useAuth();
  const navigate = useNavigate();

  // Check if any non-Mint (grade > 1) items exist for Deals link visibility
  const { data: hasDeals } = useQuery({
    queryKey: ['has_deals'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('browse_catalog', {
        search_term: null, filter_theme_id: null, filter_grade: null, filter_retired: null,
      });
      if (error) throw error;
      return (data as any[]).some(
        (p) => p.best_grade != null && parseInt(p.best_grade, 10) > 1
      );
    },
    staleTime: 5 * 60 * 1000,
  });

  const navItems = useMemo(() => {
    const items = [
      { name: 'Shop', path: '/browse' },
      { name: 'Themes', path: '/browse?view=themes' },
      { name: 'Just Landed', path: '/browse?new=true' },
      ...(hasDeals ? [{ name: 'Deals', path: '/browse?deals=true' }] : []),
      { name: 'About', path: '/about' },
      { name: 'Blue Bell', path: '/bluebell', className: 'text-blue-600 hover:text-blue-700' },
    ];
    return items;
  }, [hasDeals]);


  const isActive = (path: string) => {
    const [pathname, search] = path.split('?');
    if (pathname !== location.pathname) return false;
    if (!search) return !location.search;
    return location.search === `?${search}`;
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
    toast.success('Signed out.');
  };

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="container flex items-center justify-between h-16 text-secondary-foreground">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2">
          <img
            src="/grade-5-red.png"
            alt=""
            aria-hidden="true"
            className="h-9 w-auto shrink-0 object-contain"
          />
          <span className="font-display tracking-tight text-primary text-2xl font-extrabold">
            KUSO OISHII
          </span>
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden lg:flex items-center gap-8">
          {navItems.map((item) =>
          <Link
            key={item.name}
            to={item.path}
            className={`font-body text-sm font-medium transition-colors ${
              item.className
                ? item.className
                : `hover:text-primary ${isActive(item.path) ? 'text-primary' : 'text-muted-foreground'}`
            }`}>
              {item.name}
            </Link>
          )}
        </nav>

        {/* Actions */}
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground" onClick={() => setIsSearchOpen(!isSearchOpen)}>
            <Search className="h-5 w-5" />
          </Button>

          <Link to="/account?tab=wishlist">
            <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground">
              <Heart className="h-5 w-5" />
              {wishlistItems.length > 0 &&
              <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                  {wishlistItems.length}
                </span>
              }
            </Button>
          </Link>

          <Link to="/cart">
            <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground">
              <ShoppingBag className="h-5 w-5" />
              {cartCount > 0 &&
              <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                  {cartCount}
                </span>
              }
            </Button>
          </Link>

          {user ?
          <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
                  <User className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <div className="px-2 py-1.5">
                  <p className="font-display text-xs font-semibold text-foreground">
                    {profile?.display_name || 'Member'}
                  </p>
                  <p className="font-body text-[11px] text-muted-foreground truncate">{user.email}</p>
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
                <DropdownMenuItem asChild className="font-body text-sm cursor-pointer">
                  <Link to="/browse"><Store className="mr-2 h-3.5 w-3.5" /> Store</Link>
                </DropdownMenuItem>
                {isStaffOrAdmin && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild className="font-body text-sm cursor-pointer">
                      <Link to="/admin"><Shield className="mr-2 h-3.5 w-3.5" /> Admin</Link>
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut} className="font-body text-sm cursor-pointer text-destructive">
                  <LogOut className="mr-2 h-3.5 w-3.5" /> Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu> :

          <Button variant="ghost" size="icon" asChild className="text-muted-foreground hover:text-foreground">
              <Link to="/login"><User className="h-5 w-5" /></Link>
            </Button>
          }

          <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground lg:hidden" onClick={() => setIsMenuOpen(!isMenuOpen)}>
            {isMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {/* Mobile Nav */}
      {isMenuOpen &&
      <div className="border-t border-border bg-background px-4 py-6 lg:hidden">
          <nav className="flex flex-col gap-4">
            {navItems.map((item) =>
          <Link
            key={item.name}
            to={item.path}
            className={`font-body text-sm font-medium ${
              item.className
                ? item.className
                : isActive(item.path) ? 'text-primary' : 'text-foreground'
            }`}
            onClick={() => setIsMenuOpen(false)}>
                {item.name}
              </Link>
          )}
            {user ?
          <>
                <Link to="/account" className="font-body text-sm font-medium text-foreground" onClick={() => setIsMenuOpen(false)}>
                  My Account
                </Link>
                <Link to="/browse" className="font-body text-sm font-medium text-foreground" onClick={() => setIsMenuOpen(false)}>
                  Store
                </Link>
                {isStaffOrAdmin && (
                  <Link to="/admin" className="font-body text-sm font-medium text-foreground" onClick={() => setIsMenuOpen(false)}>
                    Admin
                  </Link>
                )}
                <button onClick={() => {handleSignOut();setIsMenuOpen(false);}} className="text-left font-body text-sm font-medium text-destructive">
                  Sign Out
                </button>
              </> :

          <Link to="/login" className="font-body text-sm font-medium text-primary" onClick={() => setIsMenuOpen(false)}>
                Sign In
              </Link>
          }
          </nav>
        </div>
      }

      {/* Search Bar */}
      {isSearchOpen &&
      <div className="border-t border-border bg-background/95 backdrop-blur">
          <div className="container py-4">
            <SearchBar onClose={() => setIsSearchOpen(false)} autoFocus />
          </div>
        </div>
      }
    </header>);

}
