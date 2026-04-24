# Paso 2 — Login + sesiones

Segunda fase del MVP. Construye el flujo de autenticación completo: `LoginUser`, `LogoutUser`, `GetCurrentUser`, gestión de sesiones persistidas en DB, cookie httpOnly, middleware tRPC que inyecta `ctx.user` en los routers protegidos, y páginas `/login` y `/logout`.

**Dependencia de entrada:** Paso 1 mergeado en `main`. Usuario ya puede registrarse (`POST /api/trpc/auth.register`) pero no queda autenticado tras hacerlo.

**Dependencia de salida:** desbloquea el Paso 3 (OAuth Gmail), que necesita un usuario identificado al recibir el callback de Google.

## Pre-requisitos verificables antes de arrancar

1. `git checkout main && git pull` — estar en main actualizado tras merge del PR de Paso 1.
2. `docker compose ps` — `postgres` y `redis` en estado `running`/`healthy`.
3. `pnpm test:unit` verde contra `main`.
4. Revisar `@docs/plan/00-roadmap.md` y `@CLAUDE.md` para recordar reglas. No hay contradicciones previstas; si aparece una, **parar y reportar** como en Paso 1.

**Si alguna falla, parar y reportar.** No improvisar el pre-requisito.

## Branch y convenciones de commit

- Crear branch `feat/02-login-sesiones` desde `main`.
- Commits en español, Conventional Commits. Prefijos esperados en este plan: `chore:`, `feat(domain):`, `feat(application):`, `feat(infra):`, `feat(presentation):`, `test(integration):`.
- **Gate verde obligatorio en cada commit.** `pnpm typecheck && pnpm lint && pnpm test:unit`.
- Fusionar por unidad lógica cerrada, nunca splits RED/GREEN.

## Deps pre-autorizadas para esta fase

Añadir en el commit 5 (`feat(infra):`), no antes:

```bash
pnpm add cookie@^1
pnpm add -D @types/cookie
```

Justificación (cumple regla de `CLAUDE.md` sobre nuevas libs):
- `cookie`: parser/serializer estándar de la cabecera HTTP `Cookie`, mantenido por jshttp (misma org que Express). ~5kb. Dependencia transitiva de `next` ya, pero la importamos explícitamente para desacoplar y poder probar el middleware.

**No añadir en esta fase:**
- NO usar `iron-session`, `next-auth`, `lucia` ni librerías de sesión. Sesiones simples en DB son suficientes para MVP y no introducen dependencia opaca.
- NO usar JWT. Sesiones server-side en Postgres son más auditables y revocables; BullMQ + OpenAI no requieren stateless.

Cualquier otra librería que Claude Code considere necesaria, **parar y preguntar** antes de instalar.

## Variables de entorno nuevas

Añadir a `.env.example` (con placeholders) y a `.env` / `.env.test` (con valores reales):

```
SESSION_COOKIE_NAME=focusflow.session
SESSION_LIFETIME_DAYS=30
```

No se añaden secretos nuevos en este paso.

## Modelo de datos

Añadir al `schema.prisma`:

```prisma
model Session {
  id        String   @id  // token opaco de 32 bytes hex
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())
  expiresAt DateTime

  @@index([userId])
  @@index([expiresAt])
  @@map("sessions")
}
```

Relación inversa en `User`:

```prisma
model User {
  // ... campos existentes
  sessions Session[]
}
```

La migración Prisma se llama `add_sessions`.

**Nota de seguridad:** el `id` de la sesión es un token opaco generado con `crypto.randomBytes(32).toString('hex')` (64 chars). Se almacena tal cual en DB y se envía tal cual en la cookie. No se hashea porque es un token de sesión (no una contraseña) y la comparación en cada request debe ser rápida; la mitigación es la entropía (256 bits) y `onDelete: Cascade` al borrar el User.

## Commits (8 commits, por unidad lógica)

### Commit 1 — `chore(prisma): añadir modelo Session y migración add_sessions`

- Editar `prisma/schema.prisma` añadiendo `Session` y la relación inversa en `User`.
- Ejecutar `pnpm prisma migrate dev --name add_sessions`.
- Commitear `prisma/migrations/NNNNNN_add_sessions/` + schema actualizado.
- **Gate:** typecheck + lint + test:unit verdes (no afectan).

### Commit 2 — `feat(domain): Session entity + VOs + errores`

En `src/domain/session/`:

- `SessionId.ts` — VO con `create(value: string)` que valida hex de 64 chars; `Session.generate()` usa `crypto.randomBytes(32).toString('hex')`.
- `Session.ts` — entidad con campos `id: SessionId`, `userId: UserId`, `createdAt: Date`, `expiresAt: Date`. Métodos: `Session.create({ userId, lifetimeDays })` (factory), `Session.restore({ id, userId, createdAt, expiresAt })` (reconstitución desde DB), `isExpired(now: Date)`.
- `errors/SessionNotFoundError.ts`, `errors/SessionExpiredError.ts` — extienden `DomainError`.

**Recordatorio:** `restore()` va en el mismo commit que `create()`, como aprendimos en el Paso 1 (feedback documentado).

**Tests unitarios en `tests/unit/domain/session/`:**
- `SessionId` rechaza strings que no sean hex-64.
- `Session.create` fija `expiresAt = createdAt + lifetimeDays`.
- `Session.restore` reconstituye sin disparar invariantes.
- `isExpired(now)` true si `now >= expiresAt`, false en caso contrario.

### Commit 3 — `feat(application): caso de uso LoginUser`

En `src/application/use-cases/auth/LoginUser.ts`:

- Puertos usados: `UserRepository.findByEmail` (ya existe), `PasswordHasher.verify` (ya existe), `SessionRepository.save` (nuevo puerto).
- Input: `{ email: string, password: string }`. Validado con Zod shape (ambos strings no vacíos).
- Output: `{ session: Session }`. El caller decide cómo serializar en cookie.
- Errores: `InvalidCredentialsError` (email no existe O password incorrecto — mismo error para no filtrar si existe el email).

Añadir puerto nuevo en `src/application/ports/SessionRepository.ts`:

```ts
export interface SessionRepository {
  save(session: Session): Promise<void>
  findById(id: SessionId): Promise<Session | null>
  deleteById(id: SessionId): Promise<void>
  deleteExpired(now: Date): Promise<number>  // devuelve nº borradas
}
```

**Tests unitarios** mockeando los 3 puertos. Cubrir:
- Happy path: retorna `Session` con `userId` correcto.
- Email no existe → `InvalidCredentialsError`.
- Password incorrecto → `InvalidCredentialsError`.
- Session generada tiene `expiresAt` = createdAt + `SESSION_LIFETIME_DAYS` (cargado de env al instanciar el use case, NO hardcoded).

### Commit 4 — `feat(application): casos de uso LogoutUser y GetCurrentUser`

En `src/application/use-cases/auth/`:

- `LogoutUser.ts` — input: `{ sessionId: string }`. Usa `SessionRepository.deleteById`. No falla si la sesión no existe (logout idempotente).
- `GetCurrentUser.ts` — input: `{ sessionId: string }`. Usa `SessionRepository.findById` + `UserRepository.findById`. Devuelve `{ user: User }` o lanza `SessionNotFoundError` / `SessionExpiredError`. Si la sesión está expirada, la borra antes de lanzar (cleanup oportunista).

**Tests unitarios** mockeando puertos:
- LogoutUser: llama a delete con el id correcto; idempotente si no existe.
- GetCurrentUser: happy path; sesión no existe; sesión expirada + verificación de delete; usuario borrado aunque sesión válida → `SessionNotFoundError`.

### Commit 5 — `feat(infra): PrismaSessionRepository`

En `src/infrastructure/adapters/PrismaSessionRepository.ts`:

- Implementa `SessionRepository`.
- Traduce entre `Session` (dominio) y row de Prisma. `save` usa `upsert`; `findById` → `Session.restore(...)` o null.
- `deleteExpired(now)` hace `deleteMany({ where: { expiresAt: { lt: now } } })`.

Instalar `cookie` + `@types/cookie` (deps pre-autorizadas arriba) en este commit.

**Sin tests unitarios para el adapter** — se cubren en commit 8 (integration).

### Commit 6 — `feat(presentation): tRPC auth.login / auth.logout + cookie middleware`

- Router `src/presentation/trpc/routers/auth.ts` añade mutations `login` y `logout`.
- `login`: ejecuta `LoginUser`, setea cookie `SESSION_COOKIE_NAME` con el `session.id`, `HttpOnly`, `SameSite=Lax`, `Secure` en prod, `Path=/`, `Max-Age=LIFETIME_DAYS * 86400`.
- `logout`: ejecuta `LogoutUser` leyendo sessionId de la cookie, luego setea cookie con `Max-Age=0` para borrarla.
- Context tRPC `src/presentation/trpc/context.ts` lee la cookie de sesión del request y la expone como `ctx.sessionId` (o null).
- Middleware `protectedProcedure` en `src/presentation/trpc/trpc.ts`: si no hay `ctx.sessionId` O `GetCurrentUser` falla → `UNAUTHORIZED`. Si todo OK, inyecta `ctx.user` para procedures descendientes.
- Añadir procedure `auth.me` (protected) que devuelve `ctx.user` serializado — sirve para smoke manual y para tests.

**Tests unitarios:**
- Context lee la cookie correctamente (parser puro, mockear `Request`).
- `protectedProcedure` rechaza sin cookie.
- `protectedProcedure` rechaza con cookie inválida.
- `protectedProcedure` inyecta `ctx.user` con cookie válida.

### Commit 7 — `feat(presentation): páginas /login y redirección tras registro`

- `src/app/login/page.tsx` — formulario HTML básico (email + password + submit). Server Component con client action que llama al tRPC `login`. Error inline si credenciales inválidas.
- Tras registro exitoso (Paso 1, ya en `main`), redirigir a `/login?registered=1` — el flash "cuenta creada, inicia sesión" se renderiza si el query param está.
- Tras login exitoso, redirect a `/` (página placeholder por ahora, veremos qué va ahí en Paso 3).
- Página `/` muestra "Hola, {user.displayName}" si hay sesión; si no, CTAs a `/login` y `/register`.

Sin tests de componentes React en este paso (fuera de scope MVP). Se verifica en integration test + smoke manual.

### Commit 8 — `test(integration): flujo completo login + sesión + logout`

En `tests/integration/auth/login-flow.test.ts`:

- Setup: `beforeEach` limpia tablas `sessions` y `users` en `focusflow_test`.
- Test 1: registro + login → cookie devuelta + `auth.me` con la cookie devuelve el user.
- Test 2: login con password incorrecto → 401 + `InvalidCredentialsError`.
- Test 3: login + logout → `auth.me` con la misma cookie → 401.
- Test 4: sesión expirada manualmente en DB (manipular `expiresAt` al pasado) → `auth.me` → 401 + registro de sesión borrada en DB.

**Gate verde al final de este commit:** `pnpm typecheck && pnpm lint && pnpm test:unit && pnpm test:integration`.

## Smoke manual final (antes de reportar verde)

Con el servidor corriendo (`pnpm dev`), ejecutar desde navegador o `curl`:

| Caso | Acción | Resultado esperado |
|------|--------|--------------------|
| A | `POST /api/trpc/auth.register` con credenciales nuevas | 200 + user creado |
| B | `POST /api/trpc/auth.login` con las mismas credenciales | 200 + `Set-Cookie: focusflow.session=...` |
| C | `GET /api/trpc/auth.me` con esa cookie | 200 + user data |
| D | `POST /api/trpc/auth.logout` con esa cookie | 200 + `Set-Cookie: focusflow.session=; Max-Age=0` |
| E | `GET /api/trpc/auth.me` con la cookie ya borrada | 401 UNAUTHORIZED |
| F | Visita `GET /login` en navegador, rellena form, submit | Redirige a `/` mostrando "Hola, {displayName}" |

Si los 6 casos pasan, reportar verde al usuario.

## Criterios de aceptación (checklist antes de reportar)

- [ ] 8 commits atómicos sobre `feat/02-login-sesiones`, cada uno con gate verde.
- [ ] `pnpm test:unit` ≥ 30/30 (8 de Paso 1 + ~15 nuevos).
- [ ] `pnpm test:integration` pasa con los 4 tests nuevos del flujo login.
- [ ] Cobertura en `domain/session/` y `application/use-cases/auth/Login*.ts`, `Logout*.ts`, `GetCurrentUser.ts` ≥ 80%.
- [ ] Smoke manual: los 6 casos de la tabla de arriba pasan.
- [ ] Ningún secreto en el repo (revisar `git diff origin/main..HEAD -- .env*`).
- [ ] Ningún import externo desde `domain/` (`grep -r "from 'prisma\\|next\\|openai'" src/domain/` debe ser vacío).
- [ ] El log de commits tiene mensajes en español con prefijos Conventional correctos.

## Desviaciones aceptables sin preguntar

Cualquiera de estos se puede hacer autónomamente, anotar al final del reporte:

- Añadir un error de dominio tipado si los existentes no cubren un caso real (como `InvalidDisplayNameError` en Paso 1).
- Cambios menores en nombres de métodos o archivos si mejoran legibilidad y no contradicen este plan.
- Añadir índices de DB extra en `schema.prisma` si se detecta query hot path.

## Desviaciones que requieren parar y preguntar

- Instalar cualquier librería NO listada en "Deps pre-autorizadas".
- Añadir nuevos modelos Prisma aparte de `Session`.
- Cambiar el mecanismo de sesión (JWT en lugar de DB, librería externa, etc.).
- Cualquier contradicción real con `CLAUDE.md`.
- Modificar código de Paso 1 (`RegisterUser`, `User`, etc.) más allá de la relación inversa `sessions` en el schema.

## Al terminar

Reporte paste-ready como en Paso 1:
- Tabla de commits con SHA + mensaje.
- Métricas del gate (typecheck / lint / unit / integration / cobertura).
- Tabla de smoke manual con los 6 casos.
- Lista de desviaciones (cada una con justificación de 1 línea).
- Archivos untracked pendientes de decisión.

Push, PR contra `main`, merge, arrancar Paso 3.
