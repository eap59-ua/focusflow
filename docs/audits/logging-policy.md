# Política de logging

## Qué se loguea

FocusFlow usa eventos estructurados en JSON con shape `{ event, ...metadata }`. La interfaz `LoggerPort` (en `src/application/ports/LoggerPort.ts`) define `info / warn / error`; la implementación por defecto es `ConsoleLogger`, que serializa cada payload a una línea JSON en stdout/stderr.

Eventos definidos hoy:

| Evento | Quien lo emite | Campos permitidos |
|---|---|---|
| `gmail_inbox_fetched` | `FetchInboxEmails` | `userId`, `integrationId`, `count`, `duplicatesDropped` |
| `briefing_generated` | `GenerateBriefing` | `userId`, `briefingId`, `emailsConsidered`, `emailsTruncated`, `tokensUsedInput`, `tokensUsedOutput`, `modelUsed`, `promptVersion`, `placeholder` (bool) |
| `briefing_email_sent` | `SendBriefingEmail` | `userId`, `briefingId`, `recipientDomain`, `messageIdPrefix` (≤16 chars) |
| `briefing_triggered` | `TriggerBriefingForUser` | `userId`, `flowId` |

Convenciones:

- `userId` y `briefingId` SÍ se pueden loguear (son identificadores opacos).
- IDs de mensaje SMTP (`messageId` completo) NO; usar prefijo de 16 chars.
- Email del recipient: dominio, NO la dirección completa (`recipientDomain`).
- Tokens (input/output): cuántos, NO el contenido del prompt o de la respuesta.
- Modelo y prompt version: SÍ — son metadata operacional.

## Qué NUNCA se loguea

Lista *non-negotiable* — un test (`tests/unit/observability/logging-events.test.ts`) verifica que ninguno aparece en ningún payload:

- `bodyText` o cualquier extracto del cuerpo del email.
- `snippet` (preview de Gmail — es contenido).
- `subject` (a veces revela información sensible: "Re: NDA con cliente").
- `body` como término genérico.
- `accessToken`, `refreshToken` (ni encriptados ni en claro).
- `pre-encryption tokens` o cualquier renombrado.
- Contenido textual del email en cualquier forma.

## Cómo se verifica

`tests/unit/observability/logging-events.test.ts` ejecuta el flow completo (fetch → generate → send) con fakes y un `LoggerSpy` que captura todos los logs. Después:

1. Asserta que los 3 eventos esperados se emitieron.
2. Asserta los campos permitidos en cada uno.
3. Llama a `LoggerSpy.scanForLeaks(FORBIDDEN_TERMS)` con la lista negra. Cualquier coincidencia (case-insensitive, sobre el JSON serializado del payload) hace fallar el test.
4. Búsqueda canary adicional: palabras del bodyText fake (`"NDA"`, `"confidencial"`) no deben aparecer en NINGÚN log.

Si añades un nuevo evento o un campo a uno existente, este test es la red de seguridad.

## Cómo añadir un evento

1. En el use case correspondiente, llama `this.deps.logger?.info({ event: "<nombre>", ...metadata })`.
2. El nombre del evento es snake_case + verbo en pasado (`briefing_generated`, NO `generateBriefing`).
3. Solo metadata segura (ver listas arriba).
4. Actualiza la tabla de "Qué se loguea" en este documento.
5. Añade un assert al test E2E si es un evento clave del flow.

## Cómo añadir un campo a un evento

1. Confirma que el campo NO está en la lista negra ni revela contenido.
2. Si es un identificador (id, prefijo, dominio), OK.
3. Si es un texto humano, párate. ¿Lo logeamos por debugging? Considera hash o id en su lugar.
4. Actualiza este documento.
5. Si la incorporación sucede tras commit 4, asegúrate de que el test sigue verde (puede que ahora el LoggerSpy detecte algo nuevo).

## Logger en tests

- Tests que NO necesitan inspección: pueden omitir `logger` (es opcional en cada use case).
- Tests que SÍ inspeccionan: usar `LoggerSpy` (`tests/unit/observability/LoggerSpy.ts`).
- Producción: `ConsoleLogger` se cabló desde `src/infrastructure/container.ts`.

## Producción (post-deploy)

Hosting providers (Vercel, Railway, etc.) capturan stdout/stderr por línea — el output JSON de `ConsoleLogger` es directamente parseable. Si en Paso 8 se quiere Sentry / Datadog / Loki, solo hay que sustituir `ConsoleLogger` por un adapter equivalente que respete `LoggerPort`. El resto del código no cambia.
