# FocusFlow

## Qué es esto

FocusFlow es una herramienta personal de productividad centrada en un único killer feature en MVP: el Morning Briefing — un email diario generado por IA que resume la bandeja de Gmail del propio usuario y se lo envía cada mañana.

Contexto de producto:

- Single-user, async, personal. No hay multi-tenant ni colaboración en tiempo real.
- MVP objetivo: 6-8 semanas. Fase 1 se cierra cuando Morning Briefing funciona end-to-end de forma fiable.
- Fases futuras (fuera de MVP): conector Calendar, conector Linear, vista web del histórico.

Regla de scope: no se añaden features nuevas hasta que el Morning Briefing MVP esté estable en producción.

## Stack

- Next.js 15 (App Router) como framework full-stack
- tRPC para la capa API tipada cliente↔servidor
- BullMQ + Redis para background jobs (envío diario, procesamiento de emails)
- OpenAI API para la generación del resumen
- Gmail API vía OAuth 2.0 para acceso a la bandeja
- PostgreSQL + Prisma como ORM
- TypeScript estricto en todo el proyecto
- Tailwind CSS + shadcn/ui para UI
- Zod para validación de inputs
- Vitest para testing

## Arquitectura

Arquitectura hexagonal (misma convención que StudySync). Separación estricta por capas:

- `src/domain/` — entidades, value objects y reglas de negocio puras. Cero dependencias externas (ni Prisma, ni Next, ni OpenAI, ni librerías de red). Solo TypeScript.
- `src/application/` — casos de uso. Orquestan el dominio y definen puertos (interfaces) para todo lo que sea I/O.
- `src/infrastructure/` — adapters concretos que implementan los puertos: `PrismaUserRepository`, `GmailClient`, `OpenAIBriefingGenerator`, `BullMQQueue`, etc.
- `src/presentation/` — rutas Next.js, tRPC routers, componentes React. Solo orquestan; no contienen lógica de negocio.

Nota: por requisito de Next.js, el routing del App Router vive en `src/app/`. La capa de presentación hexagonal (componentes React, tRPC routers, helpers UI) vive en `src/presentation/`. Los route handlers de `src/app/` solo orquestan.

Regla de dependencias: el dominio nunca importa de application, infrastructure ni presentation. Application nunca importa de infrastructure ni presentation. Las dependencias fluyen siempre hacia dentro.

## Estructura del repo

- `src/domain/` — entidades, value objects, errores de dominio
- `src/application/` — use cases + puertos (interfaces)
- `src/infrastructure/` — adapters (Prisma, Gmail, OpenAI, BullMQ, Email sender)
- `src/presentation/` — componentes React, tRPC routers, helpers UI
- `src/app/` — App Router de Next.js (routing). Route handlers delgados: construyen inputs, llaman al container, formatean Response. Nada de lógica.
- `src/jobs/` — workers de BullMQ (un archivo por tipo de job)
- `prisma/` — schema y migraciones
- `tests/` — espeja la estructura de `src/`, separado en `unit/`, `integration/`, `e2e/`
- `docs/adr/` — Architecture Decision Records

## Comandos

- Instalar: `pnpm install`
- Dev: `pnpm dev` (Next.js + worker BullMQ en paralelo vía `concurrently`)
- Tests unitarios: `pnpm test:unit`
- Tests integración: `pnpm test:integration` (requiere Docker para Postgres + Redis)
- E2E: `pnpm test:e2e`
- Lint: `pnpm lint`
- Typecheck: `pnpm typecheck`
- Migraciones dev: `pnpm db:migrate`
- Migraciones prod: `pnpm db:deploy`
- Gate de commit: `pnpm typecheck && pnpm lint && pnpm test:unit` debe pasar antes de cualquier commit

## Convenciones de código

- TypeScript estricto (`strict: true`). Nada de `any` salvo en adapters de librerías sin tipos, y siempre con comentario justificando.
- Imports absolutos con alias `@/` configurados en `tsconfig.json`.
- Un caso de uso = un archivo en `application/use-cases/`. Nombre: verbo + entidad (ej. `GenerateMorningBriefing.ts`, `ConnectGmailAccount.ts`).
- Los adapters se inyectan vía un contenedor simple en `src/infrastructure/container.ts`. Nunca se importan directamente en use cases.
- Validación de inputs con Zod. El schema vive al lado del use case que lo consume.
- Errores de dominio son clases que extienden `DomainError`; los adapters de presentación los mapean a códigos HTTP.
- Commits en español, Conventional Commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`.
- Branches: `main` (estable) + `feat/<descripcion-corta>`. PR con descripción y checklist.

## Testing

- TDD en dominio y application: test-first. Se mockea cada puerto.
- Adapters se cubren con integration tests (Prisma contra Postgres de prueba, Gmail con fixtures HTTP, OpenAI con respuestas stub).
- E2E mínimos: solo el happy path del Morning Briefing completo.
- Objetivo de cobertura: 80% en `domain` y `application`. Infraestructura y presentación según valor.

## Qué NO hacer

- No importar Prisma, OpenAI SDK, Gmail SDK ni nada de Next.js dentro de `domain/` o `application/`.
- No llamar a OpenAI ni a Gmail desde un request handler de Next.js — siempre a través de un job de BullMQ.
- No hacer llamadas directas a la API de Gmail desde `application/`; usar el puerto `EmailFetcherPort`.
- No guardar tokens OAuth en texto plano. Encriptación en reposo vía `src/infrastructure/security/`.
- No añadir librerías sin justificarlo en el PR (bundle size + seguridad + mantenimiento).
- No hacer migraciones destructivas sin backup previo y sin revisión explícita.
- No meter lógica de negocio en tRPC routers ni en componentes React.

## Seguridad y privacidad

- Los tokens OAuth de Gmail son datos sensibles: encriptación en reposo, nunca en logs.
- Los contenidos de email nunca se persisten más allá del tiempo necesario para generar el briefing. Política: borrado inmediato tras procesamiento.
- La key de OpenAI va en variables de entorno; no se commitea ni se envía al cliente.
- Rate limiting en endpoints públicos desde el día uno.

## Referencias

Ver @README.md para setup inicial, variables de entorno y arranque en local. Ver @docs/adr/ para decisiones arquitectónicas; empezar por `0001-stack-y-arquitectura.md`. Ver @prisma/schema.prisma para el modelo de datos actualizado.
