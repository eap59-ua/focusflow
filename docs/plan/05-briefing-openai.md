# Paso 5 — Generación del Briefing con OpenAI

Quinta fase del MVP. Construye el job BullMQ que recibe `EmailMessage[]` en memoria del Paso 4, genera un resumen estructurado vía OpenAI API, y persiste UN `Briefing` (summary + metadata, **nunca** los emails crudos).

**Dependencia de entrada:** Paso 4 disponible (use case `FetchInboxEmails`, queue `gmail-inbox-sync`).

**Dependencia de salida:** desbloquea Paso 6 (envío de email diario), que recibirá `Briefing.id` para renderizar y enviar.

## Aviso sobre escritura predictiva del plan

Escrito antes de ejecutar Paso 4 contra el repo real. Si Claude Code encuentra contradicción entre este plan y el estado del repo post-Paso-4, **parar y reportar**.

## Pre-requisitos verificables

1. `git status` limpio, sobre `feat/04-ingesta-gmail` (o main si mergeado).
2. `pnpm test:unit && pnpm test:integration` verde.
3. `docker compose ps` — `postgres` y `redis` running.
4. **Sin smoke real disponible**: `OPENAI_API_KEY` está vacía o ausente del `.env` (anotado en `pending-external-setup.md`). Los tests usan `FakeBriefingGenerator`. El smoke real se hace después de que el usuario añada la key.

## Branch

`feat/05-briefing-openai` desde `feat/04-ingesta-gmail`.

## Deps pre-autorizadas

```bash
pnpm add openai@^4
```

Justificación:
- `openai`: SDK oficial de OpenAI. Trae sus propios tipos. Cubre Chat Completions, Responses API, retries automáticos. Standard para integraciones LLM en Node.

**NO añadir:**
- `langchain`, `vercel-ai`, ni frameworks LLM. Para un MVP con un solo prompt, son sobre-ingeniería.
- `tiktoken` para contar tokens — el SDK de OpenAI ya devuelve `usage` en cada respuesta. Si Claude Code necesita estimar tokens *antes* de llamar (para truncar input proactivamente), usar la heurística "1 token ≈ 4 chars" sin librería.

## Variables de entorno

Añadir al `.env.example`:

```
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
OPENAI_MAX_INPUT_TOKENS=8000
```

`OPENAI_MODEL` con default `gpt-4o-mini`: barato (~$0.15/M input, $0.60/M output), suficiente para resumen estructurado de emails. Si en Paso 8 quieres calidad superior, cambiar a `gpt-4o` con un toggle de env.

`OPENAI_MAX_INPUT_TOKENS`: límite proactivo. Si el set de emails excede esto en heurística (4 chars/token), truncar al primer N que quepa. Reportar truncado en el output del job.

El `.env` real del usuario tiene `OPENAI_API_KEY` vacío hasta que cree la key. Tests usan `FakeBriefingGenerator`, no rompen.

## Modelo de datos

Añadir a `schema.prisma`:

```prisma
model Briefing {
  id              String   @id @default(uuid())
  userId          String
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  summary         String   @db.Text
  emailsConsidered Int     // cantidad de emails que entraron al prompt
  emailsTruncated Int      // cantidad descartada por límite de tokens
  tokensUsedInput  Int
  tokensUsedOutput Int
  modelUsed       String
  createdAt       DateTime @default(now())

  @@index([userId, createdAt(sort: Desc)])
  @@map("briefings")
}
```

Relación inversa en `User`:

```prisma
briefings Briefing[]
```

Migración: `pnpm prisma migrate dev --name add_briefings`.

## Domain

`src/domain/briefing/Briefing.ts`:

Entidad con `id`, `userId`, `summary`, `emailsConsidered`, `emailsTruncated`, `tokensUsedInput`, `tokensUsedOutput`, `modelUsed`, `createdAt`.

Factory `Briefing.create({ userId, summary, ... })`. `restore({ ... })` para cargar desde DB.

Invariantes:
- `summary` no vacío, longitud mínima 50 chars (un briefing trivial es bug).
- `emailsConsidered >= 0`, `emailsTruncated >= 0`.
- `tokensUsedInput, tokensUsedOutput >= 0`.

Errors:
- `BriefingTooShortError` (summary < 50 chars).
- `BriefingNotFoundError` (lookup falla).

## Application

Port `src/application/ports/BriefingGeneratorPort.ts`:

```ts
export interface BriefingGenerationResult {
  summary: string
  tokensUsedInput: number
  tokensUsedOutput: number
  modelUsed: string
}
export interface BriefingGeneratorPort {
  generate(emails: EmailMessage[]): Promise<BriefingGenerationResult>
}
```

Port `src/application/ports/BriefingRepositoryPort.ts`:

```ts
export interface BriefingRepositoryPort {
  save(briefing: Briefing): Promise<void>
  findById(id: string): Promise<Briefing | null>
  findLatestByUserId(userId: string): Promise<Briefing | null>
}
```

Use case `src/application/use-cases/briefing/GenerateBriefing.ts`:

Input: `{ userId: string, emails: EmailMessage[] }`.

Flujo:
1. Si `emails.length === 0` → caso especial: `Briefing.create` con summary tipo "No tienes emails nuevos esta mañana." y métricas en 0. No llamar OpenAI (ahorro de costes).
2. Truncar input si excede `OPENAI_MAX_INPUT_TOKENS` (heurística 4 chars/token sumando subjects + snippets + bodies). Registrar `emailsTruncated`.
3. Llamar `BriefingGeneratorPort.generate(truncatedEmails)`.
4. Construir `Briefing.create({...})` con summary y métricas.
5. `BriefingRepositoryPort.save(briefing)`.
6. Retornar `{ briefingId: string }`.

Tests unitarios: 8 casos (vacío → mensaje placeholder, sin truncar, con truncar, propagación de error de OpenAI port, generator devuelve summary corto → error tipado, etc.).

## Infrastructure

`src/infrastructure/adapters/OpenAIBriefingGenerator.ts`:

Implementa `BriefingGeneratorPort`. Constructor recibe `{ apiKey, model, openaiClient? }` (cliente inyectable para tests). En arranque, valida que `apiKey` no esté vacío — si lo está, lanza al construir un error claro: "OPENAI_API_KEY no configurada. Ver docs/pending-external-setup.md."

Prompt (constante en `src/infrastructure/openai/prompts/morning-briefing.ts`):

```ts
export const MORNING_BRIEFING_PROMPT_VERSION = 'v1.0.0'

export function buildMorningBriefingPrompt(emails: EmailMessage[]): {
  system: string
  user: string
} {
  const system = `Eres un asistente de productividad que genera briefings matutinos concisos a partir de emails recientes del usuario. 

Reglas:
- Responde SIEMPRE en español neutro.
- Estructura el briefing en 3 secciones: 
  1. **Lo más urgente** (max 3 items): emails que requieren acción hoy.
  2. **Para tu información** (max 5 items): updates relevantes pero no urgentes.
  3. **Resumen del resto**: 1-2 frases si hay más emails sin abordar.
- Cada item: 1-2 líneas. Cita el remitente y el asunto.
- Si NO hay nada urgente, di explícitamente "Sin asuntos urgentes esta mañana."
- NO inventes información. Si un email es ambiguo, no lo extrapolas.
- Tono: directo, profesional, breve. Como un jefe de gabinete competente.`

  const user = emails
    .map((e, i) => `Email ${i + 1}:
De: ${e.fromName ?? e.fromEmail} <${e.fromEmail}>
Asunto: ${e.subject}
Recibido: ${e.receivedAt.toISOString()}
Cuerpo: ${e.bodyText.slice(0, 1500)}`)
    .join('\n\n---\n\n')

  return { system, user }
}
```

Llamada a OpenAI:

```ts
const response = await this.client.chat.completions.create({
  model: this.model,
  messages: [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ],
  temperature: 0.3,           // resúmenes consistentes, no creativos
  max_tokens: 1500,
})

const summary = response.choices[0]?.message?.content?.trim() ?? ''
const usage = response.usage

return {
  summary,
  tokensUsedInput: usage?.prompt_tokens ?? 0,
  tokensUsedOutput: usage?.completion_tokens ?? 0,
  modelUsed: response.model,
}
```

`src/infrastructure/adapters/PrismaBriefingRepository.ts`: implementa `BriefingRepositoryPort`. Standard Prisma adapter pattern (igual que `PrismaUserRepository` y `PrismaSessionRepository`).

## Jobs

Modificar `src/jobs/queues.ts` para añadir cola:

```ts
export const generateBriefingQueue = new Queue('generate-briefing', { connection })
```

`src/jobs/workers/generate-briefing.ts`:

```ts
export interface GenerateBriefingJobData {
  userId: string
  emails: EmailMessage[]   // recibidos via flow handover desde gmail-inbox-sync
}
export interface GenerateBriefingJobResult {
  briefingId: string
}

export function buildGenerateBriefingWorker(deps: {
  generateBriefing: GenerateBriefing
  connection: ConnectionOptions
}): Worker<GenerateBriefingJobData, GenerateBriefingJobResult> {
  return new Worker(
    'generate-briefing',
    async (job) => {
      const { briefingId } = await deps.generateBriefing.execute(job.data)
      return { briefingId }
    },
    { connection: deps.connection },
  )
}
```

**Modificar también el worker de Paso 4** (`gmail-inbox-sync`) para que su return value incluya `emails: EmailMessage[]`:

```ts
// Worker gmail-inbox-sync (modificado en este paso):
return { count: emails.length, integrationId, emails }
```

Esto permite que en Paso 7, el `FlowProducer` de BullMQ pase el return value como `data` del siguiente job. Por ahora el chaining se hace en tests manualmente.

**Crítico zero-retention recordatorio:** el campo `emails` en `GenerateBriefingJobData` viaja en Redis (BullMQ) entre workers. Esto está OK porque:
- TTL de jobs en BullMQ se configura: keep `removeOnComplete: { age: 3600, count: 100 }` para que jobs completados se borren tras 1h y no acumulen contenido de email indefinidamente.
- Configurar `removeOnFail: { age: 7 * 24 * 3600 }` para inspección de fallos durante 1 semana (trade-off entre debug y privacidad — anotar en reporte).

## Commits (8 commits)

1. `chore(prisma): añadir modelo Briefing y migración add_briefings`
2. `feat(domain): Briefing entity con factory create y restore`
3. `feat(application): BriefingGeneratorPort + BriefingRepositoryPort + GenerateBriefing use case`
4. `feat(infra): PrismaBriefingRepository`
5. `feat(infra): OpenAIBriefingGenerator + prompt morning-briefing v1.0.0`
6. `feat(jobs): cola generate-briefing y modificación de gmail-inbox-sync para handover de emails`
7. `test(integration): GenerateBriefing end-to-end con FakeBriefingGenerator + Postgres real`
8. `test(integration): worker generate-briefing con BullMQ + Redis reales`

## Testing

**Unit tests** (~25 nuevos): factory de `Briefing`, casos de `GenerateBriefing` use case (8 casos descritos arriba), parser del prompt builder.

**Integration tests** (~5 nuevos): `PrismaBriefingRepository` save/find, worker procesa job y devuelve briefingId, edge case de `emails.length === 0` no llama OpenAI.

**Smoke con OpenAI real (deferred):** requiere `OPENAI_API_KEY` configurada. Reportar como pendiente, con referencia a `pending-external-setup.md`.

## Criterios de aceptación

- [ ] 8 commits atómicos, gate verde en cada uno.
- [ ] `pnpm test:unit` ≥ 147/147 (~25 nuevos sobre Paso 4).
- [ ] `pnpm test:integration` con 5 nuevos verdes.
- [ ] Cobertura en `domain/briefing/` y `application/use-cases/briefing/` ≥ 80%.
- [ ] **Zero-retention**: `grep -r "from.*EmailMessage" src/infrastructure/adapters/Prisma*` debe estar vacío. Ningún adapter Prisma toca emails.
- [ ] `OPENAI_API_KEY` ausente → `pnpm test:unit` y `pnpm test:integration` siguen verdes (porque tests usan fakes y `OpenAIBriefingGenerator` solo se construye si está la key).
- [ ] **Verificación de prompt versionado**: `MORNING_BRIEFING_PROMPT_VERSION` aparece en logs del job y en metadata del Briefing si conviene (decisión de Claude Code: añadir o no a `Briefing` entity, anotar).
- [ ] Reporte final marca smoke OpenAI como pendiente.

## Desviaciones aceptables sin preguntar

- Añadir `promptVersion` al `Briefing` entity para tracking.
- Cambiar `temperature` o `max_tokens` si tras pruebas se ve que mejora calidad.
- Añadir `BriefingMetadata` VO si las métricas se vuelven inmanejables como flat fields.
- Reordenar secciones del prompt si mejora calidad (anotar el cambio).

## Desviaciones que requieren parar y reportar

- Cambiar de modelo (de `gpt-4o-mini` a otro) sin acuerdo — afecta costes y calidad.
- Persistir contenidos de email en DB.
- Llamar OpenAI desde un request handler (no, solo desde worker BullMQ).
- Almacenar prompt en BD o filesystem en runtime — debe ser constante en código.
- Encontrar que la API de `openai@^4` cambió significativamente.

## Al terminar

Reporte con commits, gate, cobertura, smoke pendiente, desviaciones, confirmación zero-retention.

**Branch siguiente:** `feat/06-envio-email` desde `feat/05-briefing-openai`.
