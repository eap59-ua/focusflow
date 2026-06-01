import type { LoggerPort, LogPayload } from "@/application/ports/LoggerPort";

// Logger que imprime JSON estructurado a stdout/stderr. Suficiente para dev
// y para hosting que captura logs por línea (Vercel, Railway, etc.).
// Producción más estricta puede sustituir por un adapter pino/Sentry.

function emit(stream: "info" | "warn" | "error", payload: LogPayload): void {
  const line = JSON.stringify({ level: stream, ts: new Date().toISOString(), ...payload });
  if (stream === "error") {
    console.error(line);
  } else if (stream === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export class ConsoleLogger implements LoggerPort {
  info(payload: LogPayload): void {
    emit("info", payload);
  }
  warn(payload: LogPayload): void {
    emit("warn", payload);
  }
  error(payload: LogPayload): void {
    emit("error", payload);
  }
}

// NoOp para tests / contextos donde no queremos ruido.
export class NoOpLogger implements LoggerPort {
  info(): void {}
  warn(): void {}
  error(): void {}
}
