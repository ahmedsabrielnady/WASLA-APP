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

export function isPhonePasswordAuthReady(settings) {
  return Boolean(settings?.external?.phone && settings?.phone_autoconfirm === true);
}
