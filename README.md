# WASLA — Project and Operations Guide

## Current release state

WASLA is still in a controlled preview phase. The feature branch is:

`feature/smart-tracking-announcements`

The current pull request is Draft PR #2. It has not been merged into `main` and no production deployment has been authorized.

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
   - It adds order tracking fields, private in-app notifications, notification triggers, and scheduled ticker fields/policies.
2. `supabase/migrations/20261117_operations_dashboard.sql`
   - **Not yet confirmed as applied to production.**
   - Adds `public.wasla_can_manage_operations()`.
   - Adds founder/admin SELECT and status-update policies on `public.orders`.
   - Grants `UPDATE(status)` for authenticated users.
   - Stops without changes if row-level security is not enabled on `public.orders`.

Do not run the second migration until the first migration is present and the orders table has RLS enabled. The migration intentionally does not enable RLS itself because doing so without reviewing the existing customer insert/read policies could break customer orders.

## Current working behavior

- Customer order creation writes to `public.orders` for authenticated customers.
- Each new order receives a tracking code from the database trigger.
- Order creation and status changes generate private rows in `public.wasla_notifications` for orders with an authenticated owner.
- The customer account shows the latest 20 notifications and an unread-count badge. Mark-as-read only updates `read_at`.
- The home and legacy service-page tickers apply both `starts_at` and `ends_at` filters, including for founder/admin sessions.
- Founder announcement CRUD is protected by database policies as well as a client-side role check.
- The founder dashboard checks `wasla_can_manage_operations()` before loading any order data. Status updates are limited in the dashboard UI to the order `status` field.
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
4. Verify the customer can mark the notification read and the unread badge decrements correctly.
5. Verify founder announcement create/update/activate/deactivate/delete using a dedicated test announcement.
6. Verify an ordinary customer cannot open staff order data or update order status.
7. Complete the real medical booking and service-provider workflows before marking the platform production-ready.
8. Only after these checks pass should PR #2 be marked ready, reviewed, merged, and deployed.

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
