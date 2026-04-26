// Logger estructurado: convención de payload `{ event, ...data }`.
// El campo `event` identifica la línea de telemetría; el resto es metadata
// arbitraria, siempre que respete la política documentada en
// docs/audits/logging-policy.md (nunca tokens, nunca contenidos de email).

export type LogPayload = Readonly<{
  event: string;
  [key: string]: unknown;
}>;

export interface LoggerPort {
  info(payload: LogPayload): void;
  warn(payload: LogPayload): void;
  error(payload: LogPayload): void;
}
