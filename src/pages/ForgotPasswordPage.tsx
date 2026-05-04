import { useState } from "react";
import { Link } from "react-router-dom";
import { StorefrontLayout } from "@/components/StorefrontLayout";
import { usePageSeo } from "@/hooks/use-page-seo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export default function ForgotPasswordPage() {
  usePageSeo({ title: 'Reset Password', description: 'Request a password reset link for your Kuso Oishii account.', path: '/forgotpassword', noIndex: true });
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (error) {
      toast.error(error.message);
    } else {
      setSent(true);
    }
    setLoading(false);
  };

  return (
    <StorefrontLayout>
      <div className="flex min-h-[70vh] items-center justify-center bg-background">
        <div className="w-full max-w-sm px-4">
          {sent ? (
            <div className="text-center">
              <h1 className="font-display text-2xl font-bold text-foreground">Check your email</h1>
              <p className="mt-2 font-body text-sm text-muted-foreground">
                We've sent a password reset link to <strong>{email}</strong>.
              </p>
              <Link to="/login" className="mt-6 inline-block font-display text-sm font-medium text-primary hover:underline">
                Back to sign in
              </Link>
            </div>
          ) : (
            <>
              <div className="text-center">
                <h1 className="font-display text-2xl font-bold text-foreground">Reset password</h1>
                <p className="mt-2 font-body text-sm text-muted-foreground">
                  Enter your email and we'll send you a reset link.
                </p>
              </div>

              <form onSubmit={handleReset} className="mt-8 space-y-4">
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

                <Button type="submit" className="w-full font-display font-semibold" disabled={loading}>
                  {loading ? "Sending..." : "Send Reset Link"}
                </Button>
              </form>

              <p className="mt-6 text-center font-body text-sm text-muted-foreground">
                <Link to="/login" className="font-medium text-primary hover:underline">
                  Back to sign in
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </StorefrontLayout>
  );
}
