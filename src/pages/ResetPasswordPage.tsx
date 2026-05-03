import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { StorefrontLayout } from "@/components/StorefrontLayout";
import { usePageSeo } from "@/hooks/use-page-seo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export default function ResetPasswordPage() {
  usePageSeo({ title: 'Set New Password', description: 'Set a new password for your Kuso Oishii account.', path: '/resetpassword', noIndex: true });
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Check for recovery token in URL hash
    const hash = window.location.hash;
    if (hash && hash.includes("type=recovery")) {
      setReady(true);
    } else {
      // Try to detect via session event
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
        if (event === "PASSWORD_RECOVERY") {
          setReady(true);
        }
      });
      return () => subscription.unsubscribe();
    }
  }, []);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters.");
      return;
    }
    setLoading(true);

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Password updated. You're now signed in.");
      navigate("/account");
    }
    setLoading(false);
  };

  return (
    <StorefrontLayout>
      <div className="flex min-h-[70vh] items-center justify-center bg-background">
        <div className="w-full max-w-sm px-4">
          <div className="text-center">
            <h1 className="font-display text-2xl font-bold text-foreground">Set new password</h1>
            <p className="mt-2 font-body text-sm text-muted-foreground">
              {ready ? "Enter your new password below." : "Verifying your reset link..."}
            </p>
          </div>

          {ready && (
            <form onSubmit={handleUpdate} className="mt-8 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password" className="font-display text-xs font-semibold uppercase tracking-widest">
                  New Password
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
                {loading ? "Updating..." : "Update Password"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </StorefrontLayout>
  );
}
