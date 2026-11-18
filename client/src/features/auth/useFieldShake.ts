import { useState } from 'react';

const SHAKE_DURATION_MS = 420;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

/** Parses a comma-separated domains string into a normalised lowercase list. */
export function parseDomains(domains: string): string[] {
  return domains
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

/** Returns true when the email's domain is one of the given comma-separated domains. */
export function isEmailDomainAllowed(email: string, domains: string): boolean {
  const allowed = parseDomains(domains);
  if (allowed.length === 0) return true;
  const domain = email.trim().split('@')[1]?.toLowerCase() ?? '';
  return allowed.includes(domain);
}

/**
 * Shared "required field" feedback for auth forms: shakes the offending
 * input and shows a small inline message under it, instead of blocking
 * the submit button outright (a click always gives feedback).
 */
export function useFieldShake<T extends string>() {
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<T, string>>>({});
  const [shakeField,  setShakeField]  = useState<T | null>(null);

  const triggerShake = (field: T, message: string) => {
    setFieldErrors((f) => ({ ...f, [field]: message }));
    setShakeField(field);
    window.setTimeout(() => setShakeField((f) => (f === field ? null : f)), SHAKE_DURATION_MS);
  };

  const clearFieldError = (field: T) => {
    setFieldErrors((f) => ({ ...f, [field]: undefined }));
  };

  return { fieldErrors, shakeField, triggerShake, clearFieldError };
}
