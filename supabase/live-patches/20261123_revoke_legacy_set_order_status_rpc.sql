-- Applied to Supabase project wasla as migration:
-- revoke_legacy_set_order_status_rpc
-- Disable the legacy generic status mutator. The current app lifecycle uses
-- the guarded v2 RPCs (staff assignment, provider status, customer cancel).
begin;
revoke all on function public.set_order_status(uuid, text, text) from public, anon, authenticated;
commit;
