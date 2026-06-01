// Sentry — instrumentación client-side (browser). El build plugin de
// @sentry/nextjs auto-inyecta este archivo (debe estar en la raíz del proyecto).
//
// DSN vacío en dev → `enabled: false` → no envía nada.
import * as Sentry from "@sentry/nextjs";

import {
  SENTRY_IGNORE_ERRORS,
  sentryBeforeSend,
} from "@/infrastructure/observability/sentry-filter";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.SENTRY_ENVIRONMENT ?? "development",
  tracesSampleRate: 0.05,
  beforeSend: sentryBeforeSend,
  ignoreErrors: [...SENTRY_IGNORE_ERRORS],
});
