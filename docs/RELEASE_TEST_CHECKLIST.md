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

- [ ] As Merchant A, attempt to move an order directly from `accepted` to `ready_for_pickup`; confirm the database rejects the skipped `preparing` state.
- [ ] As Merchant A, complete `pending` → `accepted` → `preparing` → `ready_for_pickup`; confirm each transition succeeds and invalid reverse/skip transitions fail.

- [ ] Create a product with stock quantity 3 and a known price.
- [ ] Place an authenticated customer order for quantity 2.
- [ ] Use GPS checkout and confirm the browser permission flow captures coordinates without requiring a typed address.
- [ ] Confirm the order stores a valid latitude/longitude pair and both the founder and assigned courier can open the delivery point on a map.
- [ ] Deny GPS permission and confirm manual address checkout still works.
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

- [ ] As an active Courier B who is not assigned to an order, attempt a direct status transition on Courier A's order; confirm both RLS and the database actor trigger reject it.

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

## Customer complaints and suggestions

- [ ] Submit a complaint as Customer A and verify a tracking code is returned.
- [ ] Submit a suggestion as Customer A and verify both are visible only to Customer A and authorized operations staff.
- [ ] Confirm Customer B cannot read Customer A's feedback through direct table queries or the feedback page.
- [ ] Confirm a new feedback notification is sent to admin/founder accounts.
- [ ] Update a feedback item as an authorized founder/admin; test open, in-progress, resolved, and rejected states.
- [ ] Confirm the customer receives an in-app notification with the updated status and admin reply.
- [ ] Confirm an ordinary customer cannot call the feedback update RPC or modify status/admin reply directly.
- [ ] Confirm founder feedback pagination loads exact-count pages without exposing feedback to unauthorized users.

## Medical clinic queue

- [ ] Confirm only a medical provider owner can check in a patient or call the next patient.
- [ ] Confirm check-in is limited to confirmed appointments scheduled for the current Africa/Cairo date.
- [ ] Check in multiple patients and verify queue numbers are unique and sequential per provider/day.
- [ ] Confirm the customer receives the queue number notification after check-in.
- [ ] Call the next patient and confirm the correct lowest waiting number is selected and receives “your turn now”.
- [ ] Confirm waiting patients with one to three cases ahead receive one “approaching your turn” notification, without duplicates.
- [ ] Confirm non-medical providers cannot access medical queue RPCs.
- [ ] Confirm completed, cancelled, and no-show appointments leave the active waiting queue.
- [ ] Confirm a future appointment cannot be marked no-show.

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

- [ ] All eleven required migrations are applied successfully in the correct order.
- [ ] Role-based browser tests above pass against the actual Supabase project.
- [ ] Vercel deployment completes successfully and the deployed commit matches the reviewed PR head.
- [ ] Customer, merchant, courier, and founder flows work end-to-end on mobile and desktop.
- [ ] A rollback plan and production support owner are documented.

## Explicit current limitations

- Payments are cash on delivery only; online payment, refunds, and reconciliation are not implemented.
- The marketplace currently supports one merchant per checkout.
- Location updates stop when the courier portal is closed; this is not background tracking.
- Medical bookings are currently tied to a single provider profile, not a multi-doctor clinic roster or staff scheduling model.
- Patient medical records, deposits, full EMR, course/LMS delivery, and automated service-provider payouts are not implemented.
- Merchant revenue analytics, delivery fees, proof-of-delivery, route optimization, and courier earnings are not implemented.
