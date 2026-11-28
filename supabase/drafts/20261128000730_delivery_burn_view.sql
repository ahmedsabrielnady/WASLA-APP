-- wasla-test ONLY. Draft. Cumulative cost of the delivery launch plan for the founder: free promo cost plus the deliberate inside-Shibin subsidy (customer fee below courier pay).
-- Per Ahmed's relayed decision (main, Nov 27): inside Shibin the customer pays 10, the courier gets 18, Wasla pays the 8 difference on purpose.
-- Counts non-cancelled deliveries, the same basis as the promo budget. The cap shown is the main promo budget cap; whether the subsidy counts against that same cap is the founder's call, so both parts are shown separately.
create or replace function public.staff_delivery_burn()
returns table(out_free_count int, out_free_cost_egp int, out_subsidy_count int, out_subsidy_egp int, out_total_burn_egp int, out_cap_egp int, out_remaining_egp int)
language plpgsql security definer set search_path = '' as $$
declare v_free int; v_free_cost int; v_sc int; v_s int; v_cap int;
begin
 if not coalesce(public.is_staff(), false) then raise exception 'غير مصرح' using errcode='42501'; end if;
 select count(*) filter (where promo_applied), coalesce(sum(courier_pay_egp) filter (where promo_applied),0),
  count(*) filter (where not promo_applied and platform_share_egp < 0), coalesce(-sum(platform_share_egp) filter (where not promo_applied and platform_share_egp < 0),0)
 into v_free, v_free_cost, v_sc, v_s from public.delivery_requests where status <> 'cancelled';
 select budget_cap_egp into v_cap from public.delivery_promo where id = 1;
 return query select v_free, v_free_cost, v_sc, v_s, v_free_cost + v_s, coalesce(v_cap,0), coalesce(v_cap,0) - (v_free_cost + v_s);
end $$;
revoke all on function public.staff_delivery_burn() from public, anon;
grant execute on function public.staff_delivery_burn() to authenticated;
