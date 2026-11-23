-- Applied to Supabase project wasla as migration:
-- revoke_legacy_order_creation_rpcs
-- Disable obsolete direct RPC paths; public pilot uses place_order_v2 only.
begin;
revoke all on function public.place_order(text, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.place_product_order(integer, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.book_clinic_slot(uuid, timestamptz, text, text) from public, anon, authenticated;
commit;
