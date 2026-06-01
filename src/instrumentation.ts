// Next.js instrumentation hook. Carga la config de Sentry según el runtime.
// En @sentry/nextjs v8, Sentry.init debe ejecutarse dentro de register()
// (no basta con tener los archivos sentry.*.config.ts).
import * as Sentry from "@sentry/nextjs";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

// Captura de errores de Server Components / Route Handlers (Next.js 15).
export const onRequestError = Sentry.captureRequestError;
