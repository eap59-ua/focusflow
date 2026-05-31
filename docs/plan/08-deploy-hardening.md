# Paso 8 — Deploy + Hardening (final del MVP)

Octava y última fase del MVP. Despliega la app en producción (Railway), añade observabilidad (Sentry), CI (GitHub Actions), branding mínimo, y arregla los smells worth-fixing del audit de 7b. Al terminar este paso, FocusFlow tiene URL pública, deploy automático desde main, error tracking, y un README que vende.

**Dependencia de entrada:** Paso 7b mergeable. Branch chain `feat/03 → feat/04 → feat/05 → feat/06 → feat/07 → feat/07b-revision-y-debug` con todos los planes ejecutados.

**Dependencia de salida:** ninguna — esto cierra el MVP.

## Decisiones tomadas (respuestas a 08a-decisiones-pendientes.md)

| # | Pregunta | Decisión |
|---|---|---|
| 1 | Hosting | **Railway all-in-one** (app + Postgres + Redis incluidos, $5/mes, deploy automático desde GitHub) |
| 2 | Dominio | **Custom dominio** (~$12/año, comprar en Namecheap o Porkbun; el nombre lo elige el developer al hacer setup externo) |
| 3 | Error tracking | **Sentry free tier** (`@sentry/nextjs`) |
| 4 | CI | **GitHub Actions con gate completo** (typecheck + lint + test:unit + test:integration con Postgres+Redis services) |
| 5 | OAuth consent | **Testing mode** (sin verification; suficiente para single-user + ~10 test users) |
| 6 | Branding | **Logo SVG casero + favicon + Open Graph meta tags** |
| S1 | Zero-retention en Redis | **Opción A: tight TTL + wipe en error** |

## Pre-requisitos verificables

1. `git status` limpio sobre `feat/07b-revision-y-debug`.
2. `pnpm test:unit && pnpm test:integration` verde (esperado: 188 unit + 35 integration).
3. `docker compose ps` — servicios running para tests integration.

## Branch

`feat/08-deploy-hardening` desde `feat/07b-revision-y-debug`.

## Deps pre-autorizadas

```bash
pnpm add @sentry/nextjs@^8
```

Justificación: SDK oficial de Sentry para Next.js. Trae sus propios tipos. Configura instrumentación de Server Components, Route Handlers, y Edge runtime con un solo wrapper.

**NO añadir:**
- `@sentry/node` aparte — `@sentry/nextjs` lo incluye.
- Otro provider de error tracking (Logtail, Datadog) — Sentry es la decisión.
- Ningún framework de feature flags, analytics, A/B testing — fuera de scope MVP.
- Librerías de SVG/iconos (`react-icons`, `lucide-react`) — el logo es un SVG inline manual.

## Variables de entorno nuevas

Añadir al `.env.example`:

```
# Sentry (free tier — crear proyecto en sentry.io, copiar DSN)
SENTRY_DSN=
SENTRY_ENVIRONMENT=development

# App URL (usado en redirects y meta tags Open Graph)
APP_URL=http://localhost:3030
```

En producción Railway sobreescribe `APP_URL` con la URL pública. `SENTRY_DSN` vacío en dev hace que el SDK degrade gracefully (no envía nada).

## Commits (9 commits, atómicos, gate verde en cada uno)

### Commit 1 — `fix(jobs): zero-retention strict en BullMQ — TTL tight + wipe en error handler (S1)`

Modificar `src/jobs/queues.ts`:

```ts
const STRICT_ZERO_RETENTION = {
  removeOnComplete: { age: 300, count: 50 },   // 5 min, suficiente para chain handover
  removeOnFail: { age: 3600, count: 100 },     // 1 hora, mínimo para debug post-fallo
}

export const gmailInboxSyncQueue = new Queue('gmail-inbox-sync', {
  connection,
  defaultJobOptions: STRICT_ZERO_RETENTION,
})
// ... mismo para generateBriefingQueue, sendBriefingEmailQueue, briefingTriggerQueue
```

Modificar los 3 workers de Pasos 4, 5, 7 (no el de Paso 6 — ese no toca contenido sensible) para wipear payload sensible en error handler:

```ts
// gmail-inbox-sync worker
new Worker('gmail-inbox-sync', async (job) => {
  try {
    return await actualHandler(job)
  } catch (err) {
    // wipe sensitive data del job ANTES de que BullMQ lo persista en estado fallido
    await job.updateData({ userId: job.data.userId, sinceISO: job.data.sinceISO, _wiped: true })
    throw err
  }
}, { connection })
```

Mismo patrón para `generate-briefing` (wipe `emails`) y para `briefing-trigger` (no toca contenido pero por consistencia).

Actualizar `docs/audits/zero-retention-policy.md` con el bloque "Compromiso explícito":

```markdown
## Compromiso explícito (Paso 8)

`CLAUDE.md` dice "borrado inmediato tras procesamiento". La realidad práctica de BullMQ + Redis impone una ventana mínima:

- **Happy path:** payloads en Redis hasta 5 min tras éxito (necesario para FlowProducer chain handover entre workers).
- **Failure path:** payloads en Redis hasta 1 h tras fallo, con `bodyText`/`snippet`/`emails` wipeados explícitamente en el error handler.

Esto NO viola la política — el wipe en error garantiza que ningún contenido sensible sobrevive al fallo. La ventana de 5 min en éxito es el mínimo técnico para que el flow funcione.

Verificación automatizada: `pnpm verify:zero-retention` chequea estas TTLs.
```

Actualizar `scripts/verify-zero-retention.ts` para que también verifique los settings de TTL son los esperados (lee config de `queues.ts` o de Redis directamente).

Tests: añadir 2 tests en cada worker que verifiquen que el error handler wipea el payload (mockear `job.updateData` y assertar que se llama con los campos correctos antes del re-throw).

### Commit 2 — `fix(application): smells worth-fixing del audit (S2, S3, S4, S6)`

Bundle de los 4 fixes pequeños:

**S2 — preservar briefing prefs en reconexión Gmail:**
En `CompleteGmailConnection`, antes del `User.enableBriefing(...)`, leer las prefs actuales y solo usar defaults si vienen "cero estado":
```ts
const currentUser = await this.userRepo.findById(userId)
const hour = currentUser.briefingHour ?? env.SCHEDULER_DEFAULT_HOUR
const tz = currentUser.briefingTimezone ?? env.SCHEDULER_DEFAULT_TIMEZONE
user.enableBriefing(hour, tz)  // mantiene prefs anteriores si existían
```

**S3 — doble allocation en UpdateBriefingPreferences:**
En la rama `enabled === false`, evitar re-construir `User` con prefs si solo vamos a llamar a `disableBriefing()`. Refactor menor de 3 líneas.

**S4 — fallback graceful para summary corto de OpenAI:**
En `GenerateBriefing`, si el `BriefingGeneratorPort.generate()` devuelve summary <50 chars (`BriefingTooShortError` interno), no propagar al usuario. En su lugar:
```ts
catch (err) {
  if (err instanceof BriefingTooShortError) {
    return { briefing: await this.fallbackBriefing(userId, emails.length) }
  }
  throw err
}

private async fallbackBriefing(userId: string, count: number): Promise<Briefing> {
  return Briefing.create({
    userId,
    summary: `Hoy procesé ${count} emails de tu inbox. El generador de IA produjo un resumen demasiado corto, posiblemente por baja relevancia. Revisa tu inbox directamente si esperabas algo importante.`,
    // ... metadata con flags fallback=true
  })
}
```

**S6 — clean exit de SCHEDULER_ENABLED=false con concurrently:**
En `src/workers/start.ts`, en lugar de `process.exit(0)` cuando `SCHEDULER_ENABLED=false`, dejar el proceso vivo en idle (loop dormido) para que `concurrently` no asuma fallo:
```ts
if (process.env.SCHEDULER_ENABLED !== 'true') {
  console.log('SCHEDULER_ENABLED=false — worker idle.')
  // Mantener proceso vivo sin hacer nada útil. concurrently respeta esto.
  await new Promise(() => {}) // never resolves
}
```

**S5 (markdown→HTML frágil) NO se incluye** — el plan de 7b dijo "no añadir librería marked" y un fix manual del regex es alta probabilidad de introducir bugs sutiles. Documentar en el commit message como "deferred to post-MVP, plain markdown fragility tolerated for MVP". Si en algún momento un user reporta render mal, se reabre.

Tests para cada fix.

### Commit 3 — `chore(observability): @sentry/nextjs config + DSN env`

Instalar `@sentry/nextjs`. Crear archivos de config:

- `sentry.server.config.ts` — instrumenta server-side, `dsn: env.SENTRY_DSN`, `environment: env.SENTRY_ENVIRONMENT`, `tracesSampleRate: 0.1`.
- `sentry.client.config.ts` — instrumenta client-side, mismo DSN, `tracesSampleRate: 0.05`.
- `sentry.edge.config.ts` — para Edge runtime (Next.js Middleware), mismo DSN.

Modificar `next.config.ts` con `withSentryConfig(...)` wrapper.

Crítico — instrumentación segura:
- `beforeSend` hook que filtra `accessToken`, `refreshToken`, `bodyText`, `snippet`, `subject` de cualquier breadcrumb o context que se vaya a enviar a Sentry. Whitelist de campos OK: `userId`, `briefingId`, `messageId`.
- `ignoreErrors: ['SessionExpiredError', 'InvalidCredentialsError', 'UserNotFoundError']` — errores esperados de aplicación que no son bugs.

Si `SENTRY_DSN` está vacío, SDK no envía nada (degrada gracefully).

Test: con un mock de `Sentry.captureException`, ejecutar un use case que arroja `SessionExpiredError` y verificar que no se llama. Ejecutar otro que arroja `Error` genérico y verificar que sí.

### Commit 4 — `chore(ci): GitHub Actions workflow con gate completo`

Crear `.github/workflows/ci.yml`:

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: focusflow
          POSTGRES_PASSWORD: focusflow
          POSTGRES_DB: focusflow_test
        ports: ['5432:5432']
        options: >-
          --health-cmd pg_isready --health-interval 10s
          --health-timeout 5s --health-retries 5
      redis:
        image: redis:7
        ports: ['6379:6379']
        options: >-
          --health-cmd "redis-cli ping" --health-interval 10s
          --health-timeout 5s --health-retries 5

    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'

      - run: pnpm install --frozen-lockfile
      - run: pnpm prisma generate

      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test:unit

      - name: Migrate test DB
        run: pnpm prisma migrate deploy
        env:
          DATABASE_URL: postgresql://focusflow:focusflow@localhost:5432/focusflow_test

      - name: Run integration tests
        run: pnpm test:integration
        env:
          DATABASE_URL: postgresql://focusflow:focusflow@localhost:5432/focusflow_test
          REDIS_URL: redis://localhost:6379
          TOKEN_ENCRYPTION_KEY: ${{ secrets.TOKEN_ENCRYPTION_KEY_TEST }}
```

`TOKEN_ENCRYPTION_KEY_TEST` se setea en repo secrets — instrucciones en pending-external-setup.md.

Verificación local: `act` (GitHub Actions runner local) si está instalado, o simplemente confiar y validar tras el push.

### Commit 5 — `feat(branding): logo SVG inline + favicon + Open Graph meta tags`

Crear `src/app/icon.svg` (Next.js convention para favicon):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <!-- Diseño minimalista: círculo + flecha o similar. 
       Claude Code: hacer un diseño simple y reconocible.
       Inspiración: rayo, sol, foco, brújula, cualquier glyph que diga 
       "morning briefing / clarity / focus". -->
  <circle cx="50" cy="50" r="45" fill="#0f172a"/>
  <path d="M30 50 L50 30 L70 50 L50 70 Z" fill="#fbbf24"/>
</svg>
```

(Diseño exacto a discreción de Claude Code; lo importante es que sea SVG válido, distintivo, y los colores armonicen con el tema dark del Next.js).

Modificar `src/app/layout.tsx`:

```tsx
export const metadata: Metadata = {
  title: 'FocusFlow — Tu briefing matutino con IA',
  description: 'Cada mañana recibes un email con resumen de tu inbox de Gmail generado por IA. Empieza el día sabiendo qué importa.',
  openGraph: {
    title: 'FocusFlow',
    description: 'Tu briefing matutino con IA',
    url: process.env.APP_URL,
    siteName: 'FocusFlow',
    locale: 'es_ES',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'FocusFlow',
    description: 'Tu briefing matutino con IA',
  },
}
```

Verificar con `<link rel="icon" href="/icon.svg" />` no se rompa en runtime.

### Commit 6 — `chore(deploy): config Railway + Procfile + healthcheck + variables`

Crear `railway.json` (config de build/deploy):

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": { "builder": "NIXPACKS" },
  "deploy": {
    "healthcheckPath": "/api/health",
    "healthcheckTimeout": 100,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

Crear `Procfile` (Railway lee dos procesos):

```
web: pnpm start
worker: pnpm worker:start
```

Modificar `package.json` scripts:
- `"build": "prisma migrate deploy && next build"` (correr migrations al deploy).
- `"start": "next start -p ${PORT:-3030}"` (Railway inyecta `PORT`).

Crear `docs/deploy.md` con:
- Cómo crear proyecto Railway, attach Postgres+Redis, link GitHub repo.
- Lista exacta de env vars a configurar en Railway dashboard.
- Cómo verificar el primer deploy.
- Cómo añadir custom domain con DNS.

(Detalles concretos lo más prescriptivos posible para que el developer los siga sin pensar — esto va al `pending-external-setup.md` también).

### Commit 7 — `docs(readme): sección Deploy + badge CI + URL pública placeholder`

Modificar `README.md`:

- Añadir `[![CI](https://github.com/eap59-ua/focusflow/actions/workflows/ci.yml/badge.svg)](https://github.com/eap59-ua/focusflow/actions/workflows/ci.yml)` arriba.
- Sección "Live demo" con placeholder `https://focusflow.example.com` (developer reemplaza tras deploy).
- Sección "Deploy" remitiendo a `docs/deploy.md`.

### Commit 8 — `docs(setup): instrucciones consolidadas Sentry + Railway + GitHub Actions secrets`

Modificar `docs/pending-external-setup.md`. Añadir sección "Paso 8 — Deploy" con todos los pasos manuales:

```markdown
## Paso 8 — Deploy a producción

### 🛑 Sentry account
1. https://sentry.io/signup → New project → Next.js.
2. Copiar DSN del proyecto creado.
3. Añadir a Railway variables como `SENTRY_DSN`.

### 🛑 Railway account + project
1. https://railway.app/new → "Deploy from GitHub repo" → seleccionar `eap59-ua/focusflow`.
2. Railway detecta `railway.json` y `Procfile` automáticamente.
3. **+ New → Database → Add PostgreSQL.** Railway expone `DATABASE_URL` en variables del servicio web automáticamente vía referencia.
4. **+ New → Database → Add Redis.** Mismo, expone `REDIS_URL`.
5. En el servicio web, añadir variables (Settings → Variables):
   - `TOKEN_ENCRYPTION_KEY` (generar nueva con `node -e "..."`, **distinta** de la de dev).
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (mismas creds del Paso 3 — es el mismo OAuth client si solo hay un test user, sino crear otro client en Google Cloud para prod).
   - `GOOGLE_OAUTH_REDIRECT_URI=https://<tu-dominio>/settings/gmail/callback` — clave: usar dominio prod, no localhost.
   - `OPENAI_API_KEY` (mismo del .env local).
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME` — para prod: usar Resend (free tier 100 emails/día) o Mailgun. Detalles en sub-sección abajo.
   - `SENTRY_DSN`, `SENTRY_ENVIRONMENT=production`.
   - `APP_URL=https://<tu-dominio>`.
   - `SCHEDULER_ENABLED=true`.
6. Después de añadir variables, Railway redeploy automático.
7. Esperar ~2 min, ver logs del servicio web hasta "Ready on port XXXX".

### 🛑 SMTP provider para prod
Resend (recomendado):
1. https://resend.com/signup → API key → copiar.
2. Verificar dominio (DNS records — Resend lo guía).
3. En Railway: `SMTP_HOST=smtp.resend.com`, `SMTP_PORT=465`, `SMTP_SECURE=true`, `SMTP_USER=resend`, `SMTP_PASS=<api key>`, `EMAIL_FROM_ADDRESS=focusflow@tu-dominio.com`.

### 🛑 Custom dominio
1. Comprar en Namecheap/Porkbun (~$12/año). Sugerencias: `.app`, `.io`, `.com`.
2. En Railway: Settings del servicio web → Custom Domain → añadir tu dominio.
3. Railway te da un CNAME target. En tu registrar de dominio: añadir CNAME `@` → ese target. (Si tu registrar no soporta CNAME en `@`, usar `www` y poner redirect 301 desde apex.)
4. Esperar propagación DNS (~5-30 min).
5. Railway emite cert TLS automático vía Let's Encrypt.

### 🛑 Google Cloud OAuth para producción
1. APIs & Services → Credentials → editar el OAuth 2.0 Client ID existente.
2. Añadir Authorized redirect URIs: `https://<tu-dominio>/settings/gmail/callback`.
3. (No quitar el localhost — sigue siendo válido para dev.)
4. OAuth consent screen: añadir App Domain con tu dominio prod, links a privacy policy y terms (placeholder OK para Testing mode).

### 🛑 GitHub Actions secrets
1. Repo → Settings → Secrets and variables → Actions → New repository secret.
2. `TOKEN_ENCRYPTION_KEY_TEST` — cualquier 64 hex chars (NO la de prod). Usado solo en CI para tests integration.

### Smoke deploy
1. Push a main → Railway redeploya automático.
2. Visitar `https://<tu-dominio>/api/health` → debe responder 200.
3. Registrarse, conectar Gmail (con redirect URI prod ya en Google), trigger briefing manual.
4. Email llega vía Resend.
5. Ver dashboard Sentry para ningún error nuevo.

Si todo pasa: **MVP en producción**.
```

### Commit 9 — `chore(release): tag v0.1.0 y actualizar roadmap a estado finalizado`

- `git tag v0.1.0 -m "MVP code-complete: Morning Briefing end-to-end"` (el push del tag lo hace el developer).
- Modificar `docs/plan/00-roadmap.md` marcando todas las fases ✅ con métricas finales.
- Modificar `README.md` con un bloque "What's next post-MVP" con ideas no scope-MVP (Calendar connector, dashboard de histórico, multi-tenant) — solo como teaser, no compromisos.

## Criterios de aceptación

- [ ] 9 commits atómicos sobre `feat/08-deploy-hardening`, gate verde en cada uno.
- [ ] `pnpm test:unit` sigue verde con tests añadidos para los fixes (esperado ≥195).
- [ ] `pnpm test:integration` verde con servicios docker.
- [ ] `pnpm verify:zero-retention` verifica las TTLs de BullMQ.
- [ ] `.github/workflows/ci.yml` válido (sintaxis OK con `act --list` si está instalado, o simplemente revisar visualmente).
- [ ] `railway.json`, `Procfile` válidos.
- [ ] `next.config.ts` con `withSentryConfig` funcional (no rompe `pnpm build`).
- [ ] `pnpm build` exit 0 (compilación de prod limpia).
- [ ] `README.md` con badge CI y referencias a `docs/deploy.md`.
- [ ] `docs/pending-external-setup.md` con la sección "Paso 8 — Deploy" completa.
- [ ] El plan respeta "no nuevas features" — los commits son fixes + observability + CI + branding + deploy config, no funcionalidad nueva.

## Desviaciones aceptables sin preguntar

- Diseño concreto del logo SVG (a gusto de Claude Code, dentro de simplicidad).
- Valores exactos de `tracesSampleRate` en Sentry si Claude Code prefiere otros.
- Elección de versión de actions de GitHub si las que listo están deprecadas.
- Redacción del fallback de S4 si Claude Code lo expresa mejor.
- Añadir un `.dockerignore` o `.railwayignore` si optimiza build.

## Desviaciones que requieren parar y reportar

- Cambiar de Railway a otro provider — la decisión está tomada.
- Cambiar de Sentry a otro tracker — decisión tomada.
- Saltarse el commit de S1 — es la única decisión arquitectónica de este paso.
- Encontrar que Sentry SDK necesita config muy diferente al patrón estándar.
- Encontrar que Railway requiere setup que rompe el patrón Procfile (ej. obliga a Dockerfile custom).
- `pnpm build` falla por config de Sentry o Next.js en producción.
- Cualquier librería extra no autorizada.

## Al terminar

Reporte estándar final:
- Tabla commits + métricas.
- Confirmación de todos los criterios de aceptación.
- Lista exacta de pasos manuales pendientes (compactada en `pending-external-setup.md`).
- Estado total del MVP: número de commits totales, número de tests, fases ejecutadas.

**Tras 8:** todo el código está hecho. Lo único que queda es tu deploy real (cuentas + dominio + Sentry + Railway), que está documentado paso a paso. El MVP estará en URL pública en ~2 horas de trabajo manual tuyo.
