-- Add supervisor to app_role enum if not present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'app_role' AND e.enumlabel = 'supervisor'
  ) THEN
    ALTER TYPE public.app_role ADD VALUE 'supervisor';
  END IF;
END $$;

-- Activity log table
CREATE TABLE IF NOT EXISTS public.user_activity_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  action text NOT NULL,
  details jsonb DEFAULT '{}'::jsonb,
  user_agent text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.user_activity_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users insert own activity" ON public.user_activity_logs;
CREATE POLICY "Users insert own activity"
  ON public.user_activity_logs FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users view own activity" ON public.user_activity_logs;
CREATE POLICY "Users view own activity"
  ON public.user_activity_logs FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins view all activity" ON public.user_activity_logs;
CREATE POLICY "Admins view all activity"
  ON public.user_activity_logs FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS user_activity_logs_user_id_idx ON public.user_activity_logs(user_id, created_at DESC);
