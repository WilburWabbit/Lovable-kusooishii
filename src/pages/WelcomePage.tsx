import { useEffect, useState } from "react";
import { usePageSeo } from "@/hooks/use-page-seo";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Copy, Check, ShieldCheck, Heart, Package, Star } from "lucide-react";

interface WelcomeData {
  buyer_name: string;
  order_items: Array<{
    mpn: string;
    name: string;
    img_url: string;
    quantity: number;
    sku_code: string;
  }>;
  promo_code: string;
  discount_pct: number;
  redeemed: boolean;
  has_account: boolean;
}

export default function WelcomePage() {
  usePageSeo({ title: 'Welcome', description: 'Welcome to Kuso Oishii.', path: '/welcome', noIndex: true });
  const { code } = useParams<{ code: string }>();
  const [data, setData] = useState<WelcomeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!code) return;
    (async () => {
      try {
        // Edge function is GET with query param — call via fetch with anon key
        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL || ""}/functions/v1/resolve-welcome-code?code=${encodeURIComponent(code)}`,
          {
            headers: {
              apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "",
            },
          }
        );

        if (res.status === 404) {
          setError("not_found");
          return;
        }

        if (!res.ok) {
          setError("error");
          return;
        }

        const json = await res.json();
        setData(json);
      } catch {
        setError("error");
      } finally {
        setLoading(false);
      }
    })();
  }, [code]);

  const copyPromo = async () => {
    if (!data?.promo_code) return;
    await navigator.clipboard.writeText(data.promo_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Loading ──
  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="animate-pulse text-zinc-500 text-sm">Loading…</div>
      </div>
    );
  }

  // ── Error / Not Found ──
  if (error || !data) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center px-6">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold text-white mb-3">
            {error === "not_found" ? "Code not found" : "Something went wrong"}
          </h1>
          <p className="text-zinc-400 mb-6">
            {error === "not_found"
              ? "We can't find that welcome code. It might be a typo — check the URL on your insert card."
              : "We hit a snag loading your welcome page. Give it another go."}
          </p>
          <Link to="/browse">
            <Button variant="outline" className="border-zinc-700 text-zinc-300 hover:bg-zinc-800">
              Browse the shop
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  // ── Redeemed ──
  if (data.redeemed) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center px-6">
        <div className="max-w-md text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/10 mb-4">
            <Check className="h-8 w-8 text-emerald-500" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-3">
            You've already used this one
          </h1>
          <p className="text-zinc-400 mb-6">
            Welcome back, {data.buyer_name}. Your discount has been redeemed — hope you found something brilliant.
          </p>
          <Link to="/browse">
            <Button className="bg-amber-500 text-zinc-900 hover:bg-amber-400 font-bold">
              Keep browsing
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  // ── Main welcome page ──
  const firstName = data.buyer_name.split(" ")[0];

  return (
    <div className="min-h-screen bg-zinc-950">
      {/* Minimal brand header */}
      <header className="border-b border-zinc-800/50 px-6 py-4">
        <Link to="/" className="text-xl font-bold text-white tracking-tight">
          kusooishii
        </Link>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-12">
        {/* Hero */}
        <section className="mb-12">
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-3">
            Cheers, {firstName}.
          </h1>
          <p className="text-lg text-zinc-400 leading-relaxed">
            Thanks for grabbing from us on eBay. We figured you might want to
            skip the middleman next time — same LEGO, better prices, and a
            proper discount to sweeten the deal.
          </p>
        </section>

        {/* Order recap */}
        {data.order_items.length > 0 && (
          <section className="mb-12">
            <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-4">
              What you grabbed
            </h2>
            <div className="space-y-3">
              {data.order_items.map((item, i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3"
                >
                  {item.img_url ? (
                    <img
                      src={item.img_url}
                      alt={item.name}
                      className="w-16 h-16 rounded object-contain bg-white"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded bg-zinc-800 flex items-center justify-center">
                      <Package className="h-6 w-6 text-zinc-600" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-white truncate">
                      {item.name}
                    </p>
                    <p className="text-xs text-zinc-500 font-mono">
                      {item.mpn}
                      {item.quantity > 1 && ` × ${item.quantity}`}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Discount offer */}
        <section className="mb-12">
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-6 text-center">
            <p className="text-sm text-amber-400 font-medium mb-3">
              {data.discount_pct}% off your first order on kusooishii.com
            </p>
            <div className="flex items-center justify-center gap-2 mb-4">
              <span className="text-2xl font-black tracking-widest text-white font-mono">
                {data.promo_code}
              </span>
              <button
                onClick={copyPromo}
                className="p-1.5 rounded-md hover:bg-zinc-800 transition-colors"
                title="Copy code"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-emerald-400" />
                ) : (
                  <Copy className="h-4 w-4 text-zinc-500" />
                )}
              </button>
            </div>
            <p className="text-xs text-zinc-500 mb-5">
              Single use · Cannot be combined with other discounts
            </p>

            {data.has_account ? (
              <Link to="/browse">
                <Button className="bg-amber-500 text-zinc-900 hover:bg-amber-400 font-bold px-8">
                  Start browsing
                </Button>
              </Link>
            ) : (
              <Link to={`/signup?promo=${encodeURIComponent(data.promo_code)}&welcome=${encodeURIComponent(code || "")}`}>
                <Button className="bg-amber-500 text-zinc-900 hover:bg-amber-400 font-bold px-8">
                  Create account & start browsing
                </Button>
              </Link>
            )}
          </div>
        </section>

        {/* Why shop direct */}
        <section className="mb-12">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-4">
            Why shop direct?
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              {
                icon: Star,
                title: "Better prices",
                desc: "No eBay fees means we pass the savings to you.",
              },
              {
                icon: ShieldCheck,
                title: "Kuso Grade transparency",
                desc: "Every set is condition-graded so you know exactly what you're getting.",
              },
              {
                icon: Heart,
                title: "Wishlist & alerts",
                desc: "Wishlist sets you're after and we'll ping you when they land.",
              },
              {
                icon: Package,
                title: "Full order tracking",
                desc: "Track your orders from packed to delivered, no guesswork.",
              },
            ].map((item) => (
              <div
                key={item.title}
                className="rounded-lg border border-zinc-800 bg-zinc-900/30 px-4 py-3"
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <item.icon className="h-4 w-4 text-teal-400" />
                  <h3 className="text-sm font-semibold text-white">
                    {item.title}
                  </h3>
                </div>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-zinc-800/50 pt-6 text-center">
          <p className="text-xs text-zinc-600">
            Already have an account?{" "}
            <Link to="/login" className="text-amber-500 hover:text-amber-400">
              Sign in
            </Link>
          </p>
          <p className="text-xs text-zinc-700 mt-4">
            Kusooishii · Brookville, Norfolk · kusooishii.com
          </p>
        </footer>
      </main>
    </div>
  );
}