# Unapplied draft SQL (not discovered by any automatic migration run)

Files here are NOT in `supabase/migrations/` on purpose, so a CLI push or CI step that applies that folder cannot pick them up.

Status of each draft (all tested only on the isolated `wasla-test` project):

| File | Purpose | Gate before production |
| --- | --- | --- |
| `20261125000000_quote_acceptance.sql` | quote needs customer acceptance, versioned | Owner approves behaviour change; apply to a copy of production first; run `quote_*` RPC tests; then move the file into `supabase/migrations/` in the same change that deploys the UI |
| `20261125000100_delivery_requests.sql` | free delivery requests | Owner decisions in docs/10 (who pays the courier, minimum order, area, cancellation); courier and staff screens; consent and access tests |
| `20261125000200_education_sessions.sql` | tutor sessions and enrollments | Owner approves pricing and cancellation terms; teacher onboarding; run `education_rpc_test.py`; clinic booking and store ordering also need EXECUTE granted on `book_clinic_slot`, `doctor_set_appointment_status`, `place_product_order` (revoked in production today), a separate owner decision |
| `20261125000300_products_category.sql` | `products.category` ('market' or 'food') so the UI shows a market panel and a restaurant panel | Owner decides whether restaurants are onboarded; UI falls back to market if the column is missing; same `place_product_order` EXECUTE decision as above |

Activation steps (deliberate, one at a time):
1. Run the draft on a disposable test project and the matching RPC test script.
2. Review the diff against the production schema (`schema_migrations` has 51 rows at 2026-11-24).
3. Move the file to `supabase/migrations/` with a timestamp later than the latest production migration.
4. Apply to production only on the owner's explicit go-ahead, then deploy the UI.

The UI already fails closed without the quote migration (see `tests/quote-order-fail-closed.test.mjs`) and hides the delivery section without its table.
