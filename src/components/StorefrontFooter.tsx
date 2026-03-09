import { Link } from "react-router-dom";

export function StorefrontFooter() {
  return (
    <footer className="border-t border-border bg-kuso-paper">
      <div className="container py-12">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {/* Brand */}
          <div>
            <span className="font-display text-lg font-bold text-foreground">
              KUSO<span className="text-primary">.</span>OISHII
            </span>
            <p className="mt-3 font-body text-sm text-muted-foreground">
              Curated LEGO sets for adult collectors. Graded, priced right, and obsessively catalogued.
            </p>
          </div>

          {/* Shop */}
          <div>
            <h4 className="font-display text-xs font-semibold uppercase tracking-widest text-foreground">Shop</h4>
            <nav className="mt-4 flex flex-col gap-2">
              <Link to="/browse" className="font-body text-sm text-muted-foreground hover:text-foreground">All Sets</Link>
              <Link to="/browse?retired=true" className="font-body text-sm text-muted-foreground hover:text-foreground">Retired Sets</Link>
              <Link to="/browse?new=true" className="font-body text-sm text-muted-foreground hover:text-foreground">New Arrivals</Link>
            </nav>
          </div>

          {/* Support */}
          <div>
            <h4 className="font-display text-xs font-semibold uppercase tracking-widest text-foreground">Support</h4>
            <nav className="mt-4 flex flex-col gap-2">
              <Link to="/grading" className="font-body text-sm text-muted-foreground hover:text-foreground">Grading Guide</Link>
              <Link to="/delivery" className="font-body text-sm text-muted-foreground hover:text-foreground">Delivery & Collection</Link>
              <Link to="/faq" className="font-body text-sm text-muted-foreground hover:text-foreground">FAQ</Link>
            </nav>
          </div>

          {/* Account */}
          <div>
            <h4 className="font-display text-xs font-semibold uppercase tracking-widest text-foreground">Account</h4>
            <nav className="mt-4 flex flex-col gap-2">
              <Link to="/login" className="font-body text-sm text-muted-foreground hover:text-foreground">Sign In</Link>
              <Link to="/account" className="font-body text-sm text-muted-foreground hover:text-foreground">My Account</Link>
              <Link to="/wishlist" className="font-body text-sm text-muted-foreground hover:text-foreground">Wishlist</Link>
            </nav>
          </div>
        </div>

        <div className="mt-12 border-t border-border pt-6">
          <p className="font-body text-xs text-muted-foreground">
            © {new Date().getFullYear()} Kuso Oishii. LEGO® is a trademark of the LEGO Group, which does not sponsor, authorise, or endorse this site.
          </p>
        </div>
      </div>
    </footer>
  );
}
