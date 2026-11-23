-- Remove the duplicate audit indexes created during the first roadmap index pass.
-- Keep the canonical indexes created by roadmap_progress_tracker:
-- roadmap_audit_actor_idx and roadmap_audit_milestone_idx.
drop index if exists public.roadmap_milestone_audit_milestone_idx;
drop index if exists public.roadmap_milestone_audit_actor_idx;
