-- Additional indexes added after the roadmap progress tracker was deployed.
create index if not exists roadmap_milestone_audit_milestone_idx on public.roadmap_milestone_audit(milestone_id);
create index if not exists roadmap_milestone_audit_actor_idx on public.roadmap_milestone_audit(actor_id);
