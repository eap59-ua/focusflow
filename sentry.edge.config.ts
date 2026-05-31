// Sentry — instrumentación Edge runtime (Next.js Middleware). Cargado desde
// src/instrumentation.ts (register) cuando NEXT_RUNTIME === "edge".
//
// DSN vacío en dev → `enabled: false` → no envía nada.
import * as Sentry from "@sentry/nextjs";

import {
  SENTRY_IGNORE_ERRORS,
  sentryBeforeSend,
} from "@/infrastructure/observability/sentry-filter";

const dsn = process.env.SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.SENTRY_ENVIRONMENT ?? "development",
  tracesSampleRate: 0.1,
  beforeSend: sentryBeforeSend,
  ignoreErrors: [...SENTRY_IGNORE_ERRORS],
});
