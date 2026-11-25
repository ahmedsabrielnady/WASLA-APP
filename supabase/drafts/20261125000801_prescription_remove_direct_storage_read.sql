-- DRAFT 0801, NOT applied to wasla-test (it would break the direct-read tests; it needs the rx-file function deployed). Requires 0800.
-- Removes every user path to read storage objects directly, so no user can issue a signed URL either. Reads go only through the rx-file function (audited, no-store).
-- Upload and owner delete stay direct. This does NOT revoke a signed URL issued before this is applied, and it does not stop a cache that already holds a response.
drop policy if exists rx_files_read on storage.objects;
