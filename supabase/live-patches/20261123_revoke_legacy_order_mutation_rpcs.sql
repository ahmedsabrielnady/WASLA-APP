-- Applied to Supabase project wasla as migration:
-- revoke_legacy_order_mutation_rpcs
-- Disable obsolete mutation paths in favor of the v2 guarded workflows.
begin;
revoke all on function public.assign_order(uuid, uuid) from public, anon, authenticated;
revoke all on function public.provider_set_order_status(uuid, text, text) from public, anon, authenticated;
revoke all on function public.doctor_set_appointment_status(uuid, text, text) from public, anon, authenticated;
commit;
