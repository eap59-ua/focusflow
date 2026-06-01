import type { ErrorEvent, EventHint } from "@sentry/nextjs";

/**
 * Errores de aplicación esperados (no son bugs): no se envían a Sentry.
 * Se usan tanto en `Sentry.init({ ignoreErrors })` como en `beforeSend`.
 */
export const SENTRY_IGNORE_ERRORS = [
  "SessionExpiredError",
  "InvalidCredentialsError",
  "UserNotFoundError",
] as const;

/**
 * Claves cuyo valor NUNCA debe viajar a Sentry: tokens OAuth y contenido de
 * email. Política de privacidad — ver docs/audits/logging-policy.md.
 */
const SENSITIVE_KEYS = new Set([
  "accessToken",
  "refreshToken",
  "bodyText",
  "snippet",
  "subject",
]);

const REDACTED = "[redacted]";

function errorName(hint?: EventHint): string | undefined {
  const original = hint?.originalException;
  return original instanceof Error ? original.name : undefined;
}

/** True si el error original es uno de los esperados (no-bug). */
export function isIgnoredError(hint?: EventHint): boolean {
  const name = errorName(hint);
  return (
    name !== undefined &&
    (SENTRY_IGNORE_ERRORS as readonly string[]).includes(name)
  );
}

/**
 * Redacta recursivamente cualquier clave sensible en un objeto/array. No muta el
 * input. Protegido contra ciclos con un WeakSet.
 */
export function scrubSensitive<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    return value;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => scrubSensitive(item, seen)) as unknown as T;
  }

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEYS.has(key) ? REDACTED : scrubSensitive(val, seen);
  }
  return out as unknown as T;
}

/**
 * Hook `beforeSend` de Sentry: descarta errores esperados (devuelve null) y
 * redacta campos sensibles del resto antes de enviarlos.
 */
export function sentryBeforeSend(
  event: ErrorEvent,
  hint?: EventHint,
): ErrorEvent | null {
  if (isIgnoredError(hint)) {
    return null;
  }
  return scrubSensitive(event);
}
