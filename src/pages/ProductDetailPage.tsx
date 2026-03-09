import { StorefrontLayout } from "@/components/StorefrontLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useParams } from "react-router-dom";
import { ShoppingBag, Heart, Shield, Package, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

const gradeLabels: Record<number, { label: string; desc: string }> = {
  1: { label: "Mint", desc: "Box and contents in near-perfect condition. No visible damage, creasing, or shelf wear." },
  2: { label: "Excellent", desc: "Minor shelf wear or light marks. Contents complete and in great condition." },
  3: { label: "Good", desc: "Noticeable wear, minor creasing, or small marks. Contents complete." },
  4: { label: "Acceptable", desc: "Significant wear, dents or tears. All pieces present but box shows heavy use." },
};

// Mock product data
const mockProduct = {
  mpn: "75367-1",
  name: "Venator-Class Republic Attack Cruiser",
  theme: "Star Wars",
  releaseYear: 2023,
  retired: true,
  pieces: 5374,
  description: "Build and display the ultimate Star Wars Republic capital ship. This UCS-grade set features intricate detailing, opening hangars, and removable bridge section. A worthy centrepiece for any serious collection.",
  offers: [
    { grade: 1, price: 649.99, stock: 1, sku: "75367-1.1" },
    { grade: 2, price: 579.99, stock: 2, sku: "75367-1.2" },
  ],
};

export default function ProductDetailPage() {
  const { mpn } = useParams();
  const product = mockProduct; // In reality, fetch by mpn

  return (
    <StorefrontLayout>
      <div className="bg-background">
        {/* Breadcrumb */}
        <div className="border-b border-border bg-kuso-paper">
          <div className="container flex items-center gap-2 py-3">
            <Link to="/browse" className="flex items-center gap-1 font-body text-xs text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-3 w-3" /> Back to browse
            </Link>
            <span className="font-body text-xs text-muted-foreground">/</span>
            <span className="font-body text-xs text-muted-foreground">{product.theme}</span>
            <span className="font-body text-xs text-muted-foreground">/</span>
            <span className="font-body text-xs text-foreground">{product.mpn}</span>
          </div>
        </div>

        <div className="container py-8 lg:py-12">
          <div className="grid gap-10 lg:grid-cols-2">
            {/* Image */}
            <div className="aspect-square bg-kuso-mist flex items-center justify-center">
              <span className="font-display text-6xl font-bold text-muted-foreground/15">
                {product.mpn.split("-")[0]}
              </span>
            </div>

            {/* Product info */}
            <div>
              <div className="flex items-center gap-2">
                <span className="font-body text-xs text-muted-foreground">{product.theme}</span>
                <span className="font-body text-xs text-muted-foreground">·</span>
                <span className="font-body text-xs text-muted-foreground">{product.mpn}</span>
                {product.retired && (
                  <Badge variant="destructive" className="font-display text-[10px] uppercase tracking-wider">
                    Retired
                  </Badge>
                )}
              </div>

              <h1 className="mt-3 font-display text-2xl font-bold text-foreground lg:text-3xl">
                {product.name}
              </h1>

              <p className="mt-4 font-body text-sm leading-relaxed text-muted-foreground">
                {product.description}
              </p>

              <div className="mt-6 flex gap-6 border-t border-b border-border py-4">
                <div>
                  <p className="font-display text-xs font-semibold uppercase tracking-widest text-muted-foreground">Pieces</p>
                  <p className="mt-1 font-display text-sm font-bold text-foreground">{product.pieces.toLocaleString()}</p>
                </div>
                <div>
                  <p className="font-display text-xs font-semibold uppercase tracking-widest text-muted-foreground">Released</p>
                  <p className="mt-1 font-display text-sm font-bold text-foreground">{product.releaseYear}</p>
                </div>
                <div>
                  <p className="font-display text-xs font-semibold uppercase tracking-widest text-muted-foreground">Variants</p>
                  <p className="mt-1 font-display text-sm font-bold text-foreground">{product.offers.length}</p>
                </div>
              </div>

              {/* Offers by grade */}
              <div className="mt-6 space-y-3">
                <h3 className="font-display text-xs font-semibold uppercase tracking-widest text-foreground">
                  Available Conditions
                </h3>
                {product.offers.map((offer) => (
                  <div
                    key={offer.sku}
                    className="flex items-center justify-between border border-border p-4 transition-colors hover:border-primary"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center bg-foreground font-display text-xs font-bold text-background">
                        G{offer.grade}
                      </div>
                      <div>
                        <p className="font-display text-sm font-semibold text-foreground">
                          {gradeLabels[offer.grade]?.label}
                        </p>
                        <p className="font-body text-xs text-muted-foreground">
                          {gradeLabels[offer.grade]?.desc}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="font-display text-lg font-bold text-foreground">
                          £{offer.price.toFixed(2)}
                        </p>
                        <p className="font-body text-[11px] text-muted-foreground">
                          {offer.stock} in stock
                        </p>
                      </div>
                      <Button size="sm" className="font-display text-xs font-semibold">
                        <ShoppingBag className="mr-1.5 h-3.5 w-3.5" /> Add
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Actions */}
              <div className="mt-6 flex gap-2">
                <Button variant="outline" size="sm" className="font-display text-xs">
                  <Heart className="mr-1.5 h-3.5 w-3.5" /> Add to Wishlist
                </Button>
              </div>

              {/* Trust signals */}
              <div className="mt-8 grid grid-cols-2 gap-3">
                <div className="flex items-start gap-2 rounded bg-kuso-paper p-3">
                  <Shield className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div>
                    <p className="font-display text-xs font-semibold text-foreground">Condition Verified</p>
                    <p className="font-body text-[11px] text-muted-foreground">Inspected & graded before listing</p>
                  </div>
                </div>
                <div className="flex items-start gap-2 rounded bg-kuso-paper p-3">
                  <Package className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div>
                    <p className="font-display text-xs font-semibold text-foreground">Secure Shipping</p>
                    <p className="font-body text-[11px] text-muted-foreground">Double-boxed & insured</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </StorefrontLayout>
  );
}
