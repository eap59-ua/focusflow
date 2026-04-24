# FocusFlow

Herramienta personal de productividad. El MVP entrega un único killer feature: **Morning Briefing**, un email diario generado por IA que resume la bandeja de Gmail del usuario.

## Stack

Next.js 15 (App Router) · tRPC · Prisma · PostgreSQL · BullMQ + Redis · OpenAI API · Gmail API (OAuth 2.0) · Tailwind CSS + shadcn/ui · Zod · Vitest · TypeScript estricto.

Arquitectura hexagonal estricta (`domain` / `application` / `infrastructure` / `presentation`). Ver `docs/adr/0001-stack-y-arquitectura.md` para el porqué de cada decisión y `CLAUDE.md` para las reglas operativas.

## Requisitos previos

- Node.js 20+
- pnpm 9+
- Docker + Docker Compose (para Postgres y Redis en local)

## Setup local

```bash
pnpm install
cp .env.example .env
# Rellena las variables obligatorias de .env

docker compose up -d          # Levanta Postgres 16 + Redis 7
pnpm db:migrate               # Aplica migraciones Prisma (cuando existan)
pnpm dev                      # Arranca Next.js y workers BullMQ en paralelo
```

La app queda en `http://localhost:3000`. Health check en `http://localhost:3000/api/health`.

## Scripts

- `pnpm dev` — Next.js + workers BullMQ
- `pnpm build` / `pnpm start` — Build y arranque de producción
- `pnpm lint` — ESLint
- `pnpm typecheck` — TypeScript sin emitir
- `pnpm test:unit` — Tests unitarios (Vitest)
- `pnpm test:integration` — Tests de integración (requiere Docker)
- `pnpm test:e2e` — Tests end-to-end
- `pnpm db:migrate` — Migraciones Prisma en dev
- `pnpm db:deploy` — Migraciones Prisma en producción

## Gate de commit

Antes de cualquier commit:

```bash
pnpm typecheck && pnpm lint && pnpm test:unit
```

Si falla, no se commitea.

## Variables de entorno

Ver `.env.example` para la lista completa. Las claves sensibles (OAuth, OpenAI, encryption) nunca se commitean ni se envían al cliente.

## Estructura

```
src/
├── domain/          # TypeScript puro, cero I/O
├── application/     # Use cases + puertos (interfaces)
├── infrastructure/  # Adapters concretos (Prisma, Gmail, OpenAI, BullMQ)
├── presentation/    # Componentes React, tRPC routers, helpers UI
├── app/             # App Router de Next.js (layouts, pages, route handlers)
└── jobs/            # Workers BullMQ
tests/               # unit / integration / e2e
docs/adr/            # Architecture Decision Records
```

Nota: `src/app/` y `src/presentation/` forman juntos la capa de presentación hexagonal; la división es una concesión a Next.js (ver `docs/adr/0001-stack-y-arquitectura.md`, sección "Notas de implementación").

## Documentación

- `CLAUDE.md` — reglas operativas del repo
- `docs/adr/0001-stack-y-arquitectura.md` — decisiones de arquitectura
