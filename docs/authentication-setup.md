# WASLA authentication setup

## Supported sign-in methods

- Egyptian mobile number + password (no SMS OTP), when the Supabase Phone provider is enabled and phone auto-confirm is enabled.
- Email address + password remains supported for existing accounts and new email registrations.
- Google OAuth is optional and appears only when Supabase reports the Google provider as enabled.

## Enable mobile/password without SMS

In the Supabase project used by the application (`yfgvimcqbtthnrbzbhft`):

1. Open **Authentication → Sign In / Providers**.
2. Enable the **Phone** provider.
3. Turn on phone auto-confirm / turn off phone confirmation. This is required to avoid SMS and permit password-based signup to return a session.
4. Leave the Email provider and its confirmation policy unchanged.
5. Confirm the public Auth settings endpoint reports `external.phone = true` and `phone_autoconfirm = true`.

The application deliberately blocks phone sign-in and sign-up unless both settings are true. Email sign-in remains available if the phone provider is not ready.

### Security constraints

- Phone + password without verification does not prove ownership of that number.
- Do not use a phone number alone for password recovery or account linking.
- Do not merge an existing email account with a phone account solely because profile phone values match.
- Phone-only password recovery is not enabled. Email accounts continue to use email password recovery.

## Optional Google OAuth

1. In Google Cloud Console, create an OAuth client of type **Web application**.
2. Add the production origin `https://wasla-app-gg2f.vercel.app` to Authorized JavaScript origins.
3. Add this redirect URI to Authorized redirect URIs:
   `https://yfgvimcqbtthnrbzbhft.supabase.co/auth/v1/callback`
4. In Supabase **Authentication → Sign In / Providers → Google**, enable Google and enter the Web Client ID and Client Secret.
5. Add `https://wasla-app-gg2f.vercel.app/` to the Supabase Auth redirect URL allowlist.
6. Verify `external.google = true` at the public Auth settings endpoint and complete a real Google sign-in test.

Never commit the Google Client Secret or place it in browser code. Store it only in Supabase Auth provider configuration.

## Verification checklist

- Run `npm run verify`.
- Confirm local mobile numbers such as `01012345678` normalize to `+201012345678`.
- Test phone signup and sign-in only after the two phone settings above are enabled.
- Test legacy email sign-in and email recovery.
- Test Google OAuth end-to-end only after configuring the Google client.
- Test role resolution, existing customer order history, and pending-order resume after each sign-in method.
