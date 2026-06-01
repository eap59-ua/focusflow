import type {
  LoggerPort,
  LogPayload,
} from "@/application/ports/LoggerPort";

export interface CapturedLog {
  readonly level: "info" | "warn" | "error";
  readonly payload: LogPayload;
}

// LoggerSpy: implementación de LoggerPort que captura todos los payloads
// para inspección. NO emite a stdout. Usado en tests para verificar la
// política de logging documentada en docs/audits/logging-policy.md.
export class LoggerSpy implements LoggerPort {
  readonly logs: CapturedLog[] = [];

  info(payload: LogPayload): void {
    this.logs.push({ level: "info", payload });
  }
  warn(payload: LogPayload): void {
    this.logs.push({ level: "warn", payload });
  }
  error(payload: LogPayload): void {
    this.logs.push({ level: "error", payload });
  }

  byEvent(event: string): CapturedLog[] {
    return this.logs.filter((l) => l.payload.event === event);
  }

  // Devuelve cualquier payload (sin importar el evento) cuyo JSON contenga
  // alguno de los términos prohibidos. Usado para detectar fugas accidentales.
  scanForLeaks(forbidden: readonly string[]): string[] {
    const offenders: string[] = [];
    for (const log of this.logs) {
      const json = JSON.stringify(log.payload);
      for (const f of forbidden) {
        // Coincidencia case-insensitive sobre clave o valor.
        if (json.toLowerCase().includes(f.toLowerCase())) {
          offenders.push(`event=${log.payload.event}: contains "${f}"`);
        }
      }
    }
    return offenders;
  }
}
