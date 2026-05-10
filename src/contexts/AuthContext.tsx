import { createContext, useContext, useEffect, useState, ReactNode, useRef } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { capabilitiesFor, type AppRole, type RoleCapabilities } from "@/lib/permissions";
import { logActivity } from "@/lib/activityLogger";

interface AuthCtx {
  user: User | null;
  session: Session | null;
  roles: AppRole[];
  isAdmin: boolean;
  isSupervisor: boolean;
  caps: RoleCapabilities;
  loading: boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({} as AuthCtx);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);
  const lastSignedInUser = useRef<string | null>(null);

  useEffect(() => {
    const fetchRoles = async (uid: string) => {
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", uid);
      setRoles(((data ?? []).map((r: any) => r.role) as AppRole[]) ?? []);
    };

    const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      if (sess?.user) {
        setTimeout(() => fetchRoles(sess.user.id), 0);
        if (event === "SIGNED_IN" && lastSignedInUser.current !== sess.user.id) {
          lastSignedInUser.current = sess.user.id;
          setTimeout(() => logActivity(sess.user.id, "sign_in"), 0);
        }
      } else {
        setRoles([]);
      }
    });

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      setLoading(false);
      if (s?.user) {
        lastSignedInUser.current = s.user.id;
        fetchRoles(s.user.id);
      }
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    if (user) await logActivity(user.id, "sign_out");
    await supabase.auth.signOut();
  };

  const isAdmin = roles.includes("admin");
  const isSupervisor = roles.includes("supervisor");
  const caps = capabilitiesFor(roles);

  return (
    <Ctx.Provider value={{ user, session, roles, isAdmin, isSupervisor, caps, loading, signOut }}>
      {children}
    </Ctx.Provider>
  );
};

export const useAuth = () => useContext(Ctx);
