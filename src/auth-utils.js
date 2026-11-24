export function normalizeEgyptianPhone(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  const local = digits.startsWith("0020")
    ? `0${digits.slice(4)}`
    : digits.startsWith("20")
      ? `0${digits.slice(2)}`
      : digits;
  if (!/^01[0-9]{9}$/.test(local)) return null;
  return `+20${local.slice(1)}`;
}

export function isEgyptianPhone(value) {
  return Boolean(normalizeEgyptianPhone(value));
}

export function isEmailIdentifier(value) {
  const email = String(value ?? "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function resolveAuthIdentifier(value) {
  const raw = String(value ?? "").trim();
  const phone = normalizeEgyptianPhone(raw);
  if (phone) return { type: "phone", value: phone };
  if (isEmailIdentifier(raw)) return { type: "email", value: raw };
  return null;
}

/**
 * Phone/password accounts use a deterministic email alias with Supabase's
 * normal email/password auth. This avoids the SMS phone provider entirely.
 * New alias signups can complete only when Supabase auto-confirms email;
 * otherwise confirmation would be sent to a synthetic address.
 */
export function toWaslaAuthEmail(value) {
  const resolved = resolveAuthIdentifier(value);
  if (!resolved) return null;
  if (resolved.type === "email") return resolved.value;
  const localPhone = `0${resolved.value.slice(3)}`;
  return `${localPhone}@wasla.app`;
}

export function isPhoneAliasSignupReady(settings) {
  return Boolean(settings?.external?.email && settings?.mailer_autoconfirm === true);
}
