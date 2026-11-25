# API tests for the wasla-test project (synthetic data only)

These scripts run only against the isolated test project (`harness_guard.py` refuses any other URL). They are not production tests and need the test users and drafts 0400 to 2900 applied.

Run: `WASLA_TEST_URL=<test project url> WASLA_TEST_PUBLISHABLE_KEY=<publishable key> WASLA_TEST_PW=<test password> python3 <name>_test.py`

Rules used by these tests: a refusal counts as a pass only when it is a specific 4xx with the expected message or code. A 500 or 53400 (rate limit) is never a pass. Auth and order bursts are throttled (orders: 10-minute window), so run a few tests at a time.

Included here: the tests repaired or added in the 11:00 session (`health_rpc_test`, `cross_role_isolation_test`, `health_rx_privacy_test`, `health_rx_audit_test`, `course_no_consent_test`, `lab_result_files_test`) plus helpers. `course_no_consent_test` needs the bounded consent reset in `consent_fixture_reset.sql`.
Other test files live in the handoff artifact and are not yet in the repo.

## Setup and guard (verified from a fresh clone at a different path)

- No test depends on a checkout path. Run from `supabase/e2e/` anywhere. Credentials come only from the three environment variables above and are never stored in the repo.
- `harness_guard.check_url` is deny-by-default: it allows exactly `https://mekeirlgmergmzsdkaon.supabase.co`. The production project URL and an empty URL are refused (checked). `e2e_rpc.py` calls it at import.
- `harness_guard.check_config(root)` takes an explicit UI copy root as an argument. It is for browser harnesses only and is not used by these API tests.
- `health_rx_privacy_test.py` writes a small scratch file at `/tmp/rx_rid`. Do not run two copies at once.
- Needs the test users and drafts 0400 to 2900 applied on the test project. Run a few tests at a time (auth and order throttling).
