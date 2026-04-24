# Paso 1 — Vertical slice: registro de usuario

> **Precondición:** Paso 0 completado y pusheado. CLAUDE.md y `docs/adr/0001-stack-y-arquitectura.md` vigentes. Estos documentos mandan sobre este archivo en caso de contradicción.

## Objetivo del slice

Un usuario puede registrarse con **email + contraseña + nombre**. El slice atraviesa las 4 capas (domain, application, infrastructure, presentation) siguiendo TDD estricto. Al terminar, quedará demostrado que el patrón hexagonal funciona end-to-end y tendremos la base para el OAuth de Gmail (Paso 2).

**Fuera de scope de este paso:**
- Login / sesiones / JWT / cookies → Paso 2
- UI de `/register` (página React) → Paso 2
- Recuperación de contraseña, verificación de email → fuera de MVP
- Rate limiting → Paso 3

## Criterios de aceptación

Al final del Paso 1, debe cumplirse TODO esto:

1. Existe la mutación tRPC `auth.register(input: { email, password, displayName })` que:
   - Devuelve el usuario creado (sin el hash de password) al éxito
   - Falla con `CONFLICT` si el email ya existe
   - Falla con `BAD_REQUEST` si la password tiene menos de 8 caracteres
   - Falla con `BAD_REQUEST` si el email es inválido
2. Migración Prisma aplicada con tabla `users` (id, email único, hashed_password, display_name, created_at, updated_at)
3. Test unitario de dominio: `Email` value object valida formato RFC-básico
4. Test unitario de dominio: `User` entity rechaza estados inválidos
5. Test unitario de aplicación: `RegisterUser` con puertos mockeados — happy path, duplicado, password débil
6. Test de integración: flujo completo contra Postgres real (el del docker-compose)
7. Cobertura ≥80% en `src/domain/` y `src/application/`
8. `pnpm typecheck && pnpm lint && pnpm test:unit` verde
9. 7 commits atómicos en español, no un mega-commit
10. Ningún fichero de `src/domain/` o `src/application/` importa Prisma, bcrypt ni ninguna librería externa

## TDD: orden estricto

No saltes pasos. El orden es **test → código mínimo → refactor → siguiente test**.

1. Test RED de `Email` value object → implementación mínima → GREEN → refactor
2. Test RED de `User.create()` con invariantes → implementación → GREEN
3. Test RED de `RegisterUser` use case (puertos mockeados con fakes, no librerías de mocking pesadas; basta con objetos `{ findByEmail: vi.fn() }`) → implementación → GREEN
4. Implementar adapters reales (`PrismaUserRepository`, `BcryptPasswordHasher`) — estos van con integration tests, no unit
5. Test RED de integración del flujo completo → wire-up de tRPC → GREEN
6. Pasar gate + coverage

## Estructura a crear

### Domain (TypeScript puro, cero deps externas)

```
src/domain/user/
├── User.ts                          # aggregate root, factory User.create()
├── Email.ts                         # value object con validación
├── HashedPassword.ts                # value object (branded type sobre string)
└── errors/
    ├── EmailAlreadyRegisteredError.ts
    ├── InvalidEmailError.ts
    └── WeakPasswordError.ts
src/domain/shared/
└── errors/
    └── DomainError.ts               # clase base que extienden los de arriba
```

Reglas para las entidades:
- `User.create({ email, hashedPassword, displayName })` construye el agregado; los IDs y timestamps los genera la factory (usa `crypto.randomUUID()`). No expongas constructor público.
- Invariantes: `displayName` no vacío y ≤ 100 chars; `email` es un `Email` VO válido; `hashedPassword` es un `HashedPassword` VO.
- Cero `import` de fuera del propio paquete `src/domain/`. Solo tipos y utilidades nativas (`crypto.randomUUID` está en Node 18+).

### Application

```
src/application/ports/
├── UserRepositoryPort.ts            # interface: findByEmail, save
└── PasswordHasherPort.ts            # interface: hash(plain) -> hashed, verify(plain, hashed) -> bool
src/application/use-cases/auth/
├── RegisterUser.ts                  # clase o función con dependencias inyectadas
└── RegisterUser.schema.ts           # Zod schema del input (email, password, displayName)
```

`RegisterUser` recibe `{ userRepo: UserRepositoryPort, hasher: PasswordHasherPort }` vía constructor / closure. Su método `execute(input)`:
1. Valida con Zod el input
2. Valida con `Email.create(input.email)` → lanza `InvalidEmailError` si no
3. Valida longitud de password → lanza `WeakPasswordError` si < 8
4. Llama `userRepo.findByEmail(email)` → si existe, lanza `EmailAlreadyRegisteredError`
5. Hashea con `hasher.hash(input.password)`
6. Crea `User.create(...)`, persiste con `userRepo.save(user)`, devuelve el user

### Infrastructure

```
src/infrastructure/adapters/prisma/
└── PrismaUserRepository.ts          # implementa UserRepositoryPort
src/infrastructure/adapters/security/
└── BcryptPasswordHasher.ts          # implementa PasswordHasherPort (bcryptjs)
src/infrastructure/container.ts      # factory que ensambla use cases con sus deps
```

`container.ts` exporta una función `buildContainer(prisma: PrismaClient)` que devuelve `{ registerUser: RegisterUser }` ya cableado. Nada de singletons globales ni DI frameworks — solo una factory limpia.

### Presentation

```
src/presentation/trpc/
├── context.ts                       # crea PrismaClient + container por request
├── trpc.ts                          # inicializa tRPC con el context
└── routers/
    ├── _app.ts                      # router raíz
    └── auth.ts                      # mutation register
src/app/api/trpc/[trpc]/
└── route.ts                         # handler HTTP delgado, enruta a tRPC
```

El router `auth` mapea errores de dominio a códigos tRPC:
- `EmailAlreadyRegisteredError` → `TRPCError({ code: 'CONFLICT' })`
- `InvalidEmailError` / `WeakPasswordError` → `TRPCError({ code: 'BAD_REQUEST', message })`
- Cualquier otro → relanza (lo manejará tRPC como `INTERNAL_SERVER_ERROR`)

El handler en `src/app/api/trpc/[trpc]/route.ts` es un one-liner usando `fetchRequestHandler` de `@trpc/server/adapters/fetch`.

### Prisma

Añadir a `prisma/schema.prisma`:

```prisma
model User {
  id             String   @id @db.Uuid
  email          String   @unique
  hashedPassword String   @map("hashed_password")
  displayName    String   @map("display_name")
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt      DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@map("users")
}
```

Comando:
```bash
pnpm prisma migrate dev --name init_users
```

Commitear el archivo de migración generado bajo `prisma/migrations/`.

### Tests

```
tests/unit/domain/user/
├── Email.test.ts                    # 4-6 casos: válido, sin @, múltiples @, longitud 0, con espacios, trim
├── User.test.ts                     # displayName vacío falla, displayName >100 falla, create ok genera id + timestamps
tests/unit/application/auth/
└── RegisterUser.test.ts             # happy path, email duplicado, password débil, email inválido
tests/integration/auth/
└── register.integration.test.ts     # arranca Prisma, crea user, verifica DB, limpia
```

Para el integration test usa un `.env.test` con `DATABASE_URL` apuntando a una BD de test (puedes reutilizar el Postgres del docker-compose con un schema `focusflow_test` o crear una BD separada). En `beforeEach`, truncate tabla `users`.

## Orden de commits (atómicos, en español)

Usa **commits pequeños y frecuentes**. Referencia temporal: no más de 1h entre commits.

1. `test(domain): email y password value objects con invariantes`
2. `feat(domain): User aggregate y errores de dominio`
3. `test(application): caso de uso RegisterUser con puertos mockeados`
4. `feat(application): implementación de RegisterUser`
5. `feat(infra): PrismaUserRepository y BcryptPasswordHasher`
6. `feat(prisma): migración inicial de tabla users`
7. `feat(trpc): router auth.register con mapeo de errores de dominio`
8. `test(integration): flujo completo de registro contra Postgres real`

Son 8 commits. Si ves que en el mismo commit metes cosas de 2 capas distintas, párate y divide.

## Gates que deben pasar antes del commit 8

- `pnpm typecheck` → 0 errores
- `pnpm lint` → 0 errores, 0 warnings
- `pnpm test:unit` → todos verdes
- `pnpm test:integration` → todos verdes (requiere Postgres corriendo: `docker compose up -d postgres`)
- Coverage report (si está configurado) → ≥80% en domain + application

## Reglas duras para este paso

- **Ninguna excepción a "el dominio no importa nada externo".** Si `Email.ts` necesita algo que no sea TypeScript puro, se replantea. La tentación de meter librerías de validación de email aquí es fuerte — resístela: una regex bien escogida basta para el MVP.
- **No metas lógica en `route.ts`.** El handler de Next es 3 líneas: recibe Request, llama al tRPC handler, devuelve Response.
- **No uses `any`.** Ni para callar el linter. Si el tipo de una lib externa te tortura, haz un wrapper en `infrastructure/` con tipos propios y usa eso.
- **No hagas login todavía.** Es tentador "ya que estamos". Es scope creep. Anótalo en `BACKLOG.md` y sigue.
- **No hagas UI.** El endpoint tRPC es suficiente para demostrar el slice. La página viene en Paso 2.

## Reporte final

Al acabar el Paso 1, párate y devuélveme:

1. Salida de `pnpm typecheck && pnpm lint && pnpm test:unit && pnpm test:integration`
2. `git log --oneline` mostrando los 8+ commits nuevos
3. `git diff --stat d4d6d73..HEAD` (resumen de archivos cambiados desde el commit del Paso 0)
4. Cualquier desviación del plan con justificación (p. ej. si encontraste un problema similar al del App Router de Next que te forzó a adaptar)
5. Un smoke test manual: `curl` o similar contra `POST http://localhost:3000/api/trpc/auth.register` con un body válido → muéstrame la respuesta

## No avances al Paso 2 sin confirmación mía

Cuando termines, **espera**. El Paso 2 (OAuth con Gmail + login + sesiones) lo encontrarás en `docs/plan/02-oauth-gmail.md` cuando yo lo deje. Si no existe aún, para.
