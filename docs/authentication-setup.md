# WASLA authentication setup

## Supported sign-in methods

- Egyptian mobile number + password. No SMS and no Supabase Phone provider. The app turns the number into a fixed email alias (`010XXXXXXXX@wasla.app`) and uses normal Supabase email + password.
- Email address + password for existing accounts and new email registrations.
- Google OAuth, optional. The button appears only when Supabase reports the Google provider as enabled.

## Mobile + password (no SMS)

- Leave the Supabase **Phone** provider disabled. Do not enable it and do not configure an SMS provider.
- A new alias signup returns a session only when Supabase has **Confirm email** off (`mailer_autoconfirm = true`), because a confirmation email would go to the synthetic alias address. The app checks this through the public Auth settings (`isPhoneAliasSignupReady`).
- If the project needs email confirmation, new phone signups are not offered; users register with a real email instead.

### Security constraints

- Mobile + password without verification does not prove ownership of the number.
- Alias accounts have no working self-service password recovery: the recovery email would go to the synthetic address, which Wasla does not receive. Do not present an admin reset as safe recovery until an identity-proof method is agreed.
- Do not use a phone number alone for password recovery or account linking.
- Do not merge an existing email account with a phone account because profile phone values match. Alias accounts are never linked to Google, because no Google account can own the synthetic address.
- Email recovery for real email accounts needs a custom SMTP provider; Supabase's built-in email service is limited to project team addresses.

## Google OAuth

1. In Google Cloud Console create an OAuth client of type **Web application** (consent screen scopes: name, email, profile only).
2. Add the app origin to Authorized JavaScript origins (production: `https://wasla-app-gg2f.vercel.app`).
3. Add the Supabase callback to Authorized redirect URIs (production: `https://yfgvimcqbtthnrbzbhft.supabase.co/auth/v1/callback`).
4. In Supabase **Authentication → Sign In / Providers → Google**, enable Google and enter the Client ID and Client Secret. Never commit the secret or put it in browser code.
5. In Supabase **Authentication → URL Configuration**, set the **Site URL** to the app host and add the app host (with trailing `/`) to **Redirect URLs**. If the redirect is not allowed, Supabase falls back to the Site URL (seen on TEST as a localhost landing).
6. While the consent screen is in Testing, only listed test users can sign in. Publish it so any Google account can use basic scopes.
7. Verify `external.google = true` at the public Auth settings endpoint and complete a real sign-in.

Behavior verified on the TEST project:

- The login form shows the Google button whenever the provider is enabled, including when new signups are closed. It is never shown in register mode or in the public preview.
- Supabase links a Google sign-in to an existing account only when the account has the same verified email (default). With signups closed, only an existing account with that email can sign in with Google; otherwise Supabase rejects it.
- After a Google login the app copies the Google name into the profile only when the profile name is blank or the default "مستخدم". It never overwrites an edited name and never changes the role.
- Google may ask the account owner for its own security check (phone prompt or on-device code). Wasla cannot remove that.

## Verification checklist

- Run `npm run verify`.
- Confirm local mobile numbers such as `01012345678` normalize to `+201012345678`.
- Test mobile signup and sign-in only where Confirm email is off.
- Test email sign-in and email recovery (custom SMTP required).
- Test Google end to end through the real button, then check role, order history and pending-order resume.
