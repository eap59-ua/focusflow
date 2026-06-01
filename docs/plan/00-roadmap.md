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

### Paso 2 — Login + sesiones ✅

- `LoginUser`, `LogoutUser`, `GetCurrentUser` use cases.
- `Session` entity + `PrismaSessionRepository` + `SessionRepositoryPort`.
- Cookie httpOnly + `SameSite=Lax` (Secure en prod). Páginas `/login` y `/`.
- Middleware `requireUser` en context tRPC.
- 53/53 unit + 6/6 integration + 100% cobertura en domain+application.

**Branch:** `feat/02-login-sesiones`. **Criterio "hecho":** resuelto — el usuario puede registrarse, loguearse, llegar a endpoint protegido y hacer logout end-to-end.

### Paso 3 — OAuth Gmail + encriptación de tokens ✅ (código) / 🛑 (smoke real pendiente)

- Flujo OAuth 2.0 con Google (`google-auth-library`).
- `GmailIntegration` entity + `EncryptedToken` VO.
- `AesGcmTokenEncryption` (AES-256-GCM con `node:crypto`).
- `RedisOAuthStateStore` para CSRF state con TTL.
- Use cases: `BeginGmailConnection`, `CompleteGmailConnection`, `RefreshGmailToken`, `DisconnectGmail`.
- 9 commits, 102/102 unit + 13/13 integration verdes, 99.44% cobertura.

**Branch:** `feat/03-oauth-gmail`. **Smoke real pendiente** porque requiere setup de Google Cloud Console (ver `docs/pending-external-setup.md`).

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
- `docs/plan/NN-nombre.md` — plan detallado por fase.

**Excepción al patrón "uno-a-uno"**: tras el Paso 3 se escribieron de golpe los planes 04, 05, 06, 07 porque el desarrollador entró en modo time-constrained y necesita Claude Code trabajando en autónomo. Cada plan incluye un aviso explícito de "escrito predictivamente, parar y reportar si el repo real contradice asunciones". Esto es trade-off consciente — la alternativa era pausar el proyecto hasta que el desarrollador volviese.

Los planes son artefactos vivos: al terminar una fase, se anota un bloque `## Desviaciones del plan` al final del archivo correspondiente, con cada desviación aprobada durante la ejecución.

## Estado actual

- **Paso 0-2:** ✅ mergeados en main.
- **Paso 3:** código ✅ en `feat/03-oauth-gmail`, smoke real pendiente, esperando push y merge del developer.
- **Pasos 4-7:** planes escritos, en cola para ejecución autónoma. Branch chain prevista: `feat/04-ingesta-gmail` desde `feat/03-oauth-gmail`, `feat/05-briefing-openai` desde 04, etc.
- **Paso 8:** plan no escrito, depende de decisiones de hosting que se toman cerca del momento.
