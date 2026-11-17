import { readFileSync } from 'node:fs';

const required = [
  ['index.html', 'homepage'],
  ['admin.html', 'admin'],
  ['founder-announcements.html', 'founder'],
  ['supabase/migrations/20261116_smart_tracking_announcements.sql', 'migration'],
  ['supabase/migrations/20261117_operations_dashboard.sql', 'operationsMigration'],
  ['founder-dashboard.html', 'dashboard'],
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
  ['founder page enforces a server-side-backed role check', () => /role IN \('(admin', 'founder|founder', 'admin)'\)/.test(files.get('migration')) && /roles\.some\s*\(\s*role\s*=>\s*\['founder',\s*'admin'\]\.includes\(role\)\)/.test(files.get('founder'))],
  ['founder announcement writes require an authenticated user ID', () => /auth\.getUser\(\)[\s\S]{0,300}if\s*\(!user\?\.id\)/.test(files.get('founder'))],
  ['founder form prevents duplicate submissions', () => /button\.disabled = true;[\s\S]{0,3000}finally\s*\{[\s\S]{0,200}button\.disabled = false/.test(files.get('founder'))],
  ['founder announcement links are URL-validated', () => /new URL\(target\)[\s\S]{0,300}https:/.test(files.get('founder'))],
  ['operations dashboard requires an authenticated staff RPC gate', () => /rpc\('wasla_can_manage_operations'\)/.test(files.get('dashboard')) && /SECURITY DEFINER[\s\S]*?CREATE POLICY wasla_orders_staff_read/.test(files.get('operationsMigration'))],
  ['orders staff read is scoped to the staff role function', () => /CREATE POLICY wasla_orders_staff_read[\s\S]*?USING \(public\.wasla_can_manage_operations\(\)\)/.test(files.get('operationsMigration'))],
  ['orders staff update policy is role-scoped', () => /CREATE POLICY wasla_orders_staff_status_update[\s\S]*?WITH CHECK \(public\.wasla_can_manage_operations\(\)\)/.test(files.get('operationsMigration'))],
  ['dashboard changes only order status', () => /\.update\(\{ status: nextStatus \}\)/.test(files.get('dashboard'))],
  ['operations migration refuses to run if orders RLS is disabled', () => /IF coalesce\(v_rls_enabled, false\) IS NOT TRUE THEN/.test(files.get('operationsMigration'))],
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
