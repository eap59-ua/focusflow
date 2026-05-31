# Deploy de FocusFlow (Railway)

Guía técnica del despliegue. Para el checklist de cuentas/credenciales paso a
paso ver [`docs/pending-external-setup.md`](pending-external-setup.md) §"Paso 8".

## Arquitectura del deploy

Railway all-in-one, un solo proyecto con cuatro piezas:

| Pieza | Qué es | Cómo se crea |
|---|---|---|
| **web** | Next.js (`next start`) — sirve la app + tRPC + `/api/health` | Servicio desde el repo GitHub |
| **worker** | Proceso BullMQ (`tsx src/workers/start.ts`) — cron + flow del briefing | 2º servicio desde el MISMO repo, start command `pnpm worker:start` |
| **Postgres** | BD | Plugin Railway (Add PostgreSQL) |
| **Redis** | Colas BullMQ + OAuth state | Plugin Railway (Add Redis) |

`railway.json` fija builder NIXPACKS, healthcheck en `/api/health` (timeout
100s) y restart `ON_FAILURE` (máx 3 reintentos).

`Procfile` define los dos procesos:

```
web: pnpm db:deploy && pnpm start
worker: pnpm worker:start
```

## Por qué las migraciones corren al arrancar (no en build)

`web` ejecuta `pnpm db:deploy` (`prisma migrate deploy`) **antes** de `next
start`. Es deliberado: el build phase de Railway/Nixpacks **no tiene red privada
hacia el Postgres** (sólo runtime), así que migrar en `build` fallaría. Migrar al
arrancar el proceso web es idempotente y se ejecuta cuando la BD ya es
alcanzable. Por eso el script `build` se queda en `next build` a secas.

## El worker necesita `tsx` en runtime

`pnpm worker:start` ejecuta TypeScript directo vía `tsx` (una devDependency).
Nixpacks instala devDependencies por defecto, así que funciona sin tocar nada.
⚠️ **No configures el servicio worker para prunear devDependencies** (ej.
`NODE_ENV=production` con `pnpm install --prod`) o el worker no arrancará.

## Paso a paso

### 1. Crear el proyecto y el servicio web

1. https://railway.app/new → **Deploy from GitHub repo** → `eap59-ua/focusflow`.
2. Railway detecta `railway.json` + `Procfile` y configura el servicio `web`.

### 2. Añadir Postgres y Redis

3. **+ New → Database → Add PostgreSQL.** Railway expone `DATABASE_URL` y lo
   referencia automáticamente desde el servicio web.
4. **+ New → Database → Add Redis.** Expone `REDIS_URL`.

### 3. Variables de entorno (servicio web)

Settings → Variables. Postgres/Redis ya inyectan sus URLs; añade el resto:

| Var | Valor |
|---|---|
| `TOKEN_ENCRYPTION_KEY` | 64 hex nuevos (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`), **distinto** de dev |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | del OAuth client (Paso 3) |
| `GOOGLE_OAUTH_REDIRECT_URI` | `https://<tu-dominio>/settings/gmail/callback` |
| `OPENAI_API_KEY` | el mismo de local |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` | provider prod (Resend recomendado) |
| `EMAIL_FROM_ADDRESS` / `EMAIL_FROM_NAME` | remitente verificado |
| `SENTRY_DSN` | DSN del proyecto Sentry |
| `SENTRY_ENVIRONMENT` | `production` |
| `APP_URL` | `https://<tu-dominio>` |
| `SCHEDULER_ENABLED` | `true` |

### 4. Crear el servicio worker

5. **+ New → GitHub Repo → mismo repo.** En ese servicio: Settings → Deploy →
   Custom Start Command = `pnpm worker:start`.
6. Copia las MISMAS variables de entorno que el web (puedes referenciar las del
   Postgres/Redis del proyecto). El worker no necesita `APP_URL` ni healthcheck.

### 5. Custom domain

7. Servicio web → Settings → Networking → Custom Domain → tu dominio.
8. Railway te da un CNAME target. En tu registrar: CNAME `@` (o `www` + redirect
   301 desde apex si el registrar no soporta CNAME en apex) → ese target.
9. Espera propagación DNS (~5-30 min). Railway emite cert TLS (Let's Encrypt)
   automático.

### 6. Verificar el primer deploy

10. Cada push a `main` → Railway redeploya automático.
11. `https://<tu-dominio>/api/health` → debe responder 200.
12. Registro → conectar Gmail (con el redirect URI prod ya en Google Cloud) →
    trigger manual del briefing → el email llega vía el SMTP prod.
13. Dashboard de Sentry: sin errores nuevos.

Si todo pasa: **MVP en producción**.

## Notas

- Migraciones destructivas: revisar a mano antes de pushear (ver `CLAUDE.md`).
- El healthcheck `/api/health` no toca BD ni Redis, así que responde aunque la
  primera migración esté en curso; Railway espera hasta 100s.
- Logs: visibles en el dashboard de Railway por servicio (JSON estructurado).
