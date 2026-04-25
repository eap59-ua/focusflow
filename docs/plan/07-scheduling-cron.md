# Paso 7 — Scheduling diario del MVP

Séptima fase del MVP. Conecta los tres jobs de los Pasos 4-6 en un flow secuencial (`sync-gmail-inbox` → `generate-briefing` → `send-briefing-email`) y los programa con cron BullMQ per-usuario, respetando hora preferida y timezone. Al terminar este paso, el MVP funciona sin intervención: te registras → conectas Gmail → al día siguiente recibes el briefing.

**Dependencia de entrada:** Pasos 4, 5, 6 disponibles. Las tres colas BullMQ existen, los workers están definidos pero no arrancados.

**Dependencia de salida:** MVP funcional end-to-end. Paso 8 es solo polish (rate limit, observabilidad, deploy, landing).

## Aviso sobre escritura predictiva

Escrito antes de Pasos 4-6. Si el repo real diverge significativamente (ej. firmas de jobs, payload shape), parar y reportar antes de tocar nada.

## Pre-requisitos verificables

1. `git status` limpio sobre `feat/06-envio-email`.
2. `pnpm test:unit && pnpm test:integration` verde.
3. `docker compose ps` — `postgres`, `redis`, `mailpit` running.
4. **Sin nuevas env vars externas** — sí se añaden defaults (timezone, hora).

## Branch

`feat/07-scheduling-cron` desde `feat/06-envio-email`.

## Deps pre-autorizadas

**Ninguna nueva**. Todo lo que necesitamos está ya instalado:

- `bullmq` ya tiene `Queue`, `Worker`, `FlowProducer`, `Repeat`.
- Timezone handling vía `Intl.DateTimeFormat` nativo de Node (no necesitamos `date-fns-tz` ni `luxon` para parsear "Europe/Madrid" → offset).
- Cron expression handling: BullMQ acepta cron strings nativos, o `pattern` con `every` ms — usaremos cron strings.

Si Claude Code descubre que falta algo crítico, **parar y preguntar**.

## Variables de entorno

Añadir al `.env.example`:

```
# Scheduling defaults
SCHEDULER_DEFAULT_HOUR=8
SCHEDULER_DEFAULT_TIMEZONE=Europe/Madrid
SCHEDULER_ENABLED=true            # toggle global, útil para deploy donde no quieres el scheduler
```

## Modelo de datos

Añadir preferencias de scheduling al `User` (sin tabla nueva — sigue siendo simple):

```prisma
model User {
  // ... campos existentes
  briefingHour     Int     @default(8)              // 0-23
  briefingTimezone String  @default("Europe/Madrid")
  briefingEnabled  Boolean @default(false)          // se enciende cuando user conecta Gmail
}
```

Migración: `pnpm prisma migrate dev --name add_user_briefing_preferences`.

`briefingEnabled` arranca en `false` y se pasa a `true` automáticamente cuando `CompleteGmailConnection` (Paso 3) crea la integración. Modificar ese use case en este paso para activar el flag.

## Domain

Modificar `User` entity para incluir las nuevas propiedades. Métodos:

- `User.enableBriefing(hour: number, timezone: string)`: valida hour 0-23, timezone via `Intl.DateTimeFormat` (lanza si timezone inválido).
- `User.disableBriefing()`.
- `User.updateBriefingPreferences(hour, timezone)`.

Errores nuevos:
- `InvalidBriefingHourError` (fuera de 0-23).
- `InvalidBriefingTimezoneError` (no reconocido por `Intl`).

Tests unitarios cubren validación + actualización inmutable.

## Application

Use cases en `src/application/use-cases/scheduling/`:

`UpdateBriefingPreferences.ts`:
- Input: `{ userId, hour, timezone, enabled }`.
- Carga User → aplica métodos de dominio → guarda. Llama a `BriefingScheduler.scheduleForUser(user)` o `unscheduleForUser(user)` según `enabled`.

`ScheduleAllActiveBriefings.ts`:
- Input: ninguno (administrativo, se ejecuta al arrancar el worker process).
- Carga todos los usuarios con `briefingEnabled = true`. Para cada uno, programa via `BriefingSchedulerPort.scheduleForUser(user)`.

`TriggerBriefingForUser.ts` (orquestador del flow):
- Input: `{ userId }`.
- Llama el flow: encadena los 3 jobs vía BullMQ `FlowProducer`.
- Es el "callback" que ejecuta el cron al disparar.

Nuevo puerto `BriefingSchedulerPort`:

```ts
export interface BriefingSchedulerPort {
  scheduleForUser(user: User): Promise<void>      // crea repeatable job
  unscheduleForUser(userId: string): Promise<void>
  triggerNow(userId: string): Promise<{ flowId: string }>  // útil para testing
}
```

## Infrastructure

`src/infrastructure/scheduling/BullMQBriefingScheduler.ts`:

Implementa `BriefingSchedulerPort`. 

- `scheduleForUser(user)`: usa `Queue.upsertJobScheduler` o `Queue.add` con `{ repeat: { pattern: cronString, tz: user.briefingTimezone } }` donde `cronString = ${minute} ${user.briefingHour} * * *` (minute random per-user para no apilar todos los users a la misma hora exacta, opcional pero buen detalle).
- Job key: `briefing:${user.id}` para que sea idempotente.
- `unscheduleForUser`: `Queue.removeJobScheduler('briefing:' + userId)`.
- `triggerNow`: usa `FlowProducer` para encolar manualmente la cadena `sync → generate → send` con `data: { userId }` y child handover via `parent` field.

`src/jobs/workers/index.ts`:

Builder que crea los 3 workers (de Pasos 4, 5, 6) más uno nuevo `briefing-trigger` que es el que dispara el cron y lanza el flow:

```ts
// El worker que el cron ejecuta. Su job es lanzar el flow.
export function buildBriefingTriggerWorker(deps: {
  triggerBriefingForUser: TriggerBriefingForUser
  connection: ConnectionOptions
}): Worker {
  return new Worker(
    'briefing-trigger',
    async (job) => {
      const { userId } = job.data as { userId: string }
      return deps.triggerBriefingForUser.execute({ userId })
    },
    { connection: deps.connection },
  )
}
```

Y el `TriggerBriefingForUser` use case orquesta vía `FlowProducer`:

```ts
export class TriggerBriefingForUser {
  constructor(
    private flowProducer: FlowProducer,  // de bullmq
  ) {}

  async execute({ userId }: { userId: string }) {
    const flow = await this.flowProducer.add({
      name: 'send-briefing-email',
      queueName: 'send-briefing-email',
      data: {},
      children: [{
        name: 'generate-briefing',
        queueName: 'generate-briefing',
        data: { userId },
        children: [{
          name: 'gmail-inbox-sync',
          queueName: 'gmail-inbox-sync',
          data: { userId, sinceISO: oneDayAgoISO() },
        }],
      }],
    })
    return { flowId: flow.job.id! }
  }
}
```

**Importante:** el handover automático del return value del child al data del parent — ese es el quid del flow BullMQ. El parent recibe `data` mergeado con los return values de children. Validar la API real de `FlowProducer` en docs y ajustar si la firma cambió. Si Claude Code encuentra ambigüedad, parar y preguntar.

## Worker entry point

`src/workers/start.ts` (script ejecutable):

```ts
import { container } from '../infrastructure/container'

async function main() {
  if (process.env.SCHEDULER_ENABLED !== 'true') {
    console.log('SCHEDULER_ENABLED=false, exit.')
    process.exit(0)
  }

  const workers = [
    container.gmailInboxSyncWorker,
    container.generateBriefingWorker,
    container.sendBriefingEmailWorker,
    container.briefingTriggerWorker,
  ]
  
  // Programar para todos los usuarios activos al arrancar
  await container.scheduleAllActiveBriefings.execute()

  console.log(`${workers.length} workers running. SIGINT to stop.`)
  process.on('SIGINT', async () => {
    await Promise.all(workers.map(w => w.close()))
    process.exit(0)
  })
}

main().catch(err => {
  console.error('Worker startup failed:', err)
  process.exit(1)
})
```

Añadir script en `package.json`:

```json
"scripts": {
  "worker:start": "tsx src/workers/start.ts"
}
```

Modificar el `pnpm dev` para arrancar Next + worker en paralelo via `concurrently` (ya está disponible desde Paso 0):

```json
"dev": "concurrently -n next,worker -c blue,green \"next dev -p 3030\" \"pnpm worker:start\""
```

## Presentación

Página `/settings` (existente desde Paso 3) añade sección "Briefing":
- Hora preferida (input number 0-23).
- Timezone (select con timezones comunes; default Europe/Madrid).
- Toggle activo/inactivo.
- Botón "Generar uno ahora" (llama a `gmail.triggerNow` tRPC mutation).

tRPC router `src/presentation/trpc/routers/scheduling.ts`:
- `updatePreferences` mutation (protected): `UpdateBriefingPreferences` use case.
- `triggerNow` mutation (protected): `BriefingSchedulerPort.triggerNow(userId)`.
- `getPreferences` query (protected): devuelve hora, tz, enabled del user.

## Modificación de Paso 3

Modificar `CompleteGmailConnection` (use case de Paso 3) para llamar a `User.enableBriefing(env.SCHEDULER_DEFAULT_HOUR, env.SCHEDULER_DEFAULT_TIMEZONE)` y `BriefingSchedulerPort.scheduleForUser(user)` tras persistir la integración. Es la única modificación cross-paso necesaria — anotar claramente en el commit.

Análogamente, `DisconnectGmail` debe llamar `BriefingSchedulerPort.unscheduleForUser(userId)` y `User.disableBriefing()`.

## Commits (9 commits)

1. `chore(prisma): añadir preferencias de briefing al modelo User + migración`
2. `feat(domain): User.enableBriefing/disableBriefing/updateBriefingPreferences + errores`
3. `feat(application): UpdateBriefingPreferences + ScheduleAllActiveBriefings + TriggerBriefingForUser use cases`
4. `feat(application): BriefingSchedulerPort y wire-up en use cases existentes (CompleteGmailConnection, DisconnectGmail)`
5. `feat(infra): BullMQBriefingScheduler con cron repeatable + FlowProducer chain`
6. `feat(jobs): worker briefing-trigger + entry point pnpm worker:start`
7. `feat(presentation): tRPC scheduling router + sección "Briefing" en /settings`
8. `chore(scripts): pnpm dev arranca next + worker en paralelo`
9. `test(integration): flow completo trigger → sync → generate → send con BullMQ + Postgres + Redis + Mailpit reales`

## Testing

**Unit tests** (~30 nuevos): User entity nuevos métodos, los 3 use cases nuevos, `TriggerBriefingForUser` orquestación con mock `FlowProducer`.

**Integration tests** (~5 nuevos): el commit 9 es el más crítico — flow E2E con todas las piezas reales:

```ts
test('flow completo briefing-trigger', async () => {
  // setup: user con GmailIntegration mock-cargada, briefing prefs configurados
  // arrancar workers en background
  // disparar triggerNow
  // esperar: ver Briefing en DB y email en Mailpit
}, 30000) // timeout largo porque hay 3 jobs encadenados
```

## Smoke real (deferred)

Requiere todos los smokes anteriores listos:
- Paso 3: Google OAuth real.
- Paso 5: OpenAI key real.
- Paso 6: SMTP real (o Mailpit en dev).

Pasos del smoke:
1. `pnpm dev` (next + worker).
2. Login, conectar Gmail, esperar a que Briefing se programe (logs del worker).
3. Click "Generar uno ahora" en `/settings`.
4. Esperar 30-90s (sync + generate + send).
5. Mailpit en `http://localhost:8025` muestra el email.
6. Reload `/settings`, ver "último briefing: hace 1 minuto".

## Criterios de aceptación

- [ ] 9 commits, gate verde.
- [ ] `pnpm test:unit` ≥ 189/189.
- [ ] `pnpm test:integration` con el E2E flow verde.
- [ ] `pnpm dev` levanta Next + worker simultáneamente sin errores.
- [ ] Visitar `/settings` muestra sección Briefing funcional.
- [ ] Reporte marca smoke real como pendiente.

## Desviaciones aceptables

- Cambios en cron pattern para mejor distribución de carga.
- Añadir lógica de jitter (random delay 0-5min) para no apilar todos los usuarios a la misma hora.
- Helpers extra para parsear timezones.
- UI mejorada en `/settings` con preview "tu próximo briefing será a las XX:XX".

## Desviaciones que requieren parar

- Instalar `date-fns-tz`, `luxon`, `cron-parser` u otras libs sin justificación clara.
- Mover lógica de scheduling fuera de BullMQ (ej. node-cron raw).
- Cambiar arquitectura de jobs (ej. quitar el FlowProducer).

## Al terminar

Reporte final del MVP — el más importante, porque marca el punto donde **el MVP funciona end-to-end** (con creds externas configuradas).

**Tras Paso 7:** queda solo Paso 8 (hardening + deploy). Ese plan se escribe cuando llegues — depende mucho de decisiones sobre hosting, dominio, error tracking que se toman en el momento.
