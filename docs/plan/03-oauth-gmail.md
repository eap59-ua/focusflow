# Paso 3 — OAuth Gmail + encriptación de tokens en reposo

Tercera fase del MVP. Construye el flujo OAuth 2.0 con Google para conectar la cuenta Gmail del usuario, con encriptación AES-256-GCM de access/refresh tokens en reposo (regla no negociable del `CLAUDE.md`: "No guardar tokens OAuth en texto plano").

**Dependencia de entrada:** Paso 2 mergeado en `main`. Usuario autenticado con sesión activa (cookie `focusflow.session`). Middleware `requireUser` disponible.

**Dependencia de salida:** desbloquea el Paso 4 (ingesta de emails), que usa los tokens persistidos para llamar a Gmail API.

## Pre-requisitos verificables antes de arrancar

1. `git checkout main && git pull` — main actualizado tras merge del PR de Paso 2.
2. `docker compose ps` — `postgres` y `redis` en estado `running`.
3. `pnpm test:unit && pnpm test:integration` verdes contra `main`.
4. **Variables de entorno nuevas en `.env` local del usuario** (ya creadas manualmente antes de arrancar este plan):
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3030/settings/gmail/callback`
   - `TOKEN_ENCRYPTION_KEY` (64 caracteres hex = 32 bytes aleatorios)
5. Google Cloud Console ya configurado por el usuario: proyecto creado, Gmail API habilitada, OAuth consent screen con scope `gmail.readonly` y test user, OAuth 2.0 Client ID con redirect URI registrado.

**Si cualquier pre-requisito falla, parar y reportar.** No intentar ejecutar commits que dependan de tokens hasta confirmar que las env vars están cargadas.

## Branch y convenciones

- Crear `feat/03-oauth-gmail` desde `main`.
- Commits en español, Conventional Commits. Gate verde (`pnpm typecheck && pnpm lint && pnpm test:unit`) en cada commit.
- Commits por unidad lógica cerrada. Ningún RED/GREEN split.

## Deps pre-autorizadas

Añadir en el commit 6 (primer commit que las usa):

```bash
pnpm add google-auth-library@^9
```

**NO añadir:**
- `@types/google-auth-library`: el paquete trae sus propios tipos.
- `googleapis`: se reserva para Paso 4 (fetch de emails); en Paso 3 solo hacemos OAuth.
- `nock`, `msw`, ni cualquier librería de mock HTTP: los tests usan fakes inyectados por puerto, no interceptores de red.
- Cualquier librería de encriptación adicional (`bcrypt` ya está, pero es para passwords; para tokens usamos `node:crypto` nativo, AES-256-GCM).

Cualquier otra librería, **parar y preguntar** antes de instalar.

## Variables de entorno

Añadir al `.env.example` **con placeholders** (este archivo sí se commitea):

```
# Google OAuth (obtener en https://console.cloud.google.com → Credentials → OAuth 2.0 Client ID)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3030/settings/gmail/callback

# Encriptación de tokens OAuth en reposo. 32 bytes hex = 64 chars. Generar con:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
TOKEN_ENCRYPTION_KEY=
```

El `.env` real del usuario ya tiene los valores concretos (responsabilidad humana, documentada en `docs/plan/03-oauth-gmail.md` y en este roadmap). Validación runtime: si `TOKEN_ENCRYPTION_KEY` no tiene exactamente 64 chars hex al arrancar, lanzar error al cablar el container (fail-fast en vez de fallar en el primer encrypt).

## Modelo de datos

Añadir a `schema.prisma`:

```prisma
model GmailIntegration {
  id                    String   @id @default(uuid())
  userId                String   @unique
  user                  User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  googleAccountEmail    String
  accessTokenEncrypted  String   @db.Text
  refreshTokenEncrypted String   @db.Text
  scope                 String
  tokenExpiresAt        DateTime
  connectedAt           DateTime @default(now())
  lastRefreshedAt       DateTime @default(now())

  @@map("gmail_integrations")
}
```

Relación inversa en `User`:

```prisma
gmailIntegration GmailIntegration?
```

Decisión MVP: relación 1:1 por usuario. Si post-MVP queremos múltiples cuentas Gmail por usuario, migramos a 1:N (no breaking).

Migración: `pnpm prisma migrate dev --name add_gmail_integration`.

## Arquitectura OAuth state

El parámetro `state` de OAuth 2.0 protege contra CSRF en el callback. Almacenado en **Redis** (no Postgres) porque:
- Es efímero (TTL ~10 min).
- Ya tenemos Redis corriendo para BullMQ; no hace falta migración.
- Expiración automática via `EXPIRE`, sin job de limpieza.

Formato de clave Redis: `oauth:gmail:state:<state_hex>` → valor: `userId`. TTL: 600 segundos.

## Commits (9 commits, por unidad lógica)

### Commit 1 — `chore(prisma): añadir modelo GmailIntegration y migración`

- Editar `schema.prisma` con el modelo + relación inversa en `User`.
- `pnpm prisma migrate dev --name add_gmail_integration`.
- Commitear migración + schema.
- Actualizar `.env.example` con los placeholders de las 4 variables nuevas.
- **Gate verde** (typecheck + lint + test:unit, los tests existentes no se tocan).

### Commit 2 — `feat(domain): EncryptedToken VO + GmailIntegration entity + errores`

En `src/domain/gmail-integration/`:

- `EncryptedToken.ts` — VO opaco. Envuelve un string base64. Expone `.toBase64()` para serializar, no `.toString()` (evita logs accidentales). Factory `EncryptedToken.fromBase64(s)` valida que sea base64.
- `GmailIntegration.ts` — entidad con: `id`, `userId`, `googleAccountEmail`, `accessToken: EncryptedToken`, `refreshToken: EncryptedToken`, `scope: string`, `tokenExpiresAt: Date`, `connectedAt: Date`, `lastRefreshedAt: Date`. Métodos: `create({ ... })` factory, `restore({ ... })` reconstitución desde DB, `isAccessTokenExpired(now: Date, skewSeconds = 30)`, `withRefreshedAccessToken({ accessToken, tokenExpiresAt, now })` (devuelve nueva instancia, inmutable).
- `errors/GmailIntegrationNotFoundError.ts`, `errors/InvalidEncryptedTokenError.ts`, `errors/TokenDecryptionFailedError.ts` — todos extienden `DomainError`.

Tests unitarios cubren:
- `EncryptedToken.fromBase64` rechaza strings no-base64.
- `GmailIntegration.create` acepta inputs válidos y fija defaults.
- `GmailIntegration.restore` reconstituye sin disparar invariantes.
- `isAccessTokenExpired` con skew (token "no-expirado" si expira dentro de <30s se considera expirado por seguridad).
- `withRefreshedAccessToken` es inmutable (retorna nueva instancia, no muta).

### Commit 3 — `feat(application): BeginGmailConnection + CompleteGmailConnection use cases`

En `src/application/use-cases/gmail/`:

- `BeginGmailConnection.ts`:
  - Input: `{ userId: string }`.
  - Puertos: `OAuthStateStorePort.save(state, userId, ttlSeconds)`, `OAuthClientPort.generateAuthUrl(state, scopes)`.
  - Genera `state = crypto.randomBytes(32).toString('hex')`.
  - Guarda en state store con TTL 600s.
  - Retorna `{ authorizeUrl: string }`.

- `CompleteGmailConnection.ts`:
  - Input: `{ userId: string, code: string, state: string }`.
  - Puertos: `OAuthStateStorePort.consume(state)`, `OAuthClientPort.exchangeCode(code)`, `TokenEncryptionPort.encrypt(plaintext)`, `GmailIntegrationRepositoryPort.save(integration)`.
  - Flujo:
    1. `consume(state)` — atómico (get + delete). Si no existe → `OAuthStateMismatchError`.
    2. Si `consume` devuelve un userId distinto al input → `OAuthStateMismatchError` (la sesión cambió).
    3. `exchangeCode(code)` → `{ accessToken, refreshToken, expiresInSeconds, scope, googleAccountEmail }`.
    4. Encriptar access y refresh tokens.
    5. Construir `GmailIntegration.create(...)` y persistir.
  - Retorna `{ integration: GmailIntegration }`.

Nuevos puertos en `src/application/ports/`:

```ts
// OAuthStateStorePort.ts
export interface OAuthStateStorePort {
  save(state: string, userId: string, ttlSeconds: number): Promise<void>
  consume(state: string): Promise<{ userId: string } | null>
}

// OAuthClientPort.ts
export interface OAuthExchangeResult {
  accessToken: string
  refreshToken: string
  expiresInSeconds: number
  scope: string
  googleAccountEmail: string
}
export interface OAuthClientPort {
  generateAuthUrl(state: string, scopes: string[]): string
  exchangeCode(code: string): Promise<OAuthExchangeResult>
  refreshAccessToken(refreshToken: string): Promise<Omit<OAuthExchangeResult, 'refreshToken' | 'scope' | 'googleAccountEmail'>>
}

// TokenEncryptionPort.ts
export interface TokenEncryptionPort {
  encrypt(plaintext: string): Promise<string>  // retorna base64
  decrypt(ciphertextBase64: string): Promise<string>
}

// GmailIntegrationRepositoryPort.ts
export interface GmailIntegrationRepositoryPort {
  save(integration: GmailIntegration): Promise<void>
  findByUserId(userId: string): Promise<GmailIntegration | null>
  deleteByUserId(userId: string): Promise<void>
}
```

**Nuevo error de dominio**: `OAuthStateMismatchError` (análogo a `InvalidCredentialsError` — intencionalmente no distingue "no existe" vs "no coincide" para no filtrar info a atacantes).

Tests unitarios mockeando los 4 puertos. Cubrir happy path + 4 fallos (state no existe, state pertenece a otro user, exchangeCode falla, save falla). Verificar que los tokens pasan por encrypt **antes** de save.

### Commit 4 — `feat(application): RefreshGmailToken + DisconnectGmail use cases`

En `src/application/use-cases/gmail/`:

- `RefreshGmailToken.ts`:
  - Input: `{ userId: string }`.
  - Puertos: `GmailIntegrationRepositoryPort.findByUserId` + `.save`, `TokenEncryptionPort.decrypt/encrypt`, `OAuthClientPort.refreshAccessToken`.
  - Flujo: cargar integración → decrypt refresh token → llamar Google refresh → encrypt nuevo access token → `integration.withRefreshedAccessToken(...)` → save.
  - Si no existe integración → `GmailIntegrationNotFoundError`.

- `DisconnectGmail.ts`:
  - Input: `{ userId: string }`.
  - Puerto: `GmailIntegrationRepositoryPort.deleteByUserId`.
  - Idempotente (no falla si no hay integración).

Tests unitarios cubren:
- Refresh happy path: llama Google, encripta, persiste.
- Refresh sin integración → error tipado.
- Refresh cuando Google devuelve error → propaga el error, no corrompe la DB.
- Disconnect con integración → borra.
- Disconnect sin integración → no-op, no error.

### Commit 5 — `feat(infra): AesGcmTokenEncryption adapter`

En `src/infrastructure/security/AesGcmTokenEncryption.ts`:

- Implementa `TokenEncryptionPort`.
- Lee `TOKEN_ENCRYPTION_KEY` del entorno en el constructor; valida 64 chars hex, si no → throw en arranque (fail-fast).
- `encrypt(plaintext)`:
  1. Generar `iv = crypto.randomBytes(12)` (IV fresco por encrypt).
  2. `cipher = crypto.createCipheriv('aes-256-gcm', key, iv)`.
  3. `encrypted = cipher.update(plaintext, 'utf8') + cipher.final()`.
  4. `authTag = cipher.getAuthTag()`.
  5. Devolver `base64(iv || authTag || encrypted)` — 12B + 16B + N bytes.
- `decrypt(ciphertextBase64)`:
  1. Decodificar base64.
  2. Separar iv (12B), authTag (16B), ciphertext (resto).
  3. `decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)`.
  4. `decipher.setAuthTag(authTag)`.
  5. `plaintext = decipher.update(ciphertext) + decipher.final('utf8')`.
  6. Si tampering detectado por GCM → throw → el caller mapea a `TokenDecryptionFailedError`.

Tests unitarios (no necesitan DB ni Redis):
- Round-trip: `encrypt(x)` seguido de `decrypt(resultado)` === `x`.
- IVs distintos para encrypts del mismo plaintext (no determinista).
- Tampering detectado: modificar 1 byte del ciphertext → decrypt throws.
- Key incorrecta en construct → throw inmediato.

### Commit 6 — `feat(infra): GoogleOAuthClient + RedisOAuthStateStore + PrismaGmailIntegrationRepository`

En `src/infrastructure/adapters/`:

- `GoogleOAuthClient.ts` implementa `OAuthClientPort` usando `google-auth-library`:
  - Constructor recibe `{ clientId, clientSecret, redirectUri }`.
  - `generateAuthUrl(state, scopes)`: usa `OAuth2Client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope, state, include_granted_scopes: true })`. `prompt: 'consent'` fuerza que Google devuelva `refresh_token` siempre (crítico para el refresh de Paso 4).
  - `exchangeCode(code)`: `oauth2Client.getToken(code)` → mapear a `OAuthExchangeResult`. Obtener `googleAccountEmail` haciendo `oauth2Client.getTokenInfo(access_token)` o decodificando el `id_token` si incluye `openid email` (añadir esos scopes al consent). Decisión: añadir `openid email` al scope array para obtener email fácil.
  - `refreshAccessToken(refreshToken)`: usar método `oauth2Client.refreshAccessToken()` de la librería.

- `RedisOAuthStateStore.ts` implementa `OAuthStateStorePort`:
  - Constructor recibe instancia de `ioredis`.
  - `save(state, userId, ttl)`: `redis.set('oauth:gmail:state:' + state, userId, 'EX', ttl)`.
  - `consume(state)`: script Lua atómico (GET + DEL). Devuelve `{ userId }` si existía, `null` si no.

- `PrismaGmailIntegrationRepository.ts` implementa `GmailIntegrationRepositoryPort`:
  - `save(integration)`: `upsert` por `userId` (único). Serializar `EncryptedToken` con `.toBase64()`.
  - `findByUserId(userId)`: si existe row → `GmailIntegration.restore({ accessToken: EncryptedToken.fromBase64(...), refreshToken: ... })`.
  - `deleteByUserId(userId)`: `deleteMany({ where: { userId } })` (compatible con "no existe").

Cablear los 3 adapters en `src/infrastructure/container.ts` junto a los existentes. Instalar `google-auth-library`.

Sin unit tests directos para los adapters (se cubren en integration). Sí validar con typecheck + lint.

### Commit 7 — `feat(presentation): rutas /settings/gmail/connect, /callback y página /settings`

- `src/app/settings/page.tsx` (Server Component, protegida — redirect a `/login` si no sesión):
  - Muestra estado actual: "Gmail conectado: `<email>`" o "Gmail no conectado".
  - Si conectado: botón "Desconectar" (form → Server Action que llama `DisconnectGmail`).
  - Si no: botón "Conectar Gmail" (link a `/settings/gmail/connect`).
  - Si query `?connected=1` presente: flash "Gmail conectado correctamente".
  - Si query `?error=<code>`: flash con mensaje mapeado (oauth_denied, invalid_state, exchange_failed).

- `src/app/settings/gmail/connect/route.ts` (Route Handler):
  - `GET`: verifica sesión (401 si no); ejecuta `BeginGmailConnection`; redirect 302 a `authorizeUrl`.

- `src/app/settings/gmail/callback/route.ts` (Route Handler):
  - `GET`: valida sesión; extrae `code` y `state` del query; si Google devolvió `error=access_denied` → redirect `/settings?error=oauth_denied`; ejecuta `CompleteGmailConnection`; redirect `/settings?connected=1` en éxito o `?error=<mapped>` en fallo.
  - Nunca muestra stack traces ni info técnica al usuario.

Sin tests React en este commit (fuera de scope MVP). Lógica crítica se cubre en commit 9 (integration).

### Commit 8 — `feat(presentation): tRPC gmail.disconnect y scheduling de refresh`

- Router `src/presentation/trpc/routers/gmail.ts` (protegido por `requireUser`):
  - `disconnect` mutation → ejecuta `DisconnectGmail`.
  - `status` query → devuelve `{ connected: boolean, googleAccountEmail?: string, connectedAt?: Date }` para que el UI consulte estado sin hacer SELECT directo.
- Registrar el router en el `appRouter` principal.
- **No scheduling todavía**: el refresh de token automático via BullMQ cron se hace en Paso 4 cuando añadamos el job de sync. En Paso 3 solo queda implementado `RefreshGmailToken` como use case, esperando caller.

Tests unitarios del router `gmail.disconnect`:
- Sin sesión → UNAUTHORIZED.
- Con sesión y sin integración → OK (idempotente, no error).
- Con sesión e integración → OK, verifica que repo.deleteByUserId fue llamado.

### Commit 9 — `test(integration): flujo completo connect + callback + disconnect con OAuth mockeado`

En `tests/integration/gmail/oauth-flow.test.ts`:

Setup:
- `beforeEach` limpia `gmail_integrations` y las claves de Redis `oauth:gmail:state:*`.
- Inyecta en el container una implementación `FakeOAuthClient` que implementa `OAuthClientPort` con respuestas programables (no hace HTTP real a Google).
- Usa el `AesGcmTokenEncryption` REAL (con `TOKEN_ENCRYPTION_KEY` de `.env.test`), `RedisOAuthStateStore` REAL contra Redis de docker-compose, y `PrismaGmailIntegrationRepository` REAL contra `focusflow_test`.

Tests:
1. Begin: ejecutar `BeginGmailConnection`, verificar que la URL contiene `state=`, que el state está en Redis con TTL >0 y value = userId.
2. Complete happy path: con un state válido + FakeOAuthClient programado para devolver tokens, verificar que la row en DB tiene tokens encriptados (decrypt devuelve valor conocido, DB no contiene plaintext).
3. Complete con state inexistente → `OAuthStateMismatchError`.
4. Complete con state de otro userId → `OAuthStateMismatchError`, no crea integración.
5. Refresh happy path: integración existente, FakeOAuthClient devuelve nuevo access_token, verificar que `lastRefreshedAt` se actualiza y el nuevo token está encriptado.
6. Disconnect: integración existente → row borrada.
7. Disconnect idempotente: sin integración → no error.

**Gate final del paso:** `pnpm typecheck && pnpm lint && pnpm test:unit && pnpm test:integration` verde.

## Smoke manual (requiere Google real)

Este es el único smoke del MVP que no se puede automatizar porque requiere la UI de consent de Google. Es UN solo flow, ~30 segundos.

Con `pnpm dev` corriendo y `.env` con credenciales reales:

1. Registrarse o loguearse en `http://localhost:3030/login`.
2. Visitar `http://localhost:3030/settings` → debe mostrar "Gmail no conectado" + botón "Conectar Gmail".
3. Click "Conectar Gmail" → redirige a Google OAuth.
4. Loguearse con la cuenta Google que añadiste como "test user" en Google Cloud Console.
5. Aprobar los scopes (`gmail.readonly` + `openid email`).
6. Google redirige a `/settings/gmail/callback?code=...&state=...` → app procesa → redirige a `/settings?connected=1`.
7. Ver flash "Gmail conectado correctamente" + email de la cuenta.
8. Verificar en DB (desde psql o similar):
   ```sql
   SELECT id, "googleAccountEmail", "tokenExpiresAt", length("accessTokenEncrypted") FROM gmail_integrations;
   ```
   - Debe existir 1 row.
   - `accessTokenEncrypted` debe ser base64 largo (>100 chars); **no** debe parecer un JWT ni un Bearer token (nada empieza por `ya29.` ni `Bearer`).
9. Click "Desconectar" → flash de éxito, row desaparece de DB.
10. Reintentar paso 3 tras disconnect → debe poder reconectar sin fricción (el `prompt: 'consent'` garantiza consent fresco).

## Criterios de aceptación

- [ ] 9 commits atómicos sobre `feat/03-oauth-gmail`, cada uno con gate verde.
- [ ] `pnpm test:unit` ≥ 85/85 (53 de Paso 2 + ~32 nuevos).
- [ ] `pnpm test:integration` con los 7 tests nuevos del flujo OAuth (13 total incluyendo los previos).
- [ ] Cobertura en `domain/gmail-integration/` y `application/use-cases/gmail/` ≥ 80%.
- [ ] Smoke manual de 10 pasos pasa end-to-end.
- [ ] `grep -r "ya29\\.\\|accessTokenEncrypted" --include='*.ts' src/` — sin hallazgos sospechosos. Tokens nunca logeados.
- [ ] `git diff origin/main..HEAD -- .env*` — solo cambios en `.env.example` (con valores vacíos); `.env` nunca aparece.
- [ ] Verificar a mano `.env.example`: las 4 variables añadidas con placeholder vacío.
- [ ] Ningún import de `google-auth-library` fuera de `src/infrastructure/` (adapter pattern respetado).
- [ ] Ningún import de Redis fuera de `src/infrastructure/` (ioredis encapsulado en el adapter).
- [ ] Commits en español, Conventional Commits.

## Desviaciones aceptables sin preguntar

- Añadir errores de dominio tipados adicionales si un test los descubre (patrón Paso 1-2).
- Ampliar puertos existentes con métodos adicionales necesarios para un use case, siempre que se mencione en el reporte.
- Renombres/reubicaciones menores si mejoran legibilidad.
- Añadir `integration` como relación inversa en `GmailIntegration.user` si Prisma la exige bidireccional.
- Si `google-auth-library` no expone `getTokenInfo` o similar para obtener el email, decodificar el `id_token` manualmente (es un JWT; usar `Buffer.from(...).toString('utf8')` sobre la parte middle, sin verificar firma porque ya viene de un flow OAuth confiable del lado servidor).

## Desviaciones que requieren parar y preguntar

- Instalar cualquier librería no listada en "Deps pre-autorizadas".
- Cambiar el algoritmo de encriptación (AES-256-GCM es no negociable).
- Persistir tokens en plaintext "solo temporalmente" — jamás.
- Almacenar OAuth state en otro sitio que no sea Redis.
- Cambios al modelo de `User` o `Session` del Paso 1-2.
- Modificar el `CLAUDE.md` (se ajusta cuando se resuelve una contradicción entre plan y reglas, no a la inversa).

## Al terminar

Reporte paste-ready con la estructura habitual:
- Tabla commits SHA + mensaje.
- Métricas del gate.
- Tabla del smoke manual (puede tener 1 paso "N/A - requiere Google real; verificado el DD/MM por el developer").
- Desviaciones justificadas.
- Archivos untracked pendientes (típicamente `.env` si hay cambios locales del developer).
- Commands específicos para push + PR → main.

Push, PR contra `main`, merge, arrancar Paso 4.
