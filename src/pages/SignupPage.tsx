import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { StorefrontLayout } from "@/components/StorefrontLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export default function SignupPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters.");
      return;
    }
    setLoading(true);

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: { display_name: displayName },
      },
    });

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Check your email to confirm your account.");
      navigate("/login");
    }
    setLoading(false);
  };

  return (
    <StorefrontLayout>
      <div className="flex min-h-[70vh] items-center justify-center bg-background">
        <div className="w-full max-w-sm px-4">
          <div className="text-center">
            <h1 className="font-display text-2xl font-bold text-foreground">Create account</h1>
            <p className="mt-2 font-body text-sm text-muted-foreground">
              Join the collectors. Get wishlists, stock alerts, and club access.
            </p>
          </div>

          <form onSubmit={handleSignup} className="mt-8 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name" className="font-display text-xs font-semibold uppercase tracking-widest">
                Display Name
              </Label>
              <Input
                id="name"
                type="text"
                placeholder="Your name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                className="font-body"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email" className="font-display text-xs font-semibold uppercase tracking-widest">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="font-body"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="font-display text-xs font-semibold uppercase tracking-widest">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="Min 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="font-body"
              />
            </div>

            <Button type="submit" className="w-full font-display font-semibold" disabled={loading}>
              {loading ? "Creating account..." : "Create Account"}
            </Button>
          </form>

          <p className="mt-6 text-center font-body text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link to="/login" className="font-medium text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </StorefrontLayout>
  );
}
