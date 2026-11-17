# WASLA — Project and Operations Guide

## Current release state

WASLA is still in a controlled preview phase. The active implementation is being delivered as a stacked pull-request sequence:

- PR #2 — smart order tracking, notifications, and announcement management.
- PR #3 — founder announcement authorization hardening; based on the smart-tracking layer.
- PR #4 — installable PWA shell, offline fallback, and paginated customer order history; based on PR #3.
- PR #5 — secure provider onboarding, merchant checkout, courier workflows, and service appointments; based on PR #4.

All four pull requests are draft/open and unmerged at the time of this update. Merge in dependency order only after each layer's database and browser tests pass. No production release has been authorized.

## Important pages

| Path | Purpose |
|---|---|
| `index.html` | Customer-facing WASLA portal |
| `founder-dashboard.html` | New founder/admin operations dashboard for order counts and order-status management |
| `founder-appointments.html` | Founder-only read-only dashboard for service appointment oversight |
| `founder-announcements.html` | Founder/admin announcement ticker manager |
| `admin.html` | Legacy medical/service request page; not the founder operations dashboard. |
| `marketplace.html` | Restaurant and retail product marketplace with cash-on-delivery checkout. |
| `merchant-dashboard.html` | Merchant profile, product, stock, and order management. |
| `service-marketplace.html` | Public medical, education, maintenance, and automotive service catalog with appointment requests. |
| `provider-services.html` | Provider service catalog, weekly schedule, and appointment management. |
| `courier-dashboard.html` | Courier task and delivery status portal. |

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
3. `supabase/migrations/20261118_ticker_role_rpc_permissions.sql`
   - **Not yet confirmed as applied.**
   - Restricts execution of `public.wasla_can_manage_ticker()` to authenticated users.
4. `supabase/migrations/20261119_provider_applications.sql`
   - **Not yet confirmed as applied.**
   - Creates the private provider application workflow, owner-scoped RLS, founder review policies, column-level grants, and applicant notifications.
   - Depends on the notifications table from migration #1 and the existing `public.is_founder()` helper.
5. `supabase/migrations/20261120_order_lifecycle.sql`
   - **Not yet confirmed as applied.**
   - Enforces permitted order status transitions in PostgreSQL, blocks customer status tampering, and aborts if unknown legacy statuses exist.
6. `supabase/migrations/20261121_courier_dispatch.sql`
   - **Not yet confirmed as applied.**
   - Adds courier applications/profiles, assigned-order RLS, protected dispatch/reassignment RPCs, courier notifications, private location sharing, and least-privilege order update grants.
   - Depends on migrations #1, #2, and #5. It stops safely if existing dispatched orders have no courier assigned.
7. `supabase/migrations/20261122_provider_catalog.sql`
   - **Not yet confirmed as applied.**
   - Creates a provider profile only after founder approval, but leaves it inactive and unpublished until a separate founder action.
   - Adds provider-owned product CRUD, stock/price/availability controls, and public read policies for published products.
   - Depends on migration #4 and the operations authorization helper from migration #2.
8. `supabase/migrations/20261123_market_checkout.sql`
   - **Not yet confirmed as applied.**
   - Adds cash-on-delivery checkout, merchant order ownership, order-item snapshots, stock reservation/restoration, and merchant status transitions.
   - Depends on migrations #1, #2, #5, #6, and #7.
9. `supabase/migrations/20261124_services_appointments.sql`
   - **Not yet confirmed as applied.**
   - Adds provider service catalogs, weekly availability, customer appointments, provider confirmation/cancellation, customer cancellation, private notifications, concurrent overlap protection, clinic check-in/queue RPCs, patient turn notifications, and optional pg_cron reminders.
   - Depends on provider profiles and notification infrastructure from migrations #1, #2, and #7.

Apply migrations in order after reviewing the current production schema. Migration #2 intentionally refuses to proceed if orders RLS is disabled; do not bypass that guard without auditing all existing customer policies. The migration intentionally does not enable RLS itself because doing so without reviewing the existing customer insert/read policies could break customer orders.

## Release verification

- Before any production release, complete `docs/RELEASE_TEST_CHECKLIST.md` using dedicated customer, merchant, courier, and founder accounts.
- Static CI checks do not replace authenticated end-to-end testing against Supabase and the deployed Vercel build.

## Current working behavior

- Customer order creation writes to `public.orders` for authenticated customers.
- Each new order receives a tracking code from the database trigger.
- Order creation and status changes generate private rows in `public.wasla_notifications` for orders with an authenticated owner.
- The customer account shows the latest 20 notifications and an unread-count badge. Mark-as-read only updates `read_at`.
- The home and legacy service-page tickers apply both `starts_at` and `ends_at` filters, including for founder/admin sessions.
- Founder announcement CRUD is protected by database policies as well as a client-side role check.
- The founder dashboard checks `wasla_can_manage_operations()` before loading any order data. Status updates are limited in the dashboard UI to the order `status` field, and the database lifecycle trigger rejects invalid state transitions.
- The legacy delivery request form still stores pickup/drop-off coordinates or manual addresses in order details; it is not yet connected to the new courier dispatch flow.
- Restaurant/market customers can browse published products, place one-merchant cash-on-delivery orders, and cancel while an order is pending.
- Merchant checkout validates stock in the database and reserves quantities atomically; cancellations before dispatch restore stock.
- Merchants can manage their own product catalog and move orders through accepted, preparing, and ready-for-pickup states.
- The merchant order inbox loads 50 orders per page, uses the exact database count for load-more availability, and suppresses duplicate cards when new orders arrive during paging.
- The founder has a read-only appointment oversight page with provider/service, status, schedule, customer phone, and paginated records.
- Service providers in medical, education, maintenance, and automotive sectors can create service offerings, set weekly availability, and review customer booking requests. Customers see server-calculated available time slots in Africa/Cairo time; the booking RPC revalidates the schedule and overlapping bookings before creating a pending request. Provider confirmation is required before the appointment is confirmed.
- Medical providers can check patients in, assign daily queue numbers, call the next patient, and trigger in-app “your turn” and “three cases before you” notifications. Queue numbering is per medical provider profile and Cairo calendar day.
- Confirmed service bookings can be cancelled by customers only at least 12 hours before the appointment. Pending requests can be cancelled at any time.
- Migration #9 schedules 24-hour and 1-hour in-app appointment reminders every five minutes when the Supabase `pg_cron` extension is enabled. If the extension is unavailable/disabled, reminders are not scheduled and must be enabled separately.
- The founder can assign active couriers to ready orders; customers can view the last courier location while an order is out for delivery, subject to the courier's browser location permission and active portal session.

## Still not production-complete

- The legacy medical form still creates only a preliminary request. The new service marketplace and booking RPC use dedicated `wasla_service_bookings` records, weekly provider schedules, and provider confirmation. The legacy form has not yet been replaced by the new appointment flow.
- The new service booking flow supports provider-defined weekly time windows, prevents overlapping bookings including concurrent requests, and includes a basic per-provider medical waiting queue. It is not yet linked to multi-doctor clinic rosters, staff roles, patient medical records, deposits, or a full clinic queue/EMR system.
- Education providers can publish bookable services; a full course/LMS catalog, enrollment, lesson delivery, and learning progress are not implemented.
- The retail marketplace supports live provider-owned products, inventory, checkout totals, and merchant acceptance once a provider is approved, activated, published, and maintains its catalog. Actual local merchant onboarding and stock accuracy still require field verification.
- Courier onboarding, founder dispatch, courier task pages, delivery status updates, and optional foreground location sharing are implemented. Background tracking, turn-by-turn route maps, reverse geocoding, proof of delivery, cash reconciliation, and courier earnings are not implemented.
- Notifications are in-app only. Appointment reminders use `pg_cron` when enabled; Web Push, FCM, and service-worker notification delivery while the browser is closed are not implemented.
- The PWA caches the public marketplace, merchant, service booking, provider, and courier page shells; dynamic Supabase data still requires a network connection.
- Authenticated end-to-end tests for order creation, status changes, appointment flow, and founder announcement CRUD have not been completed.

## Automated checks

GitHub Actions workflow: `.github/workflows/wasla-static-checks.yml`

It runs:
- Inline JavaScript syntax compilation for all tracked customer, provider, merchant, founder, and courier pages.
- PostgreSQL grammar parsing for every Supabase migration.
- Direct Node.js syntax checks for the service worker and validation scripts.
- Static integrity guards for RLS, role boundaries, booking concurrency, stock handling, order transitions, and tracking privacy.
- Static integrity guards for scheduled ads, fake/demo data removal, user-scoped notifications, read-at-only updates, auth refresh behavior, delivery coordinates, founder/admin gating, and the orders RLS migration.

The PostgreSQL grammar parser validates migration statement syntax; it does not execute PL/pgSQL function bodies or prove runtime RLS behavior. These checks do **not** replace a signed-in browser test or a real database transaction test.

## Safe release sequence

1. Back up Supabase, inspect existing order statuses and RLS policies, then apply the nine migrations in documented order. Do not apply a migration with a failed preflight.
2. Sign in as a founder/admin and verify `/founder-dashboard.html` loads the order queue.
3. Verify one test order can be read, changed from pending to accepted, and that its owner receives an in-app notification. Use a dedicated test account and test data only.
4. Verify invalid status jumps (for example pending → delivered) are rejected by PostgreSQL, while valid transitions succeed.
5. Verify the customer can mark the notification read and the unread badge decrements correctly.
6. Verify founder announcement create/update/activate/deactivate/delete using a dedicated test announcement.
7. Verify an ordinary customer cannot open staff order data or update order status.
8. Complete medical booking, same-day clinic check-in/queue, 24-hour/1-hour reminders (with `pg_cron` enabled), GPS checkout, merchant fulfillment, and courier map/delivery workflows before marking the platform production-ready.
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


## Merchant checkout and order fulfillment (new foundation)
- `marketplace.html` supports a single-merchant cart and authenticated checkout.
- Checkout is cash-on-delivery only; the server validates product ownership, availability, stock, quantities, and provider publication.
- Stock is reserved atomically at order creation. If the customer cancels while the order is pending, or the merchant cancels before dispatch, stock is restored.
- Pending orders do not expire automatically yet; they continue to reserve stock until the customer or merchant cancels them.
- `merchant-dashboard.html` shows provider-owned orders and allows pending → accepted → preparing → ready_for_pickup, with cancellation where allowed.
- Orders are linked to the provider and visible only to the customer, that provider, and authorized operations staff.
- The existing founder dispatch flow can assign a courier after the merchant marks the order ready.
- `supabase/migrations/20261123_market_checkout.sql` adds the protected checkout/status RPCs, order-item snapshots, provider order RLS, stock restoration, and provider notifications.
- This migration depends on migrations #1, #2, #5, #6, and #7.
- Online payment, delivery fees, invoices, refunds, and multi-merchant carts are not implemented.

## Provider activation and merchant catalog (new foundation)
- Approved provider applications create a private provider profile, initially inactive and unpublished.
- The founder review page separately controls activity and public publication.
- `merchant-dashboard.html` lets the provider manage product name, category, description, price, stock quantity, and availability.
- `marketplace.html` shows only active/published businesses and available products.
- This is a catalog and inventory foundation only; customer checkout, order routing to merchants, payment collection, and sales reporting are not implemented yet.
- `supabase/migrations/20261122_provider_catalog.sql` contains the profile/product schema, RLS policies, approval sync trigger, and least-privilege grants.

## Courier onboarding and dispatch (new foundation)
- `courier-apply.html` lets an authenticated user apply to work as a courier.
- `founder-couriers.html` lets authorized operations staff review applications and activate/deactivate courier profiles.
- Approval creates a courier profile through a database trigger; applicants cannot directly activate themselves.
- `courier-dashboard.html` shows only orders assigned to the active signed-in courier and allows the limited status path: assigned → out for delivery → delivered.
- The founder dashboard assigns only active couriers to orders in `ready_for_pickup` through the protected `wasla_assign_courier` RPC, and permits reassignment only while an order is still in `assigned` (before the courier starts transit).
- `supabase/migrations/20261121_courier_dispatch.sql` adds courier applications/profiles, assigned-order RLS, dispatch RPC, and notifications.
- This migration depends on the operations, notifications, and order-lifecycle migrations. It is **not yet confirmed as applied**.
- Courier location/GPS streaming, route optimization, proof-of-delivery photos, cash collection reconciliation, and driver earnings are not implemented yet.

## Operations dashboard pagination
- The founder operations dashboard now loads orders in pages of 50 using Supabase range queries and exact row counts.
- The user can load additional pages without an unbounded query. Search and filters apply to the records currently loaded in the browser; the interface states this explicitly.
- This is a read-performance improvement, not a change to order access policies.
- The founder dashboard now offers only the next allowed status choices. The database migration `20261120_order_lifecycle.sql` independently enforces the same transition graph for every client.
