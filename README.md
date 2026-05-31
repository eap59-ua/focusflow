# FocusFlow

[![CI](https://github.com/eap59-ua/focusflow/actions/workflows/ci.yml/badge.svg)](https://github.com/eap59-ua/focusflow/actions/workflows/ci.yml)

> Briefing matutino generado por IA a partir de tu inbox de Gmail. Cada mañana recibes un email con resumen estructurado de lo urgente, lo informativo, y el resto.

Single-user, async, personal. Nada de dashboards ni multi-tenant: una persona conecta su Gmail, y a las 8:00 hora local recibe un email.

**Live demo:** https://focusflow.example.com *(placeholder — reemplazar con la URL real de Railway tras el primer deploy; ver [`docs/deploy.md`](docs/deploy.md)).*

> *Screenshot del settings + email recibido pendiente de smoke real con creds. Placeholder hasta entonces.*

## Por qué

Trabajar bien por la mañana implica decidir rápido qué necesita atención y qué no. El inbox no ayuda: es un stream sin priorizar, lleno de newsletters mezcladas con cosas que requieren acción hoy. La inversión cognitiva en escanear Gmail antes del primer café compite con tareas reales.

FocusFlow es la versión más simple posible de "alguien lee tu inbox antes que tú": un briefing diario, en español, con tres secciones (urgente / informativo / resto). Ahorra ~15 minutos al día y reduce la fricción del context-switch matutino.

## Estado

MVP **code-complete**. 32 commits encadenados a través de 8 fases (Paso 0 a Paso 7), 188 unit tests + 35 integration tests, cobertura 98% en `domain` + `application`. Smoke real con credenciales pendiente (ver `docs/pending-external-setup.md`); `pnpm smoke:fakes` valida el chain completo sin necesidad de creds.

Roadmap detallado en [`docs/plan/00-roadmap.md`](docs/plan/00-roadmap.md). Self-audit del código en [`docs/audits/2026-04-self-audit.md`](docs/audits/2026-04-self-audit.md).

## Stack

| Capa | Tecnología | Por qué |
|---|---|---|
| Framework | Next.js 15 (App Router) | Full-stack tipado, route handlers + Server Components con la misma DX. |
| API tipada | tRPC v11 | Sin schema duplicado entre cliente y servidor; refactor seguro. |
| ORM | Prisma 7 + driver adapter `@prisma/adapter-pg` | Migrations versionadas; driver edge-compatible para futuro deploy. |
| BD | PostgreSQL | Standard. Soporta bien transacciones para upserts de integrations. |
| Cache + jobs | Redis + BullMQ 5 | FlowProducer encadena `gmail-inbox-sync → generate-briefing → send-briefing-email`; cron repeatable per-user. |
| LLM | OpenAI SDK v4 (gpt-4o-mini) | Lento de cambiar pero el coste/calidad es óptimo. Lazy-validates apiKey. |
| Email | nodemailer + Mailpit (dev) | SMTP intercambiable; en prod se sustituye por Resend/SES sin tocar use cases. |
| OAuth | google-auth-library + @googleapis/gmail | Library oficial; OAuth2Client con prompt=consent + offline access. |
| UI | Tailwind 3 + Server Components + shadcn/ui (mínimo) | Settings con Server Actions, sin más SPA del que necesita. |
| Validación | Zod | En el boundary (tRPC + Server Actions). El dominio enforza invariantes. |
| Tests | Vitest 4 | Unit + integration con `singleThread` para evitar races sobre la BD compartida. |
| Tipos | TypeScript estricto | `strict: true`; cero `any` salvo en adapters de libs sin tipos. |
| Cifrado | Node.js `crypto` (AES-256-GCM) | Sin dep extra; tokens OAuth en reposo cifrados con clave de 32 bytes. |

## Arquitectura

Hexagonal estricta. Cuatro capas, dependencias siempre hacia dentro:

```
┌────────────────────────────────────────────────────────────┐
│  presentation (src/presentation + src/app)                 │
│    - tRPC routers, Server Components, route handlers       │
│    - Server Actions; mapean DomainError → HTTP status      │
└──────────────────────────┬─────────────────────────────────┘
                           │ depende ↓
┌──────────────────────────┴─────────────────────────────────┐
│  application (src/application)                             │
│    - Use cases (RegisterUser, GenerateBriefing, ...)       │
│    - Puertos (interfaces): EmailFetcherPort, LoggerPort... │
└──────────────────────────┬─────────────────────────────────┘
                           │ depende ↓
┌──────────────────────────┴─────────────────────────────────┐
│  domain (src/domain)                                       │
│    - Entities (User, Briefing, Session, GmailIntegration)  │
│    - Value Objects (Email, EncryptedToken, EmailMessage)   │
│    - Domain errors. Cero I/O. TypeScript puro.             │
└────────────────────────────────────────────────────────────┘
                           ↑ implementa
┌──────────────────────────┴─────────────────────────────────┐
│  infrastructure (src/infrastructure + src/jobs)            │
│    - Adapters: PrismaUserRepository, GmailEmailFetcher,    │
│      OpenAIBriefingGenerator, BullMQBriefingScheduler...   │
│    - Workers BullMQ (un archivo por job)                   │
└────────────────────────────────────────────────────────────┘
```

**Reglas de dependencia** (verificadas a vista en cada PR):

- `domain` no importa de ninguna otra capa.
- `application` importa solo de `domain`.
- `infrastructure` y `presentation` pueden importar de `application` y `domain`, no entre sí (excepto el container, que cablea todo).
- Ningún archivo en `domain/` o `application/` importa Prisma, OpenAI SDK, Gmail SDK, ni librerías de Next.

Detalles en [`CLAUDE.md`](CLAUDE.md) y [`docs/adr/0001-stack-y-arquitectura.md`](docs/adr/0001-stack-y-arquitectura.md).

## Decisiones notables

(Resumen — lista completa en [`docs/audits/2026-04-self-audit.md`](docs/audits/2026-04-self-audit.md) § "Decisiones arquitectónicas notables".)

1. **Sesiones server-side en tabla `sessions`** (no JWT). Permite revocación inmediata + lista activa; el secreto no viaja en cookies salvo el id opaco.
2. **Tokens OAuth cifrados en reposo con AES-256-GCM** vía `node:crypto`. La clave (32 bytes hex) es env var; sin librería externa.
3. **OAuth state en Redis con TTL** (5 min) en vez de tabla DB. Sin migración por cada flow; expiración natural.
4. **BullMQ FlowProducer** para encadenar los 3 jobs del briefing. Resiliencia step-by-step: si el envío SMTP falla, no se re-fetch Gmail.
5. **Capa de serialización explícita** para cruzar la frontera JSON de BullMQ. Las clases del dominio se reconstruyen al deserializar; `Date` viaja como ISO string.
6. **`TriggerBriefingForUser` delega en un puerto** `BriefingSchedulerPort.triggerNow`, no toca BullMQ directamente. Mantiene la inversión.
7. **Política zero-retention**: ninguna tabla persiste contenido raw de email. Cifrado, métricas y resúmenes — sí. Body, snippet, subject — no. Se audita con `pnpm verify:zero-retention`.

## Cómo correr local

```bash
git clone <este-repo>
cd focusflow
cp .env.example .env
# Rellena al menos TOKEN_ENCRYPTION_KEY (genera con
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# ). El resto puede quedarse en defaults para empezar.
# Para conectar Gmail real / OpenAI real, ver docs/pending-external-setup.md.

pnpm install
docker compose up -d           # Postgres 16, Redis 7, Mailpit
pnpm db:migrate                # Aplica el schema Prisma a focusflow
pnpm dev                       # Next.js 3030 + workers BullMQ en paralelo
```

URLs útiles en local:

- App: http://localhost:3030
- Health: http://localhost:3030/api/health
- Mailpit (UI dev de email): http://localhost:8025
- Postgres: `localhost:55432` (user/pwd: `focusflow`/`focusflow`, db `focusflow`)
- Redis: `localhost:6379`

## Tests

```bash
pnpm test:unit                 # 188 tests, ~3s
pnpm test:integration          # 35 tests, requiere docker, ~30s
pnpm test:unit:coverage        # genera coverage/ (98%+ en domain+application)
pnpm typecheck                 # tsc --noEmit
pnpm lint                      # eslint flat config
```

### Verificaciones automáticas

```bash
pnpm verify:zero-retention     # Audita política zero-retention
pnpm smoke:fakes               # E2E con fakes (no necesita creds Google/OpenAI)
```

`verify:zero-retention` ejecuta 5 checks: que `briefings.summary` no contenga cabeceras de email, que no haya tablas `email%`/`message%` fuera de `gmail_integrations`, que no haya columnas `bytea`/`xml`, que las queues con email content tengan `removeOnComplete` acotado, y que `src/jobs/` solo referencie `snippet`/`bodyText` con marcador `// OK: zero-retention`. Detalle: [`docs/audits/zero-retention-policy.md`](docs/audits/zero-retention-policy.md).

`smoke:fakes` boota los 4 workers in-process, dispara el flow para un user dev sembrado, y verifica que el briefing aparece en DB y el email en Mailpit. Tiempo: ~3-5s.

## Logging y observabilidad

Logs estructurados en JSON con shape `{ event, ...metadata }`. Eventos clave:

- `gmail_inbox_fetched` (count, integrationId)
- `briefing_generated` (briefingId, modelUsed, tokensUsedInput/Output)
- `briefing_email_sent` (briefingId, recipientDomain, messageIdPrefix)
- `briefing_triggered` (flowId)

**Lo que NUNCA se loguea**: bodyText, snippet, subject, accessToken, refreshToken. Verificado por test E2E (`tests/unit/observability/logging-events.test.ts`) que escanea todos los payloads en busca de fugas. Política completa: [`docs/audits/logging-policy.md`](docs/audits/logging-policy.md).

## Estructura del repo

```
src/
├── domain/          TypeScript puro, cero I/O. Entities + VOs + errores.
├── application/     Use cases + puertos (interfaces).
├── infrastructure/  Adapters (Prisma, Gmail, OpenAI, BullMQ, Nodemailer).
├── presentation/    Componentes React, tRPC routers, helpers UI.
├── app/             App Router de Next.js (routing). Solo orquesta.
├── jobs/            Workers BullMQ + colas + serialización.
└── workers/         Entry point del proceso de workers.

tests/
├── unit/            Espeja src/, mock cada puerto.
├── integration/     Postgres + Redis reales (docker).
└── e2e/             (placeholder; Playwright futuro).

prisma/              Schema + migraciones.
docs/
├── adr/             Architecture Decision Records.
├── audits/          Self-audits + políticas (zero-retention, logging).
└── plan/            Roadmap del MVP + planes detallados por fase.
scripts/             verify:zero-retention, smoke:fakes.
```

## Gate de commit

Antes de cualquier commit, este comando debe pasar:

```bash
pnpm typecheck && pnpm lint && pnpm test:unit
```

No se hace `--amend` sobre commits que ya pasaron el hook (los pre-commit hooks crearían un commit nuevo si fallan; reset + arreglo + commit nuevo). Reglas operativas completas en [`CLAUDE.md`](CLAUDE.md).

## Variables de entorno

Lista completa en [`.env.example`](.env.example). Las críticas para arrancar:

| Var | Obligatorio | Default | Notas |
|---|---|---|---|
| `DATABASE_URL` | sí | `postgresql://...:55432/focusflow` | docker-compose lo expone aquí |
| `REDIS_URL` | sí | `redis://localhost:6379` | docker-compose |
| `TOKEN_ENCRYPTION_KEY` | sí | (vacío) | 64 hex chars; genera con `node -e ...` |
| `GOOGLE_CLIENT_ID` / `_SECRET` | para OAuth real | (vacío) | Google Cloud Console — pasos en `docs/pending-external-setup.md` |
| `OPENAI_API_KEY` | para briefing real | (vacío) | platform.openai.com/api-keys |
| `SMTP_HOST` / `_PORT` / `_USER` / `_PASS` | dev OK con Mailpit | `localhost:1025` | producción: provider del Paso 8 |
| `SCHEDULER_ENABLED` | no | `true` | `false` hace que `pnpm worker:start` exit 0 sin trabajar |
| `SCHEDULER_DEFAULT_HOUR` | no | `8` | hora local del briefing |
| `SCHEDULER_DEFAULT_TIMEZONE` | no | `Europe/Madrid` | IANA |

Las claves sensibles (OAuth, OpenAI, encryption) **no se commitean** y **no se envían al cliente**. Validado por `next build` (verifica que `src/infrastructure/` no aparezca en client bundles).

## Deploy

Hosting: **Railway all-in-one** (web + worker + Postgres + Redis). Guía técnica
paso a paso en [`docs/deploy.md`](docs/deploy.md); checklist de cuentas y
credenciales en [`docs/pending-external-setup.md`](docs/pending-external-setup.md)
§"Paso 8".

Entregado en el Paso 8 (deploy + hardening):

- ✅ Error tracking con **Sentry** (`@sentry/nextjs`), con `beforeSend` que
  redacta tokens y contenido de email.
- ✅ **CI** GitHub Actions (typecheck + lint + test:unit + test:integration con
  Postgres/Redis/Mailpit) — ver badge arriba.
- ✅ **Branding**: logo SVG, favicon y Open Graph meta tags.
- ✅ Config de deploy: `railway.json` + `Procfile` (migraciones al arrancar).
- ✅ Zero-retention estricto en BullMQ (TTL acotado + wipe en error).

Aún pendiente (post-MVP, **no** incluido en el Paso 8):

- ⏳ Rate limiting en endpoints públicos (`/api/trpc/auth.*`) — mandato de
  `CLAUDE.md`; recomendado antes de exponer un dominio público con tráfico real.
- ⏳ Security headers (CSP, HSTS) en `next.config.ts`.
- ⏳ Landing page `/` con copy + CTA de registro.
- ⏳ El deploy real en sí (cuentas + dominio + smoke con creds): trabajo manual
  del developer, documentado paso a paso.

## Licencia

UNLICENSED. Proyecto personal de portfolio; el código está disponible para revisión pero no para reuso comercial sin permiso.

## Créditos

Hecho con [Claude Code](https://www.anthropic.com/claude-code) (Sonnet 4.6 + Opus 4.7) en modo autónomo durante varias sesiones; ver `docs/plan/` para el roadmap y los planes ejecutados.
