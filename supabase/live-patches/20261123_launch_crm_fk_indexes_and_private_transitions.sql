-- WASLA launch hardening patch archive
-- Applied to Supabase project wasla as migration:
-- launch_crm_fk_indexes_and_private_transition_table

begin;
create index if not exists crm_interactions_actor_idx on public.crm_interactions (actor_id);
create index if not exists crm_leads_converted_customer_idx on public.crm_leads (converted_customer_id);
create index if not exists crm_ticket_events_actor_idx on public.crm_ticket_events (actor_id);
create index if not exists crm_tickets_assignee_idx on public.crm_tickets (assignee_id);
create index if not exists crm_tickets_order_idx on public.crm_tickets (order_id);
alter table public.order_status_transitions enable row level security;
revoke all on table public.order_status_transitions from public, anon, authenticated;
comment on table public.order_status_transitions is
  'Private state-machine configuration. Application roles have no direct table access; SECURITY DEFINER RPCs read it after authorization checks.';
commit;
