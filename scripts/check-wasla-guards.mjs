import { readFileSync } from 'node:fs';

const required = [
  ['index.html', 'homepage'],
  ['admin.html', 'admin'],
  ['founder-announcements.html', 'founder'],
  ['supabase/migrations/20261116_smart_tracking_announcements.sql', 'migration'],
  ['supabase/migrations/20261118_ticker_role_rpc_permissions.sql', 'tickerPermissionsMigration'],
  ['supabase/migrations/20261117_operations_dashboard.sql', 'operationsMigration'],
  ['founder-dashboard.html', 'dashboard'],
  ['manifest.webmanifest', 'manifest'],
  ['sw.js', 'serviceWorker'],
  ['offline.html', 'offline'],
  ['assets/wasla-icon.svg', 'appIcon'],
  ['provider-apply.html', 'providerApply'],
  ['founder-providers.html', 'founderProviders'],
  ['supabase/migrations/20261119_provider_applications.sql', 'providerApplicationsMigration'],
  ['supabase/migrations/20261117_order_lifecycle.sql', 'orderLifecycleMigration'],
  ['supabase/migrations/20261117_courier_dispatch.sql', 'courierMigration'],
  ['courier-apply.html', 'courierApply'],
  ['founder-couriers.html', 'founderCouriers'],
  ['courier-dashboard.html', 'courierDashboard'],
];

const files = new Map();
for (const [path, label] of required) {
  try {
    files.set(label, readFileSync(path, 'utf8'));
  } catch (error) {
    console.error('FAIL missing required file ' + path + ': ' + error.message);
    process.exitCode = 1;
  }
}

if (process.exitCode) process.exit();

const checks = [
  ['homepage ticker filters scheduled start', () => /\.lte\(['"]starts_at['"],\s*now\)/.test(files.get('homepage'))],
  ['homepage ticker filters scheduled end', () => /\.or\(['"]ends_at\.is\.null,ends_at\.gt\.'\s*\+\s*now\)/.test(files.get('homepage'))],
  ['admin ticker filters scheduled start', () => /\.lte\(['"]starts_at['"],\s*now\)/.test(files.get('admin'))],
  ['admin ticker filters scheduled end', () => /\.or\(['"]ends_at\.is\.null,ends_at\.gt\.'\s*\+\s*now\)/.test(files.get('admin'))],
  ['no hard-coded fake doctor fallback', () => !/dummyDoctors|د\. محمد عبد الله|د\. سارة خالد|د\. أحمد حسن/.test(files.get('admin'))],
  ['no hard-coded teacher demo profiles', () => !/أ\. أحمد محمد|أ\. سارة علي|مراجعة ليلة الامتحان - فيزياء/.test(files.get('homepage'))],
  ['no hard-coded supermarket product prices', () => !/price:\s*\d+/.test(files.get('homepage'))],
  ['founder operations loads bounded order pages', () => /ordersPageSize = 50/.test(files.get('dashboard')) && /\.range\(0, ordersPageSize - 1\)/.test(files.get('dashboard'))],
  ['founder operations can load additional order pages', () => /async function loadMoreOrders\(\)/.test(files.get('dashboard')) && /\.range\(ordersOffset, ordersOffset \+ ordersPageSize - 1\)/.test(files.get('dashboard')) && /loadMoreOrders/.test(files.get('dashboard'))],
  ['founder operations keeps pagination available when filters have no matches', () => /if \(!visible\.length\)[\s\S]{0,220}renderOrdersPagination\(host\)/.test(files.get('dashboard'))],
  ['founder operations paginates by exact database count', () => /count: 'exact'/.test(files.get('dashboard')) && /ordersOffset < Number\(result\.count \|\| 0\)/.test(files.get('dashboard'))],
  ['customer-created orders use the canonical pending status', () => /status: 'pending'/.test(files.get('homepage')) && !/status: 'قيد المراجعة'/.test(files.get('homepage'))],
  ['customer tracking translates canonical order states for display', () => /ready_for_pickup:'جاهز للاستلام'/.test(files.get('homepage')) && /out_for_delivery:'خرج للتوصيل'/.test(files.get('homepage'))],
  ['customer order history is paginated with a bounded range', () => /ordersPageSize: 10/.test(files.get('homepage')) && /\.range\(from, to\)/.test(files.get('homepage'))],
  ['customer order history remains scoped to the signed-in user', () => /\.eq\('user_id', Auth\.user\.id\)[\s\S]{0,120}\.order\('created_at'/.test(files.get('homepage'))],
  ['order history renders untrusted data as text', () => /details\.textContent\s*=\s*order\.details/.test(files.get('homepage'))],
  ['unread notification badge is present', () => /id="notification-count"/.test(files.get('homepage')) && /function updateNotificationBadge/.test(files.get('homepage'))],
  ['logout clears the previous account notification badge', () => /this\.user = null;\s*updateNotificationBadge\(0\)/.test(files.get('homepage'))],
  ['unread notification count is exact and user-scoped', () => /select\('id', \{ count: 'exact', head: true \}\)[\s\S]{0,180}eq\('user_id', Auth\.user\.id\)[\s\S]{0,80}is\('read_at', null\)/.test(files.get('homepage'))],
  ['mark-as-read blocks duplicate clicks', () => /if \(markReadBusy \|\| item\.read_at\) return;[\s\S]{0,100}markReadBusy = true;[\s\S]{0,100}pointerEvents = 'none'/.test(files.get('homepage'))],
  ['auth refresh is deferred outside auth callback', () => /onAuthStateChange[\s\S]{0,250}setTimeout/.test(files.get('homepage'))],
  ['medical request retains the selected clinic ID', () => /معرّف العيادة:\s*'\s*\+\s*docId/.test(files.get('admin'))],
  ['delivery request persists pickup GPS coordinates', () => /pickupCoords\.lat[\s\S]{0,80}pickupCoords\.lng/.test(files.get('admin'))],
  ['delivery request persists drop-off GPS coordinates', () => /dropoffCoords\.lat[\s\S]{0,80}dropoffCoords\.lng/.test(files.get('admin'))],
  ['failed database writes are distinguished from saved requests', () => /savedInWasla\s*\?/.test(files.get('admin'))],
  ['notification row access is user-scoped', () => /USING\s*\(auth\.uid\(\)\s*=\s*user_id\)/.test(files.get('migration'))],
  ['notification update grant is restricted to read_at', () => /GRANT UPDATE \(read_at\) ON TABLE public\.wasla_notifications TO authenticated/.test(files.get('migration'))],
  ['ticker public read is constrained to active schedule', () => /starts_at <= now\(\)[\s\S]{0,120}ends_at IS NULL OR ends_at > now\(\)/.test(files.get('migration'))],
  ['founder announcement page uses the database authorization RPC', () => /rpc\('wasla_can_manage_ticker'\)/.test(files.get('founder')) && !/roles\.some\s*\(\s*role\s*=>/.test(files.get('founder'))],
  ['ticker authorization RPC is executable only by authenticated users', () => /REVOKE ALL ON FUNCTION public\.wasla_can_manage_ticker\(\) FROM PUBLIC/.test(files.get('tickerPermissionsMigration')) && /GRANT EXECUTE ON FUNCTION public\.wasla_can_manage_ticker\(\) TO authenticated/.test(files.get('tickerPermissionsMigration')) && /has_function_privilege\('anon',[\s\S]*?EXECUTE/.test(files.get('tickerPermissionsMigration'))],
  ['founder announcement writes require an authenticated user ID', () => /auth\.getUser\(\)[\s\S]{0,300}if\s*\(!user\?\.id\)/.test(files.get('founder'))],
  ['founder form prevents duplicate submissions', () => /button\.disabled = true;[\s\S]{0,3000}finally\s*\{[\s\S]{0,200}button\.disabled = false/.test(files.get('founder'))],
  ['founder announcement links are URL-validated', () => /new URL\(target\)[\s\S]{0,300}https:/.test(files.get('founder'))],
  ['operations dashboard requires an authenticated staff RPC gate', () => /rpc\('wasla_can_manage_operations'\)/.test(files.get('dashboard')) && /SECURITY DEFINER[\s\S]*?CREATE POLICY wasla_orders_staff_read/.test(files.get('operationsMigration'))],
  ['orders staff read is scoped to the staff role function', () => /CREATE POLICY wasla_orders_staff_read[\s\S]*?USING \(public\.wasla_can_manage_operations\(\)\)/.test(files.get('operationsMigration'))],
  ['orders staff update policy is role-scoped', () => /CREATE POLICY wasla_orders_staff_status_update[\s\S]*?WITH CHECK \(public\.wasla_can_manage_operations\(\)\)/.test(files.get('operationsMigration'))],
  ['dashboard changes only order status', () => /\.update\(\{ status: nextStatus \}\)/.test(files.get('dashboard'))],
  ['founder dashboard offers only valid next order states', () => /const STATUS_TRANSITIONS =/.test(files.get('dashboard')) && /STATUS_TRANSITIONS\[current\]/.test(files.get('dashboard')) && /allowedNext.length === 0/.test(files.get('dashboard'))],
  ['database enforces order state transitions with a trigger', () => /CREATE TRIGGER wasla_orders_enforce_status_transition[\s\S]*?BEFORE UPDATE OF status ON public\.orders/.test(files.get('orderLifecycleMigration')) && /wasla_order_status_transition_allowed/.test(files.get('orderLifecycleMigration'))],
  ['order lifecycle migration tests both allowed and forbidden transitions', () => /valid transition rejected/.test(files.get('orderLifecycleMigration')) && /invalid transition accepted/.test(files.get('orderLifecycleMigration')) && /pending','delivered/.test(files.get('orderLifecycleMigration'))],
  ['order lifecycle migration blocks unknown legacy states before installing enforcement', () => /unknown existing order statuses require an explicit mapping/.test(files.get('orderLifecycleMigration')) && /status::text NOT IN/.test(files.get('orderLifecycleMigration'))],
  ['courier application is owner-scoped and founder-reviewed', () => /ENABLE ROW LEVEL SECURITY/.test(files.get('courierMigration')) && /applicant_id = auth.uid\(\)/.test(files.get('courierMigration')) && /wasla_courier_applications_founder_update/.test(files.get('courierMigration'))],
  ['courier approval creates an active courier profile', () => /CREATE TRIGGER wasla_courier_application_sync/.test(files.get('courierMigration')) && /INSERT INTO public\.wasla_courier_profiles/.test(files.get('courierMigration'))],
  ['ready-for-pickup cannot skip directly to courier transit', () => files.get('orderLifecycleMigration').includes("WHEN 'ready_for_pickup' THEN p_next = ANY (ARRAY['assigned','delivered','completed','cancelled']::text[])")],
  ['orders table-wide update is revoked and only status updates are granted', () => /REVOKE UPDATE ON TABLE public\.orders FROM PUBLIC, anon, authenticated/.test(files.get('courierMigration')) && /GRANT UPDATE \\(status\\) ON TABLE public\.orders TO authenticated/.test(files.get('courierMigration'))],
  ['courier assignment cannot be forged by direct order insert or update', () => /wasla_orders_protect_courier_assignment/.test(files.get('courierMigration')) && /Courier assignment must be performed by the authorized dispatch RPC/.test(files.get('courierMigration')) && /set_config\('wasla\.courier_assignment','authorized',true\)/.test(files.get('courierMigration'))],
  ['database blocks dispatched orders without an assigned courier', () => /wasla_orders_require_courier_for_dispatch/.test(files.get('courierMigration')) && /A courier must be assigned before dispatch/.test(files.get('courierMigration')) && /existing dispatched orders need explicit courier reconciliation/.test(files.get('courierMigration'))],
  ['courier cannot be deactivated while assigned jobs remain open', () => /wasla_courier_prevent_deactivation_with_jobs/.test(files.get('courierMigration')) && /Courier has active assigned orders/.test(files.get('courierMigration'))],
  ['courier sees only assigned orders', () => /courier_id = auth\.uid\(\) AND public\.wasla_is_active_courier\(\)/.test(files.get('courierMigration'))],
  ['courier status changes are restricted to dispatch and delivery states', () => /status IN \('out_for_delivery','delivered'\)/.test(files.get('courierMigration'))],
  ['courier assignment RPC supports only initial assignment or pre-dispatch reassignment', () => /status = CASE WHEN status = 'ready_for_pickup' THEN 'assigned' ELSE status END/.test(files.get('courierMigration')) && /status = 'assigned' AND courier_id IS NOT NULL/.test(files.get('courierMigration'))],
  ['courier assignment RPC requires operations authorization and ready-for-pickup state', () => /wasla_can_manage_operations\(\)/.test(files.get('courierMigration')) && /status = 'ready_for_pickup'[\s\S]{0,80}courier_id IS NULL/.test(files.get('courierMigration'))],
  ['founder dashboard assigns couriers through the protected RPC', () => /rpc\('wasla_assign_courier'/.test(files.get('dashboard')) && /founder-couriers\.html/.test(files.get('dashboard'))],
  ['courier portal uses active-courier RPC and owner-scoped order updates', () => /rpc\('wasla_is_active_courier'/.test(files.get('courierDashboard')) && /\.eq\('courier_id',user\.id\)/.test(files.get('courierDashboard'))],
  ['customer profile links to courier application and portal', () => /courier-apply\.html/.test(files.get('homepage')) && /courier-dashboard\.html/.test(files.get('homepage'))],
  ['founder courier review uses operations authorization RPC', () => /rpc\('wasla_can_manage_operations'\)/.test(files.get('founderCouriers'))],
  ['order delivery cannot skip dispatch and handoff states', () => files.get('dashboard').includes("accepted: ['preparing','ready_for_pickup','completed','cancelled']") && files.get('dashboard').includes("assigned: ['out_for_delivery','cancelled']") && files.get('orderLifecycleMigration').includes("WHEN 'assigned' THEN p_next = ANY (ARRAY['out_for_delivery','cancelled']::text[])")],
  ['operations migration refuses to run if orders RLS is disabled', () => /IF coalesce\(v_rls_enabled, false\) IS NOT TRUE THEN/.test(files.get('operationsMigration'))],
  ['homepage declares the installable PWA manifest', () => /rel="manifest" href="\/manifest\.webmanifest"/.test(files.get('homepage'))],
  ['homepage registers the service worker after page load', () => /serviceWorker\.register\("\/sw\.js"\)/.test(files.get('homepage'))],
  ['PWA manifest uses standalone display and RTL Arabic metadata', () => /"display": "standalone"/.test(files.get('manifest')) && /"dir": "rtl"/.test(files.get('manifest'))],
  ['service worker does not intercept cross-origin API requests', () => /url\.origin !== self\.location\.origin/.test(files.get('serviceWorker'))],
  ['offline navigation shows an explicit disconnected state', () => /caches\.match\("\/offline\.html"\)/.test(files.get('serviceWorker')) && /الاتصال بالإنترنت غير متاح/.test(files.get('offline'))],
  ['PWA icon is present and scalable', () => /<svg[^>]+viewBox="0 0 512 512"/.test(files.get('appIcon'))],
  ['customer profile links to provider application', () => /provider-apply\.html/.test(files.get('homepage'))],
  ['provider application requires an authenticated user before insert', () => /auth\.getUser\(\)[\s\S]{0,180}!data\.user/.test(files.get('providerApply')) && /applicant_id:data\.user\.id/.test(files.get('providerApply'))],
  ['provider application does not accept client-side approval fields', () => !/payload\.(status|admin_note|reviewed_by|reviewed_at)/.test(files.get('providerApply'))],
  ['provider application schema enables RLS and owner scoping', () => /ENABLE ROW LEVEL SECURITY/.test(files.get('providerApplicationsMigration')) && /applicant_id = auth\.uid\(\)/.test(files.get('providerApplicationsMigration'))],
  ['provider applicant cannot write founder review metadata', () => /WITH CHECK \(applicant_id = auth\.uid\(\) AND status = 'pending' AND admin_note IS NULL AND reviewed_by IS NULL AND reviewed_at IS NULL\)/.test(files.get('providerApplicationsMigration'))],
  ['provider review metadata is protected by founder-only RLS', () => /wasla_provider_applications_founder_update[\s\S]*?public\.is_founder\(\)/.test(files.get('providerApplicationsMigration'))],
  ['provider review columns are not part of applicant insert grant', () => /GRANT INSERT \(applicant_id, sector, business_name, contact_name, contact_phone, city, address, description\)/.test(files.get('providerApplicationsMigration'))],
  ['provider application insert and review transitions create private notifications', () => /CREATE TRIGGER wasla_provider_application_notify[\s\\S]*?AFTER INSERT OR UPDATE OF status ON public\.wasla_provider_applications/.test(files.get('providerApplicationsMigration')) && /INSERT INTO public\.wasla_notifications/.test(files.get('providerApplicationsMigration'))],
  ['founder provider review page checks founder authorization', () => /rpc\('is_founder'\)/.test(files.get('founderProviders'))],
  ['founder provider review only transitions pending applications', () => /status,admin_note:note\.value\.trim\(\)\|\|null,reviewed_by:[\s\S]{0,220}eq\('status','pending'\)/.test(files.get('founderProviders'))],
  ['founder dashboard links to provider review', () => /founder-providers\.html/.test(files.get('dashboard'))],
  ['appointment notifications are emitted by a database trigger', () => /CREATE TRIGGER wasla_appointments_notify_patient[\s\S]*?AFTER INSERT OR UPDATE OF status ON public\.appointments/.test(files.get('migration'))],
  ['order notifications are emitted by a database trigger', () => /CREATE TRIGGER wasla_orders_notify_owner[\s\S]*?AFTER INSERT OR UPDATE OF status ON public\.orders/.test(files.get('migration'))],
];

let failures = 0;
for (const [label, test] of checks) {
  let passed = false;
  try { passed = Boolean(test()); } catch (_) {}
  if (passed) console.log('PASS ' + label);
  else {
    failures++;
    console.error('FAIL ' + label);
  }
}

console.log('\nChecked ' + checks.length + ' platform integrity guard(s); ' + failures + ' failure(s).');
if (failures) process.exitCode = 1;
