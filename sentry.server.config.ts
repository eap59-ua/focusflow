// Sentry — instrumentación server-side. Cargado desde src/instrumentation.ts
// (register) cuando NEXT_RUNTIME === "nodejs".
//
// Si SENTRY_DSN está vacío (dev por defecto), `enabled: false` hace que el SDK
// no envíe nada: degrada gracefully sin tocar el código de la app.
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
