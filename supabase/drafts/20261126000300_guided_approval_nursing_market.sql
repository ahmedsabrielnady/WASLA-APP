-- wasla-test ONLY. Draft, not a production migration.
-- Extends provider-to-section checks so the founder's guided approval can cover nursing (doctor or technician) and market (merchant).
-- Patches the two live functions in place and fails loudly if the expected text is not found.
-- Nursing keeps its existing guards: the credential gate trigger on providers and the nursing intake flag on service items.
do $$
declare
  d text;
  old_cov constant text := $q$(v_item.sector='food' and v_provider.kind in ('merchant','courier'))$q$;
  new_cov constant text := $q$(v_item.sector='food' and v_provider.kind in ('merchant','courier')) or (v_item.sector='nursing' and v_provider.kind in ('doctor','technician')) or (v_item.sector='market' and v_provider.kind='merchant')$q$;
  old_app constant text := $q$(p_sector = 'food' and v_provider.kind in ('merchant','courier'))$q$;
  new_app constant text := $q$(p_sector = 'food' and v_provider.kind in ('merchant','courier')) or (p_sector = 'nursing' and v_provider.kind in ('doctor','technician')) or (p_sector = 'market' and v_provider.kind = 'merchant')$q$;
  old_list constant text := $q$('clinic','maintenance','car','education','delivery','food')$q$;
  new_list constant text := $q$('clinic','maintenance','car','education','delivery','food','nursing','market')$q$;
begin
  d := pg_get_functiondef('public.admin_set_provider_service_coverage(uuid,integer,boolean)'::regprocedure);
  if position(old_cov in d) = 0 then raise exception 'coverage function text changed'; end if;
  execute replace(d, old_cov, new_cov);
  d := pg_get_functiondef('public.admin_approve_provider_with_service(uuid,text,text,text,integer)'::regprocedure);
  if position(old_app in d) = 0 or position(old_list in d) = 0 then raise exception 'approval function text changed'; end if;
  execute replace(replace(d, old_app, new_app), old_list, new_list);
end $$;
