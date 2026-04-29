-- Fix mutable search_path
create or replace function public.set_updated_at()
returns trigger language plpgsql
security definer set search_path = public
as $$
begin new.updated_at = now(); return new; end; $$;

-- Lock down trigger functions from direct API execution
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
-- has_role is intentionally callable by authenticated users (used in RLS policies)