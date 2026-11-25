-- Archive of the live Supabase migration applied on 2026-11-25.
-- Restrict name resolution for SECURITY DEFINER functions to explicitly
-- schema-qualified objects. No EXECUTE grants or application data are changed.

alter function public.accept_consent(text, text) set search_path = '';
alter function public.admin_reset_user_password(text, text) set search_path = '';
alter function public.approve_provider(uuid) set search_path = '';
alter function public.current_provider_id() set search_path = '';
alter function public.current_role_name() set search_path = '';
alter function public.is_staff() set search_path = '';
alter function public.my_order_suggestions() set search_path = '';
alter function public.my_order_tracking(uuid) set search_path = '';
alter function public.set_order_location(uuid, double precision, double precision, text) set search_path = '';
