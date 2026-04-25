# Setup externo pendiente

Este archivo lista TODA la configuración que vive **fuera del repo** (consolas web, dashboards de proveedores, secretos en `.env`) que el MVP necesita en algún momento, agrupada por fase. La idea es tener una sola fuente de verdad para revisar al volver al proyecto: qué está hecho, qué bloquea qué, y qué cuentas hay que crear.

Convención de estado:

- ✅ — hecho.
- ⏸️ — pendiente, no bloquea el código actual (se puede commitear sin esto).
- 🛑 — pendiente, **bloquea** el smoke manual o el dev server end-to-end.

El código se construye con dummies/mocks contra los puertos. Estos elementos solo bloquean ejecuciones reales (smoke manual, dev server con flujo completo, deploy).

---

## Paso 3 — OAuth Gmail (en curso)

### 🛑 Google Cloud Console

Bloquea: el smoke manual (paso 10 del plan `03-oauth-gmail.md`) y poder probar el flujo OAuth desde `pnpm dev`. **No bloquea** el código ni los tests (los tests usan `FakeOAuthClient` por puerto).

Pasos a ejecutar en https://console.cloud.google.com con tu cuenta Google:

1. **Proyecto**: selector arriba a la izquierda → "Nuevo proyecto" → nombre `focusflow` → Create. Espera ~20 s y selecciónalo.
2. **Habilitar Gmail API**: ☰ → APIs & Services → Library → buscar `Gmail API` → Enable.
3. **OAuth consent screen**: ☰ → APIs & Services → OAuth consent screen.
   - User Type: **External** → Create.
   - App name: `FocusFlow (Dev)`. User support email: tu Gmail. App logo: vacío.
   - App domain: todo vacío.
   - Developer contact: tu Gmail. → Save and Continue.
   - Scopes → Add or Remove Scopes:
     - `https://www.googleapis.com/auth/gmail.readonly`
     - `openid`
     - `https://www.googleapis.com/auth/userinfo.email`
   - Update → Save and Continue.
   - Test users → Add Users → tu Gmail (la cuenta desde la que vas a conectar) → Save and Continue → Back to Dashboard.
4. **OAuth 2.0 Client ID**: ☰ → APIs & Services → Credentials → Create Credentials → OAuth client ID.
   - Application type: **Web application**.
   - Name: `FocusFlow Local Dev`.
   - Authorized JavaScript origins: vacío.
   - Authorized redirect URIs → Add URI → `http://localhost:3030/settings/gmail/callback` (exacto, sin slash final).
   - Create. Copia **Client ID** y **Client Secret** del modal (el secret solo se muestra una vez; si lo pierdes regeneras desde el botón ↻ de la fila correspondiente).

### 🛑 Variables en `.env`

Tras tener Client ID y Secret, abrir `.env` y rellenar las dos líneas vacías:

```
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."
```

Las otras dos ya están:

- ✅ `GOOGLE_OAUTH_REDIRECT_URI="http://localhost:3030/settings/gmail/callback"`
- ✅ `TOKEN_ENCRYPTION_KEY="<64 hex chars>"`

### Aviso sobre `TOKEN_ENCRYPTION_KEY`

Esta clave cifra **todos** los tokens OAuth en DB. Si se pierde o se cambia, los tokens existentes son indescifrables.

- En dev: `TRUNCATE TABLE gmail_integrations` y reconectar Gmail.
- En prod (Paso 8): forzar a todos los usuarios a reconectar.

Guardarla en un gestor de contraseñas antes del deploy del Paso 8.

### Smoke manual del Paso 3 (10 pasos, ~30 s)

Cuando los 9 commits estén hechos y `.env` tenga las 4 variables:

1. `pnpm dev` corriendo, registrarse o loguearse en `http://localhost:3030/login`.
2. `http://localhost:3030/settings` → "Gmail no conectado" + botón "Conectar".
3. Click "Conectar Gmail" → redirige a Google.
4. Login con la cuenta Google añadida como test user.
5. Aprobar scopes.
6. Google redirige a `/settings/gmail/callback?code=...&state=...` → app procesa → `/settings?connected=1`.
7. Flash "Gmail conectado correctamente" + email.
8. Verificar tokens cifrados en DB (psql / DBeaver):
   ```sql
   SELECT
     "googleAccountEmail",
     LEFT("accessTokenEncrypted", 20) AS access_first20,
     LENGTH("accessTokenEncrypted")    AS access_len,
     "tokenExpiresAt"
   FROM gmail_integrations;
   ```
   `access_first20` debe ser base64 random (NO empezar por `ya29.` ni `Bearer`); `access_len` >100.
9. Click "Desconectar" → flash de éxito, row desaparece.
10. Repetir paso 3: debe poder reconectar (`prompt: 'consent'` garantiza consent fresco).

---

## Paso 5 — Generación con OpenAI (futuro)

### ⏸️ OpenAI API key

Bloquea: el job `generate-briefing` real, no el código ni tests (mocks vía `BriefingGeneratorPort`).

1. https://platform.openai.com/api-keys → Create new secret key → copiar.
2. Establecer límite de gasto en https://platform.openai.com/account/limits (recomendado: $5–10/mes en dev).
3. Añadir a `.env`:
   ```
   OPENAI_API_KEY="sk-..."
   ```
4. Decisión pendiente: modelo (`gpt-4o-mini` por coste vs `gpt-4o` por calidad). Se decide en el plan `05-openai-briefing.md` cuando se escriba.

---

## Paso 6 — Envío de email diario (futuro)

### ⏸️ Provider SMTP / API de email

Bloquea: el job `send-briefing-email` end-to-end, no el código ni tests.

**En dev**: Mailhog ya está previsto en docker-compose (añadir si no está al llegar al Paso 6). Captura emails localmente, no envía nada real.

**En prod (Paso 8)**: elegir entre:

- **Resend** (https://resend.com) — recomendado: SDK simple, free tier 100 emails/día, 3000/mes. Verificar dominio (DNS records).
- **AWS SES** — más barato a escala, pero setup más pesado (sandbox mode, verificación, etc.).
- **SMTP genérico** — Mailgun, Postmark, etc.

Variables a definir en `.env` (según provider):

```
EMAIL_FROM="FocusFlow <no-reply@tu-dominio.com>"
RESEND_API_KEY="..."          # opción A
SMTP_URL="smtp://..."         # opción B (Nodemailer)
```

Decisión a tomar antes del Paso 6.

---

## Paso 8 — Hardening + deploy (futuro)

### ⏸️ Hosting

Decisión pendiente entre:

- **Vercel** (recomendado para Next.js): free tier generoso para proyectos personales, deploy automático desde GitHub. Postgres y Redis no incluidos — usar Neon (Postgres) y Upstash (Redis).
- **Railway**: incluye Postgres y Redis, $5/mes mínimo. Deploy más simple.

Variables y secrets en el panel del hosting:

- Todas las del `.env` (sin commitear nunca).
- `DATABASE_URL` apuntando al Postgres de prod.
- `REDIS_URL` apuntando al Redis de prod.
- `NEXTAUTH_URL` o equivalente con el dominio público.

### ⏸️ Dominio

Decidir si usar subdominio gratuito del hosting (`focusflow.vercel.app`) o registrar un dominio personalizado. Si custom: configurar DNS.

### ⏸️ Sentry (error tracking)

1. https://sentry.io → New project → Next.js.
2. Copiar DSN → `.env`:
   ```
   SENTRY_DSN="https://...@sentry.io/..."
   ```
3. Instalar `@sentry/nextjs` (parar y preguntar antes de instalar — librería nueva).

### ⏸️ GitHub Actions secrets

En `Settings → Secrets and variables → Actions` del repo:

- `DATABASE_URL` (DB de tests CI o staging).
- `OPENAI_API_KEY` (si el CI corre tests que la necesitan, lo cual NO debería ser el caso si los tests están bien mockeados).
- Cualquier otro secreto que el deploy automático necesite.

### ⏸️ Cuenta Google Cloud — modo producción

Para el smoke real con usuarios fuera de la lista de test users:

1. OAuth consent screen → Publish app (sale del modo "Testing").
2. Si pides scopes sensibles (`gmail.readonly` lo es), Google exige verificación de la app: documentos de privacy policy, terms of service, video del flujo, justificación de uso. Proceso de 4-6 semanas.
3. Para uso estrictamente personal del developer (yo mismo como único usuario), basta con quedarse en modo "Testing" con un test user — no hace falta verificación.

Decisión a tomar en Paso 8 según si el MVP se abre a más usuarios.

---

## Resumen de variables en `.env`

Estado actual del `.env` local (no commiteado):

| Variable | Estado | Bloquea |
|---|---|---|
| `DATABASE_URL` | ✅ | — |
| `REDIS_URL` | ✅ | — |
| `SESSION_COOKIE_NAME` | ✅ | — |
| `SESSION_LIFETIME_DAYS` | ✅ | — |
| `JWT_SECRET` | ⚠️ valor placeholder pero no se usa todavía | — |
| `TOKEN_ENCRYPTION_KEY` | ✅ | — |
| `GOOGLE_CLIENT_ID` | 🛑 vacío | smoke manual Paso 3 |
| `GOOGLE_CLIENT_SECRET` | 🛑 vacío | smoke manual Paso 3 |
| `GOOGLE_OAUTH_REDIRECT_URI` | ✅ | — |
| `OPENAI_API_KEY` | ⏸️ vacío | smoke manual Paso 5 |
| `EMAIL_FROM` | ✅ default | — |
| `SMTP_URL` / `RESEND_API_KEY` | ⏸️ vacío | smoke manual Paso 6 |

Para futuro Claude Code: mientras `🛑` esté presente, el smoke manual del paso correspondiente no se puede ejecutar, pero el código sí se puede construir, testear y commitear. Reportar al final del paso qué smoke quedó pendiente y por qué.
