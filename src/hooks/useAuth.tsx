import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";
import { setGTMUserId, trackLogin, trackSignUp, consumeAuthAction } from "@/lib/gtm-ecommerce";

interface ProfileData {
  display_name: string | null;
  avatar_url: string | null;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  phone: string | null;
  mobile: string | null;
  ebay_username: string | null;
  facebook_handle: string | null;
  instagram_handle: string | null;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: ProfileData | null;
  roles: string[];
  loading: boolean;
  signOut: () => Promise<void>;
  isStaffOrAdmin: boolean;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  profile: null,
  roles: [],
  loading: true,
  signOut: async () => {},
  isStaffOrAdmin: false,
  refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from("profile")
      .select("display_name, avatar_url, phone")
      .eq("user_id", userId)
      .single();
    setProfile(data ? {
      display_name: data.display_name,
      avatar_url: data.avatar_url,
      first_name: null,
      last_name: null,
      company_name: null,
      phone: data.phone,
      mobile: null,
      ebay_username: null,
      facebook_handle: null,
      instagram_handle: null,
    } : null);
  }, []);

  const fetchRoles = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    setRoles(data?.map((r) => r.role) ?? []);
  }, []);

  useEffect(() => {
    let initialLoadDone = false;

    // Set up listener BEFORE getSession.
    // IMPORTANT: This callback must NOT be async — GoTrue holds an internal
    // navigator.locks lock during the callback. Awaiting Supabase queries
    // inside it causes a 5s lock timeout → "Lock was stolen" AbortError
    // that breaks ALL subsequent Supabase client operations.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          setGTMUserId(session.user.id);
          const pending = consumeAuthAction();
          if (pending) {
            if (pending.action === 'login') trackLogin(pending.method);
            else if (pending.action === 'sign_up') trackSignUp(pending.method);
          }
          // Fire-and-forget — never await inside this callback
          fetchProfile(session.user.id);
          fetchRoles(session.user.id);
        } else {
          setGTMUserId(null);
          setProfile(null);
          setRoles([]);
        }
        // Only set loading=false for subsequent auth events (login/logout),
        // not the initial session (handled by getSession below which awaits roles)
        if (initialLoadDone) {
          setLoading(false);
        }
      }
    );

    // getSession doesn't hold a GoTrue lock, so we can safely await here.
    // This ensures roles are loaded before RequireAdmin checks isStaffOrAdmin.
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        setGTMUserId(session.user.id);
        await Promise.all([
          fetchProfile(session.user.id),
          fetchRoles(session.user.id),
        ]);
      }
      initialLoadDone = true;
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchProfile, fetchRoles]);

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
    setRoles([]);
  };

  const isStaffOrAdmin = roles.includes("admin") || roles.includes("staff");

  const refreshProfile = async () => {
    if (user) {
      await fetchProfile(user.id);
    }
  };

  return (
    <AuthContext.Provider value={{ user, session, profile, roles, loading, signOut, isStaffOrAdmin, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
