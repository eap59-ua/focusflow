# FocusFlow — Roadmap del MVP (8 fases)

Mapa de alto nivel de las 8 fases del MVP. Cada fase tiene su propio archivo `NN-*.md` con el plan detallado; se escribe *justo antes de ejecutarla*, contra el estado real del repo tras la fase anterior (no se pre-escriben todas para evitar contradicciones con desviaciones aprobadas en fases previas).

**Objetivo del MVP:** el *Morning Briefing* funcional end-to-end. Single-user, async, personal. Cualquier feature que no esté en la ruta directa hacia ese objetivo es post-MVP.

## Principios que aplican a todas las fases

1. **`CLAUDE.md` es fuente de verdad** sobre el gate de commit, las reglas de arquitectura y las prohibiciones. Si un plan lo contradice, el plan se ajusta.
2. **Commits por unidad lógica cerrada**, nunca por fase TDD. Gate verde en cada commit.
3. **Agregados persistidos incluyen `.restore()`** en el mismo commit del agregado, junto al factory principal. Evita filtrar reconstitución al adapter.
4. **Zod en el boundary, invariantes en el dominio.** Zod valida shape (que sea string, number, etc.). El dominio enforza reglas de negocio (formato de email, longitudes, rangos).
5. **Cero secretos en repo.** `.env.example` con placeholders; `.env` en gitignore; `.env.test` solo si contiene únicamente credenciales locales del `docker-compose.yml`.
6. **Todo I/O a través de un puerto.** Use cases nunca importan Prisma, Gmail SDK, OpenAI SDK directamente.

## Fases

### Paso 0 — Scaffolding ✅

Estructura del repo (hexagonal), dependencias base, health endpoint, Docker compose, vitest config, ESLint flat, Tailwind, tRPC skeleton, Prisma 7 con driver adapter. **Commit base:** `d4d6d73`.

### Paso 1 — Registro de usuario ✅

Caso de uso `RegisterUser` atravesando las 4 capas. Password bcrypt, errores tipados, tRPC + página `/register`, integration test contra Postgres real. **Branch:** `feat/01-auth-registro`.

### Paso 2 — Login + sesiones

- `LoginUser` use case: email + password → sesión.
- `LogoutUser`, `GetCurrentUser` (para middleware tRPC).
- `Session` entity + `PrismaSessionRepository`.
- Cookie de sesión httpOnly + secure (prod). `/login` y `/logout` en presentación.
- Middleware tRPC que inyecta `ctx.user` desde cookie.
- Integration test: login OK, password incorrecto, sesión persiste entre requests, logout invalida.

**Criterio "hecho":** usuario puede registrarse, loguearse, ver un endpoint protegido (`auth.me`), y hacer logout. Dependencia resuelta para Paso 3.

### Paso 3 — OAuth Gmail + encriptación de tokens

- Flujo OAuth 2.0 con Google (authorization code + PKCE).
- `GmailIntegration` entity asociada a `User`.
- Servicio `TokenEncryption` en `src/infrastructure/security/` (AES-256-GCM, key en env).
- Refresh token handling.
- Endpoint `/settings/gmail/connect` → redirect a Google → callback `/settings/gmail/callback` → persistir tokens encriptados.
- Integration test con fixtures HTTP de Google.

**Prerequisito humano:** crear proyecto en Google Cloud Console, habilitar Gmail API, generar Client ID + Client Secret, añadir redirect URI. Sin esto, el plan se bloquea en ejecución.

**Criterio "hecho":** usuario conecta su Gmail y queda persistido. Tokens nunca en claro en DB ni logs.

### Paso 4 — Ingesta de emails (Gmail sync job)

- Puerto `EmailFetcherPort`; adapter `GmailEmailFetcher`.
- BullMQ job `sync-gmail-inbox` que corre per-usuario.
- Dedup por `Message-Id`.
- Entidad `EmailMessage` efímera: solo durante procesamiento, **nunca se persiste**. Política zero-retention del `CLAUDE.md`.
- Rate-limit handling de Gmail API (exponential backoff).

**Criterio "hecho":** job fetches últimos N emails (por query `in:inbox newer_than:1d`), los normaliza a `EmailMessage` en memoria, y termina sin persistir contenidos.

### Paso 5 — Generación del Briefing con OpenAI

- Puerto `BriefingGeneratorPort`; adapter `OpenAIBriefingGenerator`.
- BullMQ job `generate-briefing` que recibe `EmailMessage[]` en memoria y llama OpenAI.
- Prompt template en `src/infrastructure/openai/prompts/`. Versionado como constante, no como archivo externo.
- Entidad `Briefing` que SÍ se persiste (summary, createdAt, userId) — no contiene emails crudos.
- Token budget: trunca entrada si supera N tokens; registra cuántos se usaron (métrica de coste).

**Prerequisito humano:** OpenAI API key en `.env`.

**Criterio "hecho":** dado un set de `EmailMessage`, genera `Briefing` con summary coherente y lo guarda.

### Paso 6 — Envío del email diario

- Puerto `EmailSenderPort`; adapter `NodemailerEmailSender` (SMTP configurable).
- Template HTML del briefing en `src/infrastructure/email/templates/`.
- BullMQ job `send-briefing-email` que recibe un `Briefing.id`, carga de DB, renderiza, envía.
- Dev: usa mailhog o similar en docker-compose. Prod: provider real (Resend, SES, lo que se elija en Paso 8).

**Criterio "hecho":** usuario recibe en su inbox un email con el briefing renderizado correctamente.

### Paso 7 — Scheduling diario (BullMQ cron)

- Scheduler BullMQ con repeat `cron` per-user.
- User preferences: hora de envío (default 08:00), timezone (default Europe/Madrid).
- Chain de jobs: `sync-gmail-inbox` → `generate-briefing` → `send-briefing-email`.
- Handling de fallos: retry con backoff, dead letter queue, usuario recibe email de error tras 3 intentos.

**Criterio "hecho":** el MVP funciona sin intervención. Te registras, conectas Gmail, y al día siguiente a las 8:00 recibes tu briefing.

### Paso 8 — Hardening + landing + deploy

- Rate limit en endpoints públicos (`/api/trpc/auth.*`) con Redis.
- Observabilidad: structured logging, error tracking (Sentry o similar).
- Landing page `/` con explicación del producto y CTA a registro.
- CI/CD: GitHub Actions con gate (typecheck + lint + test:unit + test:integration) + deploy automático a Vercel o Railway.
- Security headers (CSP, HSTS, etc.) en `next.config.ts`.
- README.md público con screenshots, stack, cómo correr local, cómo deployar.

**Criterio "hecho":** URL pública visitable, deploy automático desde `main`, logs consultables, 99%+ uptime.

## Qué NO entra en el MVP (post-MVP explícito)

- Conectores adicionales (Calendar, Linear, Slack, GitHub).
- Dashboard web con histórico de briefings (solo email por ahora).
- Settings UI avanzados (frecuencia custom, filtros de labels Gmail, etc.).
- Multi-tenant / equipos.
- API pública monetizable.
- App móvil.
- Sistema de pagos / suscripciones.

Todo lo anterior es perfectamente construible *después* del MVP, pero meterlo antes rompe el "6-8 semanas" y la regla de scope-lock del `CLAUDE.md`.

## Estimación de esfuerzo (orientativa, no contractual)

Supuesto: trabajo en paralelo a StudySync, sesiones de 2-4 horas, con Claude Code en modo `--dangerously-skip-permissions` por fase y checkpoints solo en bloqueos externos (Docker, OAuth creds, API keys, git push).

| Fase | Horas estimadas | Principal bloqueo externo |
|------|-----------------|---------------------------|
| 1 | 6-8 ✅ | — |
| 2 | 6-8 | — |
| 3 | 10-14 | Google Cloud Console (OAuth) |
| 4 | 6-10 | — |
| 5 | 6-10 | OpenAI API key |
| 6 | 4-6 | SMTP provider |
| 7 | 6-8 | — |
| 8 | 10-16 | Hosting (Vercel/Railway) |

**Total MVP estimado:** 54-80 horas de trabajo efectivo.

## Convención de archivos de plan

- `docs/plan/00-roadmap.md` — este archivo. Se actualiza tras cada fase con desviaciones aprobadas.
- `docs/plan/NN-nombre.md` — plan detallado por fase. Se escribe justo antes de ejecutar (no pre-escritos en batch).
- `docs/plan/01-auth-registro.md` — ya commiteado, ejecutado con 11 commits finales sobre el base del Paso 0.

Los planes son artefactos vivos: al terminar una fase, se anota un bloque `## Desviaciones del plan` al final del archivo correspondiente, con cada desviación aprobada durante la ejecución.
