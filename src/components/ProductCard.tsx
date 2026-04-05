import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart, ShoppingBag, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Product, useStore } from '@/lib/store';
import { GRADE_LABELS_NUMERIC } from '@/lib/grades';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { trackAddToCart } from '@/lib/gtm-ecommerce';

interface ProductCardProps {
  product: Product;
  onAddToCart?: (product: Product) => void;
}

const ProductCard = ({ product, onAddToCart }: ProductCardProps) => {
  const addToWishlist = useStore(state => state.addToWishlist);
  const removeFromWishlist = useStore(state => state.removeFromWishlist);
  const isInWishlist = useStore(state => state.isInWishlist);
  const addToCart = useStore(state => state.addToCart);
  const [isHovered, setIsHovered] = useState(false);

  if (!product) return <div className="animate-pulse bg-muted rounded-sm h-96" />;

  const isWishlisted = isInWishlist(product.id);

  const handleAddToCart = (e: React.MouseEvent) => {
    e.preventDefault();
    if (onAddToCart) { onAddToCart(product); }
    else {
      addToCart(product);
      toast.success(`${product.name} added to your cart.`);
    }
    trackAddToCart(product, 1);
  };

  const handleWishlistToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    if (isWishlisted) {
      removeFromWishlist(product.id);
      toast.success(`${product.name} removed from wishlist.`);
    } else {
      addToWishlist(product.id);
      toast.success(`${product.name} added to wishlist.`);
    }
  };

  const savings = product.rrp - product.price;
  const savingsPercent = product.rrp > 0 ? Math.round((savings / product.rrp) * 100) : 0;
  const gradeLabel = GRADE_LABELS_NUMERIC[product.conditionGrade];

  return (
    <div className="group relative flex flex-col overflow-hidden border border-border bg-card transition-all hover:shadow-md">
      <Link to={`/sets/${product.setNumber}`}>
        <div
          className="aspect-square bg-kuso-mist relative overflow-hidden"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          {product.image ? (
            <motion.img
              src={product.image}
              alt={`${product.name} — ${gradeLabel || 'Graded'} LEGO® set`}
              className="w-full h-full object-cover"
              loading="lazy"
              width={400}
              height={400}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, scale: isHovered ? 1.05 : 1 }}
              transition={{ duration: 0.3 }}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <span className="font-display text-4xl font-bold text-muted-foreground/20">
                {product.setNumber.split('-')[0]}
              </span>
            </div>
          )}

          {/* Quick Add — desktop */}
          <div className={`absolute inset-0 bg-foreground/20 hidden md:flex items-center justify-center transition-opacity duration-200 ${isHovered ? 'opacity-100' : 'opacity-0'}`}>
            <Button className="bg-background text-foreground hover:bg-primary hover:text-primary-foreground" onClick={handleAddToCart} size="sm">
              <ShoppingBag className="h-4 w-4 mr-2" /> Add to Cart
            </Button>
          </div>

          {/* Wishlist */}
          <div className="absolute top-3 right-3">
            <Button variant="ghost" size="icon" className="bg-background/80 backdrop-blur-sm hover:bg-background" onClick={handleWishlistToggle}>
              <Heart className={`h-4 w-4 ${isWishlisted ? 'fill-primary text-primary' : 'text-muted-foreground'}`} />
            </Button>
          </div>

          {/* Badges — grade first, then retired */}
          <div className="absolute top-3 left-3 flex gap-1.5">
            {product.conditionGrade && gradeLabel && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="bg-foreground px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-wider text-background">
                    {gradeLabel}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  Condition Grade: {product.conditionGrade} — {gradeLabel}
                </TooltipContent>
              </Tooltip>
            )}
            {product.retired && (
              <span className="bg-primary px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-wider text-primary-foreground">
                Retired
              </span>
            )}
          </div>
        </div>
      </Link>

      {/* Info */}
      <div className="flex flex-1 flex-col p-4 space-y-1.5">
        <Link to={`/sets/${product.setNumber}`}>
          <h3 className="font-display text-sm font-semibold text-foreground group-hover:text-primary transition-colors line-clamp-1">
            {product.name}
          </h3>
        </Link>

        {product.callToAction && (
          <p className="font-body text-xs text-primary italic line-clamp-1">{product.callToAction}</p>
        )}

        <div className="font-body text-[11px] text-muted-foreground">
          #{product.setNumber} · {product.theme} · {product.pieceCount} pcs
        </div>

        <div className="flex items-center justify-between mt-auto pt-2">
          <div className="flex items-center gap-2">
            <span className="font-display text-base font-bold text-foreground">£{product.price.toFixed(2)}</span>
            {savingsPercent > 0 && product.sealedPrice && (
              <span className="font-body text-xs text-muted-foreground line-through">£{product.sealedPrice.toFixed(2)}</span>
            )}
          </div>
          {savingsPercent > 0 && (
            <Badge variant="secondary" className="font-display text-[10px]">Save {savingsPercent}%</Badge>
          )}
        </div>

        {product.stock <= 3 && product.stock > 0 && (
          <div className="flex items-center gap-1 text-xs text-destructive">
            <Package className="h-3 w-3" />
            <span className="font-body">Only {product.stock} left</span>
          </div>
        )}

        {/* Mobile Add to Cart */}
        <Button className="w-full md:hidden mt-2" onClick={handleAddToCart} size="sm" variant="outline">
          <ShoppingBag className="h-4 w-4 mr-2" /> Add to Cart
        </Button>
      </div>
    </div>
  );
};

export default ProductCard;
