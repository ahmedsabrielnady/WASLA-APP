# WASLA production release test checklist

This checklist is a release gate, not evidence that production has already been tested. All database migrations listed below are still pending confirmation on the production Supabase project.

## Before applying migrations

- [ ] Take a database backup and confirm that it can be restored.
- [ ] Confirm the project ref and environment are the GitHub-linked WASLA Supabase project.
- [ ] Review the current `orders` schema, RLS policies, grants, and existing status values.
- [ ] Confirm there are no legacy status values that would make migration #5 abort.
- [ ] Confirm existing dispatched orders have valid courier assignments before migration #6.
- [ ] Apply migrations in README order. Do not skip a failed preflight or remove its guard to force the migration through.
- [ ] After each migration, run its verification block and inspect the resulting policies, functions, triggers, and grants.

## Test accounts

Use dedicated, non-production accounts for each role:

- Customer A and Customer B
- Merchant A and Merchant B
- Courier A and Courier B
- Founder/operations account

Do not use real customer personal data or live payment details.

## Provider catalog

- [ ] Submit a provider application as Merchant A.
- [ ] Verify Merchant A can read only its own application.
- [ ] Approve it as the founder; confirm a profile is created inactive and unpublished.
- [ ] Confirm the merchant cannot activate or publish its own profile through direct table updates or RPC calls.
- [ ] Activate and publish as the founder.
- [ ] Confirm anonymous users see only safe public profile columns and only published profiles.
- [ ] Confirm contact name and owner auth ID are not publicly readable.
- [ ] Add, edit, hide, and delete a product as Merchant A.
- [ ] Confirm Merchant B cannot read or modify Merchant A's products.
- [ ] Confirm non-restaurant/non-market provider profiles cannot manage the product catalog.

## Merchant checkout and stock

- [ ] Create a product with stock quantity 3 and a known price.
- [ ] Place an authenticated customer order for quantity 2.
- [ ] Confirm the server-calculated price snapshot, order items, delivery address, customer phone, and COD method.
- [ ] Confirm stock becomes 1 and a private new-order notification reaches Merchant A.
- [ ] Confirm Merchant A can see the order and Merchant B cannot.
- [ ] Cancel the pending order as the customer; confirm stock returns to 3.
- [ ] Place another order; accept it, move it to preparing, then ready for pickup.
- [ ] Confirm invalid status skips and customer status tampering are rejected.
- [ ] Confirm the merchant cannot change the order's provider assignment or other order columns.
- [ ] Confirm a merchant cancellation before dispatch restores stock exactly once.
- [ ] Confirm orders cannot be placed against unpublished, inactive, hidden, wrong-provider, or out-of-stock products.
- [ ] Confirm multi-merchant carts are not silently combined; the UI must keep one provider per checkout.

## Courier dispatch and tracking

- [ ] Submit and approve a courier application.
- [ ] Confirm only active couriers appear in dispatch choices.
- [ ] Assign a ready-for-pickup order to Courier A.
- [ ] Confirm Courier A receives a private notification and sees only its own tasks.
- [ ] Confirm Courier B cannot read or update Courier A's assigned order.
- [ ] Reassign before transit and confirm the old and new couriers receive the expected notifications.
- [ ] Confirm reassignment is rejected after the order is out for delivery.
- [ ] Start delivery and grant browser location permission.
- [ ] Confirm location updates are sent only while the courier portal remains open and an order is in transit.
- [ ] Confirm only the customer owning that active order can read the courier location.
- [ ] Confirm the location becomes unavailable to the customer after delivery and is deleted when the courier has no active in-transit orders.
- [ ] Deny location permission and confirm status updates still work while the UI reports that location sharing is unavailable.
- [ ] Confirm the courier can only move assigned → out_for_delivery → delivered.

## Service catalog and appointment booking

- [ ] Submit and approve a medical/service provider application; verify the resulting profile remains inactive and unpublished until founder activation.
- [ ] Activate and publish a medical provider as founder.
- [ ] Confirm the provider can create and edit service offerings but cannot create services for a restaurant/market profile through direct API calls.
- [ ] Configure weekly availability in Africa/Cairo time and verify the public catalog shows only active schedule windows.
- [ ] Attempt to add overlapping weekly windows for the same provider/day; confirm the database rejects the overlap while allowing adjacent windows.
- [ ] Select a date and verify the customer page lists only future, available slots from the public slot RPC; verify a day with no slots clearly shows no availability.
- [ ] Attempt to submit a forged timestamp not returned by the slot RPC; confirm the booking RPC independently rejects times outside the configured schedule.
- [ ] Request a booking as Customer A inside a valid window; confirm the booking is pending and the provider receives a private notification.
- [ ] Confirm Customer A can read the booking and Customer B cannot.
- [ ] Confirm the provider can read only bookings for its own profile and can confirm or cancel using the status RPC.
- [ ] Confirm the customer receives a private notification when the request is submitted and after provider confirmation/cancellation.
- [ ] Verify the `pg_cron` extension is enabled and the `wasla-service-booking-reminders` job is scheduled every five minutes.
- [ ] Test a confirmed appointment in the 1–24-hour window and verify one 24-hour reminder is generated; test an appointment within one hour and verify one 1-hour reminder is generated.
- [ ] Re-run the reminder function and confirm the same reminder is not duplicated.
- [ ] Attempt two overlapping bookings for the same provider at the same time; confirm only one succeeds, including concurrent requests.
- [ ] Attempt a booking outside weekly availability, before now, beyond 90 days, or overlapping an existing pending/confirmed booking; confirm the database rejects it.
- [ ] Cancel a pending booking as the customer; confirm it becomes cancelled.
- [ ] Confirm a customer cannot cancel a confirmed appointment within 12 hours, but can cancel more than 12 hours before it.
- [ ] Confirm the provider cannot move a pending booking directly to completed/no_show or a cancelled booking back to confirmed.
- [ ] Confirm all displayed and submitted appointment times are interpreted in Africa/Cairo time, including when the browser timezone differs.

## Customer, notifications, and operations

- [ ] Confirm customer order history is scoped to the signed-in customer.
- [ ] Confirm customer cancellation is available only for pending merchant orders.
- [ ] Confirm customer, merchant, courier, and operations notifications are private to their intended recipient.
- [ ] Confirm mark-as-read changes only `read_at`.
- [ ] Confirm founder operations pagination loads additional order pages without duplicates.
- [ ] Confirm status transitions are enforced by PostgreSQL, not only by disabled UI options.
- [ ] Confirm all staff pages reject unauthorized accounts.
- [ ] Confirm the founder appointment dashboard rejects ordinary customer accounts and only displays private appointment records to authorized operations staff.
- [ ] Confirm founder appointment pagination uses exact database counts and does not expose appointment records to unauthorized users.

## Release blockers

Do not call the platform production-ready until all of the following are true:

- [ ] All nine required migrations are applied successfully in the correct order.
- [ ] Role-based browser tests above pass against the actual Supabase project.
- [ ] Vercel deployment completes successfully and the deployed commit matches the reviewed PR head.
- [ ] Customer, merchant, courier, and founder flows work end-to-end on mobile and desktop.
- [ ] A rollback plan and production support owner are documented.

## Explicit current limitations

- Payments are cash on delivery only; online payment, refunds, and reconciliation are not implemented.
- The marketplace currently supports one merchant per checkout.
- Location updates stop when the courier portal is closed; this is not background tracking.
- Service catalogs and appointment booking for medical, education, maintenance, and automotive providers are separate unfinished work.
- Merchant revenue analytics, delivery fees, proof-of-delivery, route optimization, and courier earnings are not implemented.
