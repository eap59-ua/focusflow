# Paso 7b — Revisión, hardening y polish del MVP

Sub-fase de polish post-MVP. **No añade features.** Audita el trabajo de Pasos 4-7, fortalece tests débiles, fija deuda menor, prepara el repo para deploy del Paso 8 y para que sea presentable como portfolio.

**Dependencia de entrada:** Paso 7 verde (172 unit + 35 integration). Working tree limpio.

**Dependencia de salida:** Paso 8 (deploy/hardening) puede arrancar inmediatamente sin "limpiar antes".

## Pre-requisitos

1. `git status` limpio sobre `feat/07-scheduling-cron`.
2. `pnpm typecheck && pnpm lint && pnpm test:unit && pnpm test:integration` verde.
3. `docker compose ps` — `postgres`, `redis`, `mailpit` running (mailpit lo añade Paso 6 si todavía no está, OK).

## Branch

`feat/07b-revision-y-debug` desde `feat/07-scheduling-cron`.

## Deps pre-autorizadas

```bash
# Solo si elegimos opción A para fix del peer warning openai/zod:
pnpm add -D zod@npm:zod@^3.23.8 --save-prefix=""
```

(Detalle de implementación en commit 5 abajo. Si el camino que elija Claude Code es la opción B, no se instala nada nuevo.)

**NO añadir:**
- `stryker-mutator` ni framework de mutation testing — las mutaciones se hacen manualmente, identificadas en audit.
- Frameworks de docs (Docusaurus, etc.) — el README es markdown plano.
- `chalk`, `cli-table` ni librerías para el script de smoke — `console.log` plano.

Cualquier otra dep, parar y preguntar.

## Commits (8 commits, atómicos, gate verde en cada uno)

### Commit 1 — `docs(audit): self-audit completo de Pasos 4-7 con findings clasificados`

Crear `docs/audits/2026-04-self-audit.md`. Claude Code lee TODOS los commits de las ramas 04, 05, 06, 07 (`git log feat/03-oauth-gmail..feat/07-scheduling-cron --reverse`) y produce un documento estructurado:

```markdown
# Self-audit post-MVP — abril 2026

## Resumen
Una línea por fase: qué se construyó, métricas, salud general (✅/⚠️/🛑).

## Decisiones arquitectónicas notables
Para cada decisión no obvia (mínimo 4):
- **Decisión:** qué se hizo.
- **Alternativas consideradas:** las que se descartaron.
- **Trade-off elegido:** por qué.
- **Cuándo revisar:** qué condición invalidaría la decisión.

Mínimo a cubrir:
1. Sesiones server-side DB vs JWT.
2. AES-256-GCM con node:crypto vs librería externa.
3. OAuth state en Redis con TTL vs tabla DB.
4. BullMQ FlowProducer + workers handover vs orchestración en proceso único.
5. TriggerBriefingForUser via puerto BriefingSchedulerPort (la desviación #5 del Paso 7).

## Code smells encontrados
Lista clasificada: 🟢 trivial · 🟡 worth-fixing · 🔴 needs-discussion.
Para cada uno: archivo, línea aproximada, qué es, propuesta. NO arreglar aquí — solo documentar.

## Tests débiles
Lista de tests que pasarían incluso con código incorrecto (mutation testing manual).
Para cada uno: qué assert falta, qué bug podría escapar. Se atacan en commit 3.

## Cobertura visible
`pnpm test:unit:coverage` → tabla de cobertura por archivo. Identificar archivos <80% en `domain/` o `application/`.

## Dependencies justificadas
Repaso de cada lib en `package.json`: ¿se usa? ¿hay alternativa más liviana? ¿peer warnings? Foco en runtime deps; devDeps se aceptan más laxamente.

## Findings críticos para Paso 8
Cosas que el deploy de Paso 8 necesita resolver: env vars hardcoded, configs de dev vs prod, etc.
```

**Importante:** este commit NO modifica código. Solo añade el documento de audit. Gate verde sigue siendo el de Paso 7.

### Commit 2 — `feat(scripts): verify-zero-retention.ts para auditoría automatizada`

Crear `scripts/verify-zero-retention.ts`. Script ejecutable con `pnpm tsx scripts/verify-zero-retention.ts`. Hace:

1. Conecta a `focusflow_test` (DB de tests, no la de dev).
2. Ejecuta queries explícitas de "ningún contenido de email persistido":
   ```sql
   -- ningún campo en briefings que parezca contenido raw de email
   SELECT id FROM briefings WHERE summary LIKE '%From:%' OR summary LIKE '%Subject:%' OR summary LIKE '%X-Mailer%' LIMIT 1;
   -- ninguna tabla con nombre sugerente
   SELECT table_name FROM information_schema.tables WHERE table_name LIKE '%email%' OR table_name LIKE '%message%';
   -- ningún campo blob
   SELECT table_name, column_name FROM information_schema.columns WHERE data_type IN ('bytea','xml') AND table_schema='public';
   ```
3. Inspecciona Redis: claves `bull:gmail-inbox-sync:*` con `removeOnComplete` config esperado.
4. Hace grep estático del código:
   ```ts
   await runShell('grep -rn "snippet\\|bodyText" src/infrastructure/adapters/Prisma');
   await runShell('grep -rn "bodyText\\|snippet" src/jobs/ | grep -v "// OK:" ');
   ```
5. Si CUALQUIER check falla, exit 1 con mensaje claro.

Añadir script a `package.json`: `"verify:zero-retention": "tsx scripts/verify-zero-retention.ts"`.

Documentar en `docs/audits/zero-retention-policy.md` (1 página): qué garantiza, cómo se verifica, por qué importa, cuándo re-correrlo.

### Commit 3 — `test: hardening de tests débiles encontrados en self-audit`

Basado en la sección "Tests débiles" del documento de audit (commit 1). Para cada test débil identificado, añadir asserts específicos. Por ejemplo:

- Si el test de `AesGcmTokenEncryption.encrypt` solo verifica que el output != input, añadir: que tenga 28 bytes mínimos (12 IV + 16 tag), que `decrypt(modificar 1 byte)` lance, que dos encrypts del mismo plaintext den outputs distintos (IV fresco).
- Si el test de `Session.isExpired` no cubre el borde exacto (`now === expiresAt`), añadirlo.
- Si tests de `Briefing.create` no cubren el límite de `summary` exactamente en 50 chars, añadir el caso boundary.

**Cota objetivo del commit:** ≥10 nuevos asserts/casos sobre los existentes. Si Claude Code no encuentra al menos 10 puntos débiles en el audit, está siendo demasiado optimista — repasar audit.

### Commit 4 — `chore(observability): logger interceptor + audit de payloads sensibles`

Crear `src/infrastructure/logging/Logger.ts` (si no existe) — abstracción simple sobre `console`. Métodos: `info`, `warn`, `error` con shape `{ event, ...data }`.

Modificar use cases y workers para loggear EVENTOS estructurados:
```ts
this.logger.info({ event: 'briefing_generated', userId, briefingId, tokensUsed: result.tokensUsedInput + result.tokensUsedOutput, model: result.modelUsed })
```

Añadir tests con un `LoggerSpy` que captura todos los logs. Test que recorre el flow E2E (con fakes) y verifica:
- ✅ `userId`, `briefingId`, `count`, `messageIdHeader.slice(0,16)+'...'` aparecen.
- ❌ `bodyText`, `snippet`, `subject`, `body`, `accessToken`, `refreshToken`, `pre-encryption tokens` NUNCA aparecen.

Si el spy detecta cualquier valor del set ❌, test falla.

Documentar la convención en `docs/audits/logging-policy.md`: qué se logea, qué nunca, ejemplos.

### Commit 5 — `chore(deps): resolver peer warning de openai contra zod@4`

Investigar el estado real:
1. ¿Existe versión de `openai@^5` o similar que soporte zod@4?
2. ¿El uso actual del SDK toca alguna helper que dependa de zod (typically `openai/helpers/zod`)?

Elegir UNA opción documentada en el commit message:

- **Opción A — pnpm aliasing** (si Opción B no es viable): instalar `zod@^3` como `zod-v3` alias y dejar la dep transitiva contenta. Usar `package.json` overrides si es más limpio:
  ```json
  "pnpm": {
    "overrides": {
      "zod@<4": "^3.23.8"
    }
  }
  ```

- **Opción B — bump openai SDK**: si existe versión que soporta zod@4, bumpear y aceptar cambios en API si los hay.

- **Opción C — silenciar warning sin cambio funcional**: añadir a `package.json`:
  ```json
  "pnpm": {
    "peerDependencyRules": {
      "allowedVersions": { "zod": "4" }
    }
  }
  ```
  Solo si nuestro uso real de openai SDK no toca código zod-dependent.

Verificar tras la elección: `pnpm install` sin warnings, `pnpm typecheck && pnpm test:unit && pnpm test:integration` verde.

**Si las 3 opciones tienen consecuencias inesperadas (rompen tests, bumps mayores con breaking changes), parar y reportar.**

### Commit 6 — `feat(scripts): smoke-with-fakes.ts para verificación E2E local sin creds externas`

Crear `scripts/smoke-with-fakes.ts`. Script que:

1. Conecta a `focusflow` (DB de dev, NO test).
2. Crea o reusa un user de dev (email `dev@focusflow.local`, password preset).
3. Inserta una `GmailIntegration` fake con tokens "encryptedFakeAccess" + "encryptedFakeRefresh" — el `FakeOAuthClient` que ya existe en tests acepta estos tokens.
4. Inyecta en el container dependency overrides: `FakeEmailFetcher` (devuelve 5 EmailMessage hardcoded), `FakeBriefingGenerator` (devuelve summary determinista), `NodemailerEmailSender` real apuntando a Mailpit local.
5. Llama `triggerBriefingForUser({ userId: dev.id })`.
6. Espera 5-10 segundos.
7. Lee la última fila de `briefings` para ese user, imprime el summary.
8. Hace fetch a `http://localhost:8025/api/v1/messages` (Mailpit API) y verifica que hay un email nuevo de `focusflow@local.dev` para `dev@focusflow.local`.
9. Imprime: "✅ Smoke con fakes OK. Email visible en http://localhost:8025"

Si cualquier paso falla, exit 1 con mensaje claro.

Añadir a `package.json`: `"smoke:fakes": "tsx scripts/smoke-with-fakes.ts"`.

**Esto le sirve al developer para verificar el chain completo en 30 segundos cuando vuelva, sin tener Google Cloud Console ni OpenAI key configurados.**

### Commit 7 — `docs(readme): README.md completo para portfolio`

Reescribir `README.md` (existirá vacío o mínimo). Estructura objetivo (~250-350 líneas):

```markdown
# FocusFlow

Briefing matutino generado por IA a partir de tu inbox de Gmail. Cada mañana recibes un email con resumen estructurado de lo urgente, lo informativo, y el resto.

[Screenshot/GIF del settings + email recibido — placeholder, lo añade el developer al hacer smoke real]

## Por qué

Párrafo corto: qué problema resuelve, para quién (single-user personal).

## Stack

| Capa | Tecnología |
|---|---|
| Framework | Next.js 15 (App Router) |
| API | tRPC |
| ORM | Prisma 7 (driver adapter @prisma/adapter-pg) |
| DB | PostgreSQL |
| Cache + Jobs | Redis + BullMQ |
| LLM | OpenAI (gpt-4o-mini) |
| Email | nodemailer + Mailpit (dev) |
| OAuth | google-auth-library |
| UI | Tailwind CSS + Server Components |
| Tests | Vitest |
| Tipos | TypeScript estricto |

## Arquitectura

Hexagonal con cuatro capas. Diagrama ASCII:
[diagrama de capas: domain ← application ← infrastructure / presentation]

Reglas de dependencias [breve, link a CLAUDE.md].

## Decisiones notables

3-5 bullets cortos con enlaces a `docs/audits/2026-04-self-audit.md`.

## Cómo correr local

```bash
git clone ...
cd focusflow
cp .env.example .env       # rellenar según docs/pending-external-setup.md
pnpm install
docker compose up -d        # postgres, redis, mailpit
pnpm prisma migrate dev
pnpm dev                    # next + worker en paralelo
```

## Tests

```bash
pnpm test:unit                # 172 tests
pnpm test:integration         # 35 tests, requiere docker
pnpm test:unit:coverage       # cobertura
pnpm verify:zero-retention    # audit de retención
pnpm smoke:fakes              # E2E con fakes, sin creds externas
```

## Estado actual

MVP code-complete. Pendiente: smoke con creds reales, deploy. Ver `docs/plan/00-roadmap.md` para detalle.

## Licencia

MIT (o lo que el developer decida; placeholder).
```

**No incluir:** badges falsos (CI status si no hay CI), enlaces rotos, screenshots inventados.

### Commit 8 — `docs(plan): preguntas pendientes para definir Paso 8 (deploy + hardening)`

Crear `docs/plan/08a-decisiones-pendientes.md`. Documento estructurado con preguntas que el developer debe responder antes de que se escriba el `08-deploy-hardening.md` real:

```markdown
# Paso 8 — Decisiones pendientes antes de escribir el plan

Cuando vuelvas con tiempo y quieras desplegar, contesta estas preguntas. Con tus respuestas, escribo `08-deploy-hardening.md` ajustado.

## 1. Hosting

- **A) Vercel + Neon (Postgres) + Upstash (Redis)** — más cómodo para Next.js, free tiers generosos, deploy automático desde GitHub. 3 proveedores que coordinar. ~$0/mes en MVP, ~$25/mes con uso real.
- **B) Railway** — todo en uno (Next + Postgres + Redis), $5/mes mínimo, deploy desde GitHub. Más simple operacionalmente.
- **C) VPS (Hetzner/DigitalOcean) con Docker Compose** — más control y barato (~$5/mes), pero ops manual: nginx, certbot, backups, monitoring. Solo si te interesa el aprendizaje devops.
- **D) Otro / no deployar** — el código se queda en GitHub como portfolio sin URL pública.

Trade-offs y preguntas clave...

## 2. Dominio

- **A)** Subdominio gratis del provider (`focusflow.vercel.app`).
- **B)** Dominio propio (~$10-15/año en Namecheap/Porkbun). Mejor para portfolio profesional.

## 3. Error tracking

- **A)** Sentry (free tier 5k errores/mes).
- **B)** Logs en consola del provider (más espartano).
- **C)** Self-hosted (overkill para MVP).

## 4. CI

- **A)** GitHub Actions con gate completo (typecheck + lint + test:unit + test:integration con servicios docker). Free para repos públicos.
- **B)** No CI; deploy directo del provider valida en runtime.

## 5. Modo de la OAuth consent screen

- **A)** Quedarse en "Testing" — solo tú como user, sin verificación, gratis. Suficiente si nadie más va a usarlo.
- **B)** Publicar y verificar — proceso 4-6 semanas con Google, requiere privacy policy + terms of service. Solo si abres a más users.

## 6. Branding mínimo

- **A)** Logo + favicon caseros (5 min en Excalidraw).
- **B)** Sin branding, look default Next.js.

---

Cuando contestes estas 6 preguntas, escribo `08-deploy-hardening.md` con plan concreto de commits.
```

## Criterios de aceptación

- [ ] 8 commits atómicos sobre `feat/07b-revision-y-debug`, gate verde en cada uno.
- [ ] `pnpm test:unit` ≥ 182/182 (172 de Paso 7 + ≥10 nuevos por commit 3).
- [ ] `pnpm test:integration` con LoggerSpy test verde.
- [ ] `pnpm verify:zero-retention` exit 0.
- [ ] `pnpm smoke:fakes` exit 0 (con docker compose running y un user de dev creado).
- [ ] `pnpm install` sin peer warnings (commit 5).
- [ ] `README.md` ≥ 200 líneas, sin badges/screenshots inventados.
- [ ] Cinco documentos generados: `docs/audits/2026-04-self-audit.md`, `docs/audits/zero-retention-policy.md`, `docs/audits/logging-policy.md`, `docs/plan/08a-decisiones-pendientes.md`, `README.md`.

## Desviaciones aceptables sin preguntar

- Más de 10 puntos débiles en commit 3 si el audit los encuentra (cuanto más, mejor).
- Refactors triviales mientras se añaden asserts (rename de variable, extracción de helper).
- Estructura del audit document distinta si Claude Code prefiere otra ordenación.
- README más largo si lo justifica.

## Desviaciones que requieren parar y reportar

- Cambios estructurales al código de Pasos 4-7 (refactor mayor, API breaking).
- Mover archivos entre capas hexagonales.
- Instalar mutation testing framework, docs framework, o cualquier dep no autorizada arriba.
- Encontrar bugs reales (no solo code smells) durante el audit. **Reportar y discutir antes de fixar.**
- Si la opción A/B/C de commit 5 (peer warning) tiene consecuencias inesperadas, reportar.

## Al terminar

Reporte estándar:
- Commits + métricas.
- Lista de findings del self-audit con severidad.
- Si hay bugs reales encontrados (no esperados), separados con prioridad.
- Confirmación de que `pnpm verify:zero-retention` y `pnpm smoke:fakes` pasan.
- README.md visible (link al archivo).
- `08a-decisiones-pendientes.md` listo para que el developer conteste.

**Tras 7b:** todo el trabajo autónomo agotado. El siguiente paso es necesariamente el developer respondiendo las 6 preguntas del 08a. No hay nada más que Claude Code pueda hacer sin esa input.
