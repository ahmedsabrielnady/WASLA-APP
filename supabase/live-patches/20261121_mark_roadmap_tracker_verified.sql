-- Mark the roadmap dashboard milestone as complete after the browser/SQL QA passed.
-- This is a system-maintained milestone update; no human admin identity is asserted.
update public.roadmap_milestones
   set status='done',
       progress_percent=100,
       test_status='passed'
 where id='roadmap-dashboard'
   and status='planned'
   and progress_percent=0
   and test_status='not_tested';
