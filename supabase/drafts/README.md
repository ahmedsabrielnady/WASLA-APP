# Unapplied draft SQL (not discovered by any automatic migration run)

Files here are NOT in `supabase/migrations/` on purpose, so a CLI push or CI step that applies that folder cannot pick them up.

Status of each draft (all tested only on the isolated `wasla-test` project):

| File | Purpose | Gate before production |
| --- | --- | --- |
| `20261125000000_quote_acceptance.sql` | quote needs customer acceptance, versioned | Owner approves behaviour change; apply to a copy of production first; run `quote_*` RPC tests; then move the file into `supabase/migrations/` in the same change that deploys the UI |
| `20261125000100_delivery_requests.sql` | free delivery requests | Owner decisions in docs/10 (who pays the courier, minimum order, area, cancellation); courier and staff screens; consent and access tests |
| `20261125000200_education_sessions.sql` | tutor sessions and enrollments | Owner approves pricing and cancellation terms; teacher onboarding; run `education_rpc_test.py`; clinic booking and store ordering also need EXECUTE granted on `book_clinic_slot`, `doctor_set_appointment_status`, `place_product_order` (revoked in production today), a separate owner decision |
| `20261125000300_products_category.sql` | `products.category` ('market' or 'food') so the UI shows a market panel and a restaurant panel | Owner decides whether restaurants are onboarded; UI falls back to market if the column is missing; same `place_product_order` EXECUTE decision as above |
| `20261125000400_product_order_merchant_checks.sql` | hardens `place_product_order`: merchant must be kind merchant, approved, active, not test; valid category; no ordering your own product; `orders.product_category` snapshot so food/market history stays stable | Requires the 0300 draft; run `product_order_merchant_kind_test.py` and `product_order_state_gate_test.py`; open engineering issue: the UI limits ordering to customer-role profiles but the order RPCs do not, recorded, behaviour unchanged |
| `20261125000500_health_lab_prescriptions.sql` | priced lab and radiology catalogue (`lab_tests`) and prescription requests answered by pharmacies (`prescription_requests`, `prescription_quotes`); requester id is hidden by a column grant | Pharmacy, lab and radiology are merchant providers with specialty pharmacy, lab or radiology, set by an owner; run `health_rpc_test.py` (57 checks on the test project); no UI yet; draft only, never applied to production |
| `20261125000600_prescription_upload_delivery.sql` | private `prescriptions` storage bucket (no public URL, 5 MB, jpeg/png/webp/pdf), `attach_prescription_file`, pharmacy delivery answer (`delivery_available`, `eta_minutes`); pharmacies lose access on close, expiry or revocation | Requires 0500; run `health_rx_privacy_test.py` (35 checks); gaps listed in the file header (every approved pharmacy sees every open request, no retention job, no malware scan); draft only |
| `20261125000700_prescription_audience_consent.sql` | release-gate work: patient picks up to 5 pharmacies with explicit consent (`rx_set_audience`, `list_pharmacies`); no pharmacy sees a request or file otherwise; withdrawal removes database and storage-policy access; owner can delete files at any time | Requires 0500, 0600; run `health_rx_audience_test.py`; measured gaps in the file header: CDN keeps serving an identical repeated request after revocation or delete (cache_probe*.py), issued signed URLs live until expiry, no staff access audit, no malware scan, no scheduled retention; needs a no-store proxy before any real data |

Activation steps (deliberate, one at a time):
1. Run the draft on a disposable test project and the matching RPC test script.
2. Review the diff against the production schema (`schema_migrations` has 51 rows at 2026-11-24).
3. Move the file to `supabase/migrations/` with a timestamp later than the latest production migration.
4. Apply to production only on the owner's explicit go-ahead, then deploy the UI.

The UI already fails closed without the quote migration (see `tests/quote-order-fail-closed.test.mjs`) and hides the delivery section without its table.
