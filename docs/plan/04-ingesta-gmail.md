# Paso 4 — Ingesta de emails desde Gmail (zero-retention)

Cuarta fase del MVP. Construye el job BullMQ que descarga la inbox del usuario vía Gmail API, deduplica por `Message-Id`, normaliza a `EmailMessage` en memoria, y entrega el resultado al siguiente eslabón del pipeline. **Cero retención**: los contenidos de email NUNCA se persisten — pasan en memoria entre jobs y se descartan tras procesar.

**Dependencia de entrada:** Paso 3 mergeado o accesible vía branch chain. Existe `GmailIntegration` con tokens cifrados; existe puerto `OAuthClientPort` con `refreshAccessToken`; existe `RefreshGmailToken` use case.

**Dependencia de salida:** desbloquea Paso 5 (briefing OpenAI), que recibirá el `EmailMessage[]` en memoria via job chain.

## Aviso sobre escritura predictiva del plan

Este plan se escribió **antes** de ejecutar Paso 4 contra el estado real post-Paso-3. Si Claude Code encuentra que el repo real contradice una asunción del plan (por ej. nombres de puertos, métodos, firmas que cambiaron en alguna desviación aprobada de Paso 3), **parar y reportar** — se parcha el plan antes de seguir. NO improvisar fixes que se desvíen del diseño.

## Pre-requisitos verificables

1. `git status` — working tree limpio, sobre `feat/03-oauth-gmail` (o `main` si ya se mergeó).
2. `pnpm test:unit && pnpm test:integration` verde.
3. `docker compose ps` — `postgres` y `redis` running.
4. **Sin nuevas env vars en este paso**. Todas las credenciales necesarias ya están en `.env` desde Paso 3 (Gmail OAuth + encryption key).
5. `.env` puede tener `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` vacíos — los tests del Paso 4 **no los necesitan** porque usan `FakeEmailFetcher`. Solo el smoke real (no automatizable) los necesita, y ese smoke se aplaza al checklist de pendientes.

**Si cualquiera falla, parar y reportar.**

## Branch

Crear `feat/04-ingesta-gmail` desde `feat/03-oauth-gmail`.

## Deps pre-autorizadas

```bash
pnpm add @googleapis/gmail@^14
```

Justificación:
- `@googleapis/gmail`: paquete oficial Google estrechamente acotado (solo Gmail, ~5MB instalado vs ~20MB del meta-paquete `googleapis`). Trae sus propios tipos. Compatible con el `OAuth2Client` de `google-auth-library` ya instalado en Paso 3.

**NO añadir:**
- `googleapis` (meta-paquete) — innecesario, demasiado ancho.
- `gmail-api-parse-message` ni libs de parsing custom — el SDK de `@googleapis/gmail` ya devuelve mensajes parseados.
- `bullmq` — ya está instalado desde Paso 0 como dependencia base.
- Cualquier librería de retry/backoff custom — googleapis lib ya implementa retry exponencial vía `retryConfig`.

Cualquier otra dep, **parar y preguntar**.

## Variables de entorno (no nuevas, pero relevantes)

Añadir al `.env.example` (si no estaban):

```
# Job de ingesta Gmail (defaults razonables, opcional)
GMAIL_FETCH_MAX_MESSAGES=50         # cantidad máxima por sync
GMAIL_FETCH_QUERY="in:inbox newer_than:1d"  # query Gmail por defecto
```

Lectura desde `process.env` con fallback a defaults en el adapter, no en el use case (mantener dominio puro).

## Modelo de datos

**No se añade ningún modelo Prisma**. Política zero-retention: los emails no tocan DB.

## Domain

`src/domain/email-message/EmailMessage.ts`:

Value Object inmutable con propiedades:

```ts
{
  id: string                  // Gmail message id (no Message-Id header — usamos id de la API)
  messageIdHeader: string     // header Message-Id, para dedup cross-cuenta
  threadId: string
  subject: string
  fromEmail: string
  fromName: string | null
  toEmails: string[]
  snippet: string             // primeros ~200 chars que devuelve Gmail
  receivedAt: Date
  bodyText: string            // texto plano extraído (no HTML)
}
```

Factory `EmailMessage.create({ ... })` valida invariantes:
- `id` y `messageIdHeader` no vacíos.
- `subject` puede ser vacío (algunos emails reales no tienen subject).
- `fromEmail` debe ser email válido (reusar `Email.create()` del Paso 1 si conviene, o validación duplicada — decidir según consistencia, anotar en reporte).
- `receivedAt` no en el futuro (skew tolerable 60s).

**Sin `restore()`** porque nunca se persiste.

Errors:
- `InvalidEmailMessageError` para invariantes rotas.

Tests unitarios cubren factory válido, todos los casos de error.

## Application

`src/application/ports/EmailFetcherPort.ts`:

```ts
export interface EmailFetcherPort {
  fetchInbox(params: {
    accessToken: string
    query: string          // "in:inbox newer_than:1d"
    maxResults: number
  }): Promise<EmailMessage[]>
}
```

`src/application/use-cases/email/FetchInboxEmails.ts`:

Input: `{ userId: string, since?: Date }`.

Flujo:
1. Cargar `GmailIntegration` por `userId` vía `GmailIntegrationRepositoryPort.findByUserId`. Si no existe → `GmailIntegrationNotFoundError`.
2. Si `integration.isAccessTokenExpired(now, skewSeconds = 60)` — ejecutar `RefreshGmailToken` y recargar.
3. Decrypt access token vía `TokenEncryptionPort.decrypt`.
4. Construir query Gmail: si `since` provided → `'in:inbox after:' + Math.floor(since.getTime()/1000)`, si no → leer de env `GMAIL_FETCH_QUERY`.
5. Llamar `EmailFetcherPort.fetchInbox(...)`.
6. Dedup en memoria por `messageIdHeader` (set).
7. Retornar `{ emails: EmailMessage[], integrationId: string }`.

Output: `{ emails: EmailMessage[], integrationId: string }`.

**Importante:** este use case NO persiste nada. NO logea contenidos de email (snippets pueden contener PII). Solo logea cantidades y `messageIdHeader` truncado para debugging.

Tests unitarios mockean los 3 puertos (`GmailIntegrationRepositoryPort`, `TokenEncryptionPort`, `EmailFetcherPort`) y `RefreshGmailToken` use case via constructor injection. Casos:
- Happy path con token válido.
- Token expirado → llama refresh → continúa.
- Sin integración → `GmailIntegrationNotFoundError`.
- Refresh falla → propaga error tipado.
- Dedup: si Gmail devuelve duplicados con mismo `messageIdHeader`, solo aparece una vez en output.

## Infrastructure

`src/infrastructure/adapters/GmailEmailFetcher.ts`:

Implementa `EmailFetcherPort`. Construye `OAuth2Client` con el access token recibido como bearer (no hace refresh — ese es responsabilidad del use case). Usa `@googleapis/gmail`:

```ts
const gmail = google.gmail({ version: 'v1', auth: oauth2Client })
const list = await gmail.users.messages.list({ userId: 'me', q: query, maxResults })
const ids = list.data.messages?.map(m => m.id!) ?? []

// Para cada id, .get con format='full'. Concurrente con límite 5.
const messages = await Promise.all(ids.map(id =>
  gmail.users.messages.get({ userId: 'me', id, format: 'full' })
))

return messages.map(parseGmailMessage)
```

Helper `parseGmailMessage`:
- Extrae headers `Subject`, `From`, `To`, `Message-ID`, `Date`.
- Body: recursivamente busca `parts` con `mimeType: 'text/plain'`. Si no hay text/plain, fallback a strip-HTML del `text/html` (regex simple, no librería externa).
- Construye `EmailMessage.create(...)`.

Configuración de retry:
- googleapis client config: `retry: true`, `retryConfig: { retry: 3, retryDelay: 1000, statusCodesToRetry: [[429, 429], [500, 599]] }`.

Sin tests unitarios directos — se cubren en commit 7 (integration con respuestas Gmail mockeadas).

## Jobs (BullMQ)

`src/jobs/queues.ts` (crear si no existe; si existe extender):

```ts
import { Queue } from 'bullmq'
import { redisConnection } from '../infrastructure/redis/connection'

export const gmailInboxSyncQueue = new Queue('gmail-inbox-sync', { connection: redisConnection })
```

`src/jobs/workers/gmail-inbox-sync.ts`:

```ts
import { Worker, Job } from 'bullmq'

export interface GmailInboxSyncJobData {
  userId: string
  sinceISO: string | null
}
export interface GmailInboxSyncJobResult {
  count: number
  integrationId: string
  // emails NO se devuelven en result — se pasan a siguiente job vía data, NUNCA persistido
}

export function buildGmailInboxSyncWorker(deps: {
  fetchInboxEmails: FetchInboxEmails
  connection: ConnectionOptions
}): Worker<GmailInboxSyncJobData, GmailInboxSyncJobResult> {
  return new Worker<GmailInboxSyncJobData, GmailInboxSyncJobResult>(
    'gmail-inbox-sync',
    async (job) => {
      const { userId, sinceISO } = job.data
      const since = sinceISO ? new Date(sinceISO) : undefined
      const { emails, integrationId } = await deps.fetchInboxEmails.execute({ userId, since })
      // CRÍTICO: emails NO se persisten ni logean. Se pasan al siguiente job
      // vía return value, que BullMQ entrega al `.then()` del flow de Paso 7.
      // En Paso 5 el flow será modificado para que el siguiente job reciba
      // los emails como input. Por ahora, devolver solo count + integrationId.
      return { count: emails.length, integrationId }
    },
    { connection: deps.connection },
  )
}
```

**Importante para Paso 5:** el handover de `EmailMessage[]` al siguiente job se modifica en Paso 5 cuando exista el job de generación de briefing. Por ahora el worker solo devuelve `count` + `integrationId` para que los integration tests verifiquen ejecución.

`src/jobs/index.ts` exporta builders y queues. **No arranca workers** — eso lo hace Paso 7 con un entry point separado (`pnpm worker:start`).

## Commits (8 commits, atómicos)

1. `chore(deps): añadir @googleapis/gmail`
2. `feat(domain): EmailMessage value object con invariantes`
3. `feat(application): EmailFetcherPort + caso de uso FetchInboxEmails con refresh automático`
4. `feat(infra): GmailEmailFetcher adapter usando @googleapis/gmail`
5. `feat(infra): cablear GmailEmailFetcher en container`
6. `feat(jobs): cola gmail-inbox-sync y builder del worker`
7. `test(integration): GmailEmailFetcher contra Gmail API mockeada`
8. `test(integration): worker gmail-inbox-sync end-to-end con BullMQ + Redis reales`

**Gate verde en cada commit.** Sin RED/GREEN splits.

## Testing

**Unit tests** (esperado: ~20 nuevos):
- `EmailMessage.create` factory: 8 casos.
- `FetchInboxEmails` use case: 6 casos (happy, refresh, dedup, not-found, refresh-fail, snippet-truncado).

**Integration tests** (esperado: 5-7 nuevos):
- `GmailEmailFetcher`: con `OAuth2Client` mockeado y `nock`-style respuestas Gmail (o más simple: inyectar un fake `gmail.users.messages` que devuelva fixtures JSON desde `tests/fixtures/gmail/`). Verificar parsing de texto plano, fallback a HTML stripping, headers, deduplicación. **No `nock` — fakes inyectados.**
- Worker `gmail-inbox-sync`: BullMQ + Redis reales (de docker-compose). Inyectar `FakeEmailFetcher` que devuelve `EmailMessage[]` predeterminados. Verificar que `Worker` procesa el job y devuelve `count` correcto.

**Smoke real (deferred):** ejecutar el job contra una cuenta Gmail real conectada vía OAuth requiere completar el setup de Paso 3 con creds Google reales. Documentado en `docs/pending-external-setup.md`. Claude Code anota en el reporte: "Smoke real pendiente — requiere Paso 3 setup completo + cuenta Gmail conectada manualmente."

## Criterios de aceptación

- [ ] 8 commits atómicos sobre `feat/04-ingesta-gmail`, gate verde en cada uno.
- [ ] `pnpm test:unit` ≥ 122/122 (102 de Paso 3 + ~20 nuevos).
- [ ] `pnpm test:integration` con los 5-7 tests nuevos verdes.
- [ ] Cobertura en `domain/email-message/` y `application/use-cases/email/` ≥ 80%.
- [ ] `grep -r "from '@googleapis/gmail'" src/` solo aparece en `src/infrastructure/adapters/GmailEmailFetcher.ts`. Adapter pattern respetado.
- [ ] **Crítico — verificación zero-retention**: `grep -ri "snippet\\|bodyText\\|emailMessage" src/infrastructure/adapters/Prisma*` debe estar vacío. Ningún adapter de Prisma toca contenidos de email.
- [ ] **Crítico — verificación logging seguro**: `grep -r "console.log\\|logger.info\\|logger.debug" src/application/use-cases/email/ src/jobs/` no debe tener variables que sean snippets/bodies. OK logear `count`, `integrationId`, `userId`, `messageIdHeader.slice(0, 16) + '...'`. NO OK logear contenido.
- [ ] Commits en español, Conventional Commits.
- [ ] Reporte final marca el smoke real como "pendiente — requiere setup externo Paso 3".

## Desviaciones aceptables sin preguntar

- Renombrar campos de `EmailMessage` para mejor consistencia (ej. `from` vs `fromEmail`).
- Añadir error de dominio adicional descubierto durante TDD.
- Ajustar firma de `EmailFetcherPort.fetchInbox` si simplifica adapter.
- Reusar `Email` VO de Paso 1 para `fromEmail` si encaja.
- Añadir índice o no en una tabla — N/A en este paso (no hay tabla nueva).
- Bumpear versión menor de `@googleapis/gmail` si la última no es ^14.

## Desviaciones que requieren parar y reportar

- Persistir cualquier campo de `EmailMessage` en DB.
- Logear contenido de email.
- Cambiar el algoritmo de dedup.
- Instalar dep no listada en pre-autorizadas.
- Modificar código de Pasos 1-3 más allá de "añadir relación inversa" si Prisma lo exige.
- Encontrar que la API real de `@googleapis/gmail` v14+ difiere significativamente del esquema asumido aquí (en cuyo caso, parar — el adapter tendrá que reflejar la API real, pero queremos validar el ajuste juntos).

## Al terminar

Reporte paste-ready con:
- Tabla de commits SHA + mensaje.
- Métricas del gate.
- Cobertura de los nuevos directorios.
- Estado del smoke real (pendiente, con referencia a `pending-external-setup.md`).
- Desviaciones justificadas.
- Confirmación explícita de que ningún test/log/adapter persiste contenido de email.

**Branch siguiente:** `feat/05-briefing-openai` se branchará desde `feat/04-ingesta-gmail` cuando arranque Paso 5.
