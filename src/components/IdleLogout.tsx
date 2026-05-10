import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { logActivity } from "@/lib/activityLogger";

const IDLE_MS = 20 * 60 * 1000; // 20 minutes
const WARN_MS = 60 * 1000; // 1 min warning

export function IdleLogout() {
  const { user, signOut } = useAuth();
  const lastActivity = useRef(Date.now());
  const warned = useRef(false);
  const [, force] = useState(0);

  useEffect(() => {
    if (!user) return;
    const reset = () => {
      lastActivity.current = Date.now();
      if (warned.current) {
        warned.current = false;
        force((n) => n + 1);
      }
    };
    const events = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));

    const interval = window.setInterval(async () => {
      const idle = Date.now() - lastActivity.current;
      if (idle > IDLE_MS) {
        await logActivity(user.id, "auto_logout_idle", { idleMs: idle });
        toast.error("Signed out due to inactivity");
        await signOut();
      } else if (idle > IDLE_MS - WARN_MS && !warned.current) {
        warned.current = true;
        toast.warning("You will be signed out in 1 minute due to inactivity");
      }
    }, 10_000);

    return () => {
      events.forEach((e) => window.removeEventListener(e, reset));
      clearInterval(interval);
    };
  }, [user, signOut]);

  return null;
}
