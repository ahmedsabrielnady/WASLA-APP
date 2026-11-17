# WASLA — Project and Operations Guide

## Current release state

WASLA is still in a controlled preview phase. The active implementation is being delivered as a stacked pull-request sequence:

- PR #3 — founder announcement authorization hardening; base: `feature/smart-tracking-announcements`.
- PR #4 — installable PWA shell, offline fallback, and paginated customer order history; base: PR #3 branch.
- PR #5 — secure provider onboarding and founder review; base: PR #4 branch.

All three are draft/open and unmerged at the time of this update. Merge in dependency order only after each layer's database and browser tests pass. No production release has been authorized.

## Important pages

| Path | Purpose |
|---|---|
| `index.html` | Customer-facing WASLA portal |
| `founder-dashboard.html` | New founder/admin operations dashboard for order counts and order-status management |
| `founder-announcements.html` | Founder/admin announcement ticker manager |
| `admin.html` | Legacy service request page. It is **not** the founder operations dashboard. |

Use `/founder-dashboard.html` for the operations dashboard and `/founder-announcements.html` for ticker management.

## Supabase migrations

Apply migrations in order:

1. `supabase/migrations/20261116_smart_tracking_announcements.sql`
   - The project owner reported applying this migration on 2026-11-16.
   - Adds order tracking fields, private in-app notifications, notification triggers, and scheduled ticker fields/policies.
2. `supabase/migrations/20261117_operations_dashboard.sql`
   - **Not yet confirmed as applied.**
   - Adds `public.wasla_can_manage_operations()` and staff order read/status-update policies.
   - Stops if row-level security is not enabled on `public.orders`.
3. `supabase/migrations/20261117_order_lifecycle.sql`
   - **Not yet confirmed as applied.**
   - Enforces permitted order status transitions in PostgreSQL, not just in the founder dashboard.
   - Prevents invalid jumps, dispatch-stage skips, and reopening completed/cancelled orders; aborts if unknown legacy statuses exist.
4. `supabase/migrations/20261117_courier_dispatch.sql`
   - **Not yet confirmed as applied.**
   - Adds courier applications/profiles, assigned-order RLS, dispatch assignment RPC, and courier notifications.
   - Depends on migrations #1–#3 and safely stops if existing dispatched orders have no courier assigned.
5. `supabase/migrations/20261118_ticker_role_rpc_permissions.sql`
   - **Not yet confirmed as applied.**
   - Restricts execution of `public.wasla_can_manage_ticker()` to authenticated users.
6. `supabase/migrations/20261119_provider_applications.sql`
   - **Not yet confirmed as applied.**
   - Creates the private provider application workflow, owner-scoped RLS, founder review policies, column-level grants, and applicant notifications.
   - Depends on the notifications table from migration #1 and the existing `public.is_founder()` helper.

Apply migrations in order after reviewing the current production schema. Migration #2 intentionally refuses to proceed if orders RLS is disabled; do not bypass that guard without auditing all existing customer policies. The migration intentionally does not enable RLS itself because doing so without reviewing the existing customer insert/read policies could break customer orders.

## Current working behavior

- Customer order creation writes to `public.orders` for authenticated customers.
- Each new order receives a tracking code from the database trigger.
- Order creation and status changes generate private rows in `public.wasla_notifications` for orders with an authenticated owner.
- The customer account shows the latest 20 notifications and an unread-count badge. Mark-as-read only updates `read_at`.
- The home and legacy service-page tickers apply both `starts_at` and `ends_at` filters, including for founder/admin sessions.
- Founder announcement CRUD is protected by database policies as well as a client-side role check.
- The founder dashboard checks `wasla_can_manage_operations()` before loading any order data. Status updates are limited in the dashboard UI to the order `status` field, and the database lifecycle trigger rejects invalid state transitions.
- The old delivery request form saves pickup/drop-off coordinates or manual addresses in order details. It does not provide dispatch, driver assignment, live map display, or live driver tracking.

## Still not production-complete

- Medical booking is still a preliminary request, not a confirmed appointment. The legacy form writes a generic order request and opens WhatsApp; it does not create a row in `appointments` or `health_appointments`.
- No doctor time-slot availability, conflict prevention, deposit collection, or clinic queue integration is wired into the public booking flow.
- Education providers and courses are placeholders pending verified provider onboarding.
- The supermarket list is illustrative. Live stores, inventory, prices, checkout totals, and partner acceptance are not connected.
- Delivery has no live maps/reverse geocoding, driver assignment, dispatch, route tracking, or courier app.
- Notifications are in-app only. Scheduled reminders, Web Push, FCM, and service-worker delivery while the browser is closed are not implemented.
- Authenticated end-to-end tests for order creation, status changes, appointment flow, and founder announcement CRUD have not been completed.

## Automated checks

GitHub Actions workflow: `.github/workflows/wasla-static-checks.yml`

It runs:
- Inline JavaScript syntax compilation for the four application pages.
- Static integrity guards for scheduled ads, fake/demo data removal, user-scoped notifications, read-at-only updates, auth refresh behavior, delivery coordinates, founder/admin gating, and the orders RLS migration.

These checks do **not** replace a signed-in browser test or a real database transaction test.

## Safe release sequence

1. Confirm both migrations are applied successfully in Supabase.
2. Sign in as a founder/admin and verify `/founder-dashboard.html` loads the order queue.
3. Verify one test order can be read, changed from pending to accepted, and that its owner receives an in-app notification. Use a dedicated test account and test data only.
4. Verify invalid status jumps (for example pending → delivered) are rejected by PostgreSQL, while valid transitions succeed.
5. Verify the customer can mark the notification read and the unread badge decrements correctly.
6. Verify founder announcement create/update/activate/deactivate/delete using a dedicated test announcement.
7. Verify an ordinary customer cannot open staff order data or update order status.
8. Complete the real medical booking and service-provider workflows before marking the platform production-ready.
9. Only after these checks pass should the stacked PRs be reviewed, merged in dependency order, and deployed.

## Security notes

- Browser pages use the Supabase publishable/anon key only.
- Never put a Supabase service-role key or other server secret in HTML, JavaScript, GitHub, or a browser.
- Frontend checks are for user experience only. Supabase RLS and database privileges are the actual access boundary.


## Provider onboarding (new foundation)
- `provider-apply.html` lets an authenticated user submit a provider application.
- `founder-providers.html` provides founder-only review for pending applications.
- `supabase/migrations/20261119_provider_applications.sql` creates a private application table with owner-scoped RLS, founder review policies, and column-level grants.
- The migration is **not yet confirmed as applied**. Apply it only after `20261116_smart_tracking_announcements.sql` (notifications table) and `20261117_operations_dashboard.sql` have been applied, and after confirming `public.is_founder()` is available in this Supabase project.
- An approved application is not automatically a live provider listing. Provider verification, profile creation, service catalog, and customer booking integration remain separate release gates.


## Courier onboarding and dispatch (new foundation)
- `courier-apply.html` lets an authenticated user apply to work as a courier.
- `founder-couriers.html` lets authorized operations staff review applications and activate/deactivate courier profiles.
- Approval creates a courier profile through a database trigger; applicants cannot directly activate themselves.
- `courier-dashboard.html` shows only orders assigned to the active signed-in courier and allows the limited status path: assigned → out for delivery → delivered.
- The founder dashboard assigns only active couriers to orders in `ready_for_pickup` through the protected `wasla_assign_courier` RPC.
- `supabase/migrations/20261117_courier_dispatch.sql` adds courier applications/profiles, assigned-order RLS, dispatch RPC, and notifications.
- This migration depends on the operations, notifications, and order-lifecycle migrations. It is **not yet confirmed as applied**.
- Courier location/GPS streaming, route optimization, proof-of-delivery photos, cash collection reconciliation, and driver earnings are not implemented yet.

## Operations dashboard pagination
- The founder operations dashboard now loads orders in pages of 50 using Supabase range queries and exact row counts.
- The user can load additional pages without an unbounded query. Search and filters apply to the records currently loaded in the browser; the interface states this explicitly.
- This is a read-performance improvement, not a change to order access policies.
- The founder dashboard now offers only the next allowed status choices. The database migration `20261117_order_lifecycle.sql` independently enforces the same transition graph for every client.
