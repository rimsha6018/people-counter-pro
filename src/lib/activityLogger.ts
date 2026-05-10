import { supabase } from "@/integrations/supabase/client";

export type ActivityAction =
  | "sign_in"
  | "sign_out"
  | "auto_logout_idle"
  | "export_report"
  | "view_dashboard"
  | "camera_started"
  | "camera_stopped"
  | "employee_registered"
  | "employee_deleted";

export async function logActivity(
  userId: string | undefined,
  action: ActivityAction,
  details: Record<string, unknown> = {},
) {
  if (!userId) return;
  try {
    await supabase.from("user_activity_logs").insert([
      {
        user_id: userId,
        action,
        details: details as never,
        user_agent:
          typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 240) : undefined,
      },
    ]);
  } catch (e) {
    console.warn("activity log failed", e);
  }
}
