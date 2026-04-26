# Self-audit post-MVP — abril 2026

Revisión sistemática del código merged en las ramas `feat/04-ingesta-gmail` → `feat/07-scheduling-cron` (32 commits). Generado en `feat/07b-revision-y-debug` antes de tocar nada de los pasos previos.

Alcance: TODO el código añadido en los Pasos 4-7. NO se cubre el código de pasos 0-3 salvo cuando interactúa directamente con código nuevo.

## Resumen ejecutivo

| Fase | Construido | Métricas | Salud |
|---|---|---|---|
| 4 (ingesta Gmail) | `EmailFetcherPort` + `GmailEmailFetcher` (auth.OAuth2 vía @googleapis/gmail) + `FetchInboxEmails` use case + worker `gmail-inbox-sync` | +18 unit, +10 integration | ✅ |
| 5 (briefing OpenAI) | `BriefingGeneratorPort` + `OpenAIBriefingGenerator` (lazy validation) + `Briefing` entity + `GenerateBriefing` use case + worker + `serialization.ts` | +24 unit, +10 integration | ✅ |
| 6 (envío email) | `EmailSenderPort` + `NodemailerEmailSender` + `BriefingEmailRendererPort` + `HtmlBriefingEmailRenderer` (markdown→html inline) + Mailpit en docker-compose + worker `send-briefing-email` | +14 unit, +5 integration | ✅ |
| 7 (scheduling) | `BriefingSchedulerPort` + `BullMQBriefingScheduler` (FlowProducer + upsertJobScheduler) + 3 use cases scheduling + tRPC router + UI settings + entry point workers | +22 unit, +10 integration | ✅ |

Estado global: **172 unit + 35 integration verdes**, cobertura **98.4%** statements / **97.72%** branches en `domain` + `application`. Gate `typecheck && lint && test:unit` pasa limpio en cada commit del chain.

## Decisiones arquitectónicas notables

### 1. BullMQ FlowProducer con handover por `getChildrenValues()` vs orquestación in-process

**Decisión:** la cadena `gmail-inbox-sync → generate-briefing → send-briefing-email` se construye con `flowProducer.add({ children: [...] })` y cada worker hijo lee el resultado del padre vía `await job.getChildrenValues()`. Los workers también aceptan `job.data` directo (modo tests/manual) — patrón fork-tolerant.

**Alternativas consideradas:**
- A) Un único worker `process-briefing-flow` que llama secuencialmente los tres use cases en memoria.
- B) Tres workers + cola de coordinación + `Queue.add()` encadenado manualmente desde cada worker al siguiente.

**Trade-off elegido:** A pierde resiliencia (un fallo de SMTP fuerza re-fetch de Gmail completo). B mete lógica de orquestación dentro del worker — viola la regla de "workers tontos, casos de uso piensan". FlowProducer aísla cada paso, soporta retry-by-step, y mantiene cada worker delgado.

**Cuándo revisar:** si el throughput de OpenAI crece >10x (cuello de botella en jobs paralelos no por flow encadenado), o si BullMQ deprecara FlowProducer. También si encontramos que `getChildrenValues()` añade latencia significativa (>500ms) al pipeline.

### 2. `TriggerBriefingForUser` delega en `BriefingSchedulerPort.triggerNow` en lugar de tocar BullMQ directamente

**Decisión:** el use case en `application/` recibe un puerto `BriefingSchedulerPort` con método `triggerNow(userId)`. La implementación BullMQ vive en `infrastructure/scheduling/BullMQBriefingScheduler.ts` y construye el Flow.

**Alternativas consideradas:**
- A) Que el use case importe `FlowProducer` directamente (rompe regla de capas: application no importa libs de I/O).
- B) Que el tRPC router invoque `BullMQBriefingScheduler` directamente, saltándose el use case. Más simple pero entierra reglas de validación (existe el user) en presentación.

**Trade-off elegido:** desviación #5 del Paso 7. Añadir método al puerto puramente para "trigger immediate" introduce indirección, pero mantiene la inversión de dependencias intacta — `application` solo conoce contratos; el cuándo y el cómo del flow encadenado vive en infra.

**Cuándo revisar:** si aparece un segundo trigger (CLI, admin tool, webhook) que necesite mismo orquestamiento. Probablemente justifique factorizar `TriggerBriefingForUser` con más responsabilidad y dejar `triggerNow` del puerto solo como "kick-off mecánico".

### 3. Scheduling cron con minuto determinista por hash del userId (djb2 mod 60)

**Decisión:** `BullMQBriefingScheduler.scheduleForUser` calcula `minute = djb2(userId) % 60` y construye `cronPattern = "${minute} ${user.briefingHour} * * *"`. Cada user tiene un minuto fijo dentro de su hora preferida.

**Alternativas consideradas:**
- A) Todos los users a `hh:00:00` exacto. Picos sincronizados de carga sobre Gmail/OpenAI.
- B) Random offset persistido en User. Requiere migración + un campo más.
- C) Random offset NO persistido (calculado al `scheduleForUser`). Cambia el minuto en cada reschedule — confuso.

**Trade-off elegido:** djb2 es determinista (mismo userId → mismo minuto siempre), barato, sin storage extra. Para single-user MVP ofrece spreading "gratis" si más adelante hay multi-user.

**Cuándo revisar:** si jamás se va multi-tenant Y observamos cluster (improbable con djb2 sobre UUIDs aleatorios) Y el cluster causa rate-limit con OpenAI/Gmail.

### 4. `OpenAIBriefingGenerator` valida `apiKey` perezosamente (al primer `generate`), no en constructor

**Decisión:** el constructor acepta `apiKey: ""` sin protestar. La validación se dispara dentro de `buildClient()` la primera vez que se llama `generate`. Mismo patrón que `GoogleOAuthClient` (Paso 3).

**Alternativas consideradas:**
- A) Validar en constructor → `buildContainer()` revienta sin OPENAI_API_KEY. Bloquea tests de integración que no usan OpenAI (workers de auth, gmail) y bloquea el dev local mientras el user no tenga API key configurada.
- B) Inyectar `null` cuando falta la key y manejar `null` en cada call site. Ruido.

**Trade-off elegido:** falla **en uso**, con mensaje accionable que apunta a `docs/pending-external-setup.md`. Permite a Claude Code trabajar autónomamente con el container completo construido aunque OPENAI_API_KEY esté vacía.

**Cuándo revisar:** si en producción el primer briefing falla con "OPENAI_API_KEY no está configurada" y queremos detectar antes (al boot del worker) en vez de al primer cron. Solución entonces: añadir `validateConfig()` opcional al puerto + invocarlo desde `start.ts`.

### 5. Capa de serialización (`SerializedEmail`) para cruzar la frontera JSON de BullMQ

**Decisión:** los workers `gmail-inbox-sync` ↔ `generate-briefing` se pasan `SerializedEmail[]` (interfaz con `receivedAt: string` ISO) y la conversión vive en `src/jobs/serialization.ts`. Cada worker (de)serializa al borde.

**Alternativas consideradas:**
- A) Pasar instancias de `EmailMessage` directamente — BullMQ las serializa con `JSON.stringify` y al deserializar son objetos planos sin métodos. Dates se vuelven strings pero el tipo dice `Date`. Latente bug.
- B) Mover la serialización dentro de `EmailMessage` con `toJSON/fromJSON`. Mete lógica de I/O en el dominio.

**Trade-off elegido:** capa intermedia explícita en `src/jobs/`. El dominio queda intacto; los workers son conscientes de que cruzan una boundary.

**Cuándo revisar:** si añadimos más entidades cruzando jobs (no previsto en MVP). Patrón puede generalizarse con `SerializerPort` si es ≥3 entidades.

### 6. `GenerateBriefing` con caso especial "inbox vacío" → Briefing placeholder persistido

**Decisión:** si `emails.length === 0`, NO se llama OpenAI. Se crea un `Briefing` con `summary` predefinido (≥50 chars), `modelUsed: "none"`, métricas en 0, y se persiste igual que un briefing real.

**Alternativas consideradas:**
- A) No persistir nada. Trade-off: pierdes auditoría de "el cron corrió pero no había emails".
- B) Persistir con `summary: null`. Cambia la forma del modelo y requiere `summary?` opcional en domain.

**Trade-off elegido:** preserva el invariante de Briefing (`summary >= 50 chars`, `modelUsed != ""`), proporciona historial coherente y deja al renderer/email pipeline tratar el caso como cualquier otro briefing. Coste: una row extra por día sin emails.

**Cuándo revisar:** si vista de histórico necesita filtrar "días sin contenido" — entonces añadir flag `isPlaceholder` o derivarlo de `emailsConsidered === 0`.

## Code smells encontrados

Convención: 🟢 trivial · 🟡 worth-fixing · 🔴 needs-discussion. **Ninguno se arregla en este audit** — solo se documenta.

### 🔴 needs-discussion

**S1. Job results en Redis contienen contenido raw de email — frontera difusa con la política zero-retention**
`src/jobs/serialization.ts:13,27`. `SerializedEmail.bodyText` es el texto completo del email. El job result de `gmail-inbox-sync` (`{ count, integrationId, emails: SerializedEmail[] }`) se queda en Redis con `removeOnComplete: { age: 3600, count: 100 }` — hasta 1h tras éxito. Más grave: `removeOnFail: { age: 7 * 24 * 3600 }` — **emails crudos persisten 7 días si el flow falla**. CLAUDE.md dice: "borrado inmediato tras procesamiento". Esto NO es inmediato.
**Propuesta** (NO aquí): bajar `removeOnComplete.age` a 60s para queues que cargan email content; revisar `removeOnFail` para que NO persista email content (override del payload en error handler) o reducir a 1h.

### 🟡 worth-fixing

**S2. `CompleteGmailConnection` clobbera `briefingHour`/`briefingTimezone` del user en reconnect**
`src/application/use-cases/gmail/CompleteGmailConnection.ts:64-69`. Cada vez que se completa OAuth con Google, se invoca `user.enableBriefing(defaultBriefingHour=8, defaultBriefingTimezone="Europe/Madrid")`. Si el user había configurado `hour=10, tz="Asia/Tokyo"` y desconecta+reconecta, sus preferencias vuelven a defaults.
**Propuesta**: si `user.briefingHour !== DEFAULT` o `user.briefingTimezone !== DEFAULT`, preservar y solo `enableBriefing(user.briefingHour, user.briefingTimezone)`. O extraer un método `User.reconnectGmail()` que solo flippea el flag.

**S3. `UpdateBriefingPreferences` rama disabled hace dos transformaciones de dominio redundantes**
`src/application/use-cases/scheduling/UpdateBriefingPreferences.ts:26-28`.
```ts
const updated = input.enabled
  ? user.enableBriefing(input.hour, input.timezone)
  : user.updateBriefingPreferences(input.hour, input.timezone).disableBriefing();
```
La rama disabled construye dos `User` distintos secuencialmente. Funcional pero genera dos `updatedAt` (el segundo gana) y dos allocations.
**Propuesta**: añadir `User.disableBriefingWith(hour, tz)` que aplica todo en una pasada, o aceptar que `enableBriefing(...)` reciba `enabled: boolean` como tercer arg.

**S4. `OpenAIBriefingGenerator` no tiene fallback si la respuesta es vacía o demasiado corta**
`src/infrastructure/adapters/openai/OpenAIBriefingGenerator.ts:49`. `summary = response.choices[0]?.message?.content?.trim() ?? ""`. Si OpenAI devuelve refusal, mensaje vacío o <50 chars, `Briefing.create` lanza `BriefingTooShortError`. El job va a retry → backoff → 3 intentos → fail. El user pierde su briefing del día sin ningún email indicando "OpenAI no respondió útil".
**Propuesta**: si summary < 50 chars, generar fallback como el caso "inbox vacío" pero con texto distinto (`"OpenAI no devolvió un resumen útil esta mañana. Tienes N emails sin procesar; revisa Gmail."`) y persistir. NO hacer retry para este caso.

**S5. `HtmlBriefingEmailRenderer.markdownToHtml` es frágil con markdown mixto**
`src/infrastructure/email/HtmlBriefingEmailRenderer.ts:23-51`. Función inline. Si OpenAI mezcla bullets con párrafos en el mismo bloque sin doble newline, no se renderiza la lista. No soporta `*italic*`, headings, code blocks, ni links. Tests cubren solo casos felices.
**Propuesta** (post-MVP): adoptar `marked` o `markdown-it` con sanitización HTML, o pinear el output del prompt de OpenAI a un schema JSON más estricto y renderizar campo a campo.

**S6. `SCHEDULER_ENABLED=false` con `process.exit(0)` es agresivo bajo `concurrently`**
`src/workers/start.ts:13-16`. El proceso muere limpio. Bajo `pnpm dev` (que usa `concurrently -n next,workers ...`), si `SCHEDULER_ENABLED=false` el sub-proceso "workers" termina inmediatamente, lo que con la config default de concurrently puede tumbar también el de "next" si no usamos `--kill-others` apropiadamente.
**Propuesta**: en lugar de exit, dormir/idle (`await new Promise(() => {})`) con un mensaje. O documentar que `SCHEDULER_ENABLED=false` solo aplica cuando se corre `pnpm worker:start` aislado.

### 🟢 trivial

**S7. `BullMQBriefingScheduler.triggerNow` usa fallback timestamp para el flowId**
`src/infrastructure/scheduling/BullMQBriefingScheduler.ts:85`. `flow.job.id ?? \`flow-${Date.now()}\``. En la práctica BullMQ siempre devuelve id; el fallback enmascararía un fallo silencioso si alguna vez no lo hace.

**S8. `TRIGGER_QUEUE_NAME` hardcoded en `BullMQBriefingScheduler` duplica `QUEUE_NAMES.BRIEFING_TRIGGER`**
`src/infrastructure/scheduling/BullMQBriefingScheduler.ts:15`. Constante `"briefing-trigger"` puede leer `QUEUE_NAMES.BRIEFING_TRIGGER` directamente.

**S9. `oneDayAgoISO()` hardcoded en triggerNow**
`src/infrastructure/scheduling/BullMQBriefingScheduler.ts:26-28`. La ventana "últimas 24h" no es configurable. Razonable para MVP, pero el día que el cron se desplaza (e.g., 06:00) y queremos solo "desde ayer 06:00", tendrá que parametrizarse.

**S10. `EmailDelivery.recipientEmail` es plain `string`, no `Email` VO**
`src/domain/briefing/EmailDelivery.ts:4,16-20`. Inconsistencia con el resto del dominio (User usa `Email` VO).

**S11. `Briefing` no tiene cap superior en `summary` length**
`src/domain/briefing/Briefing.ts`. Domain acepta summary de cualquier longitud — un bug en OpenAI podría devolver 10MB de texto y lo persistimos sin pestañear.

**S12. `isValidTimezone` permisivo con `Intl.DateTimeFormat`**
`src/domain/user/User.ts:15-23`. `Intl.DateTimeFormat("en-US", { timeZone: tz })` acepta `"GMT+5"`, `"Etc/GMT-3"` y otras formas no-IANA standard. Suficiente para MVP, no para multi-region producción.

**S13. `pMapWithConcurrency` con `while (true)` + cursor compartido**
`src/infrastructure/adapters/gmail/GmailEmailFetcher.ts:166-185`. Funciona pero idiomático sería `while (cursor < items.length)`. Estilo.

**S14. Dependencias no usadas en `package.json`**
`googleapis@^171.4.0` y `jose@^6.2.2` no aparecen importadas en ningún archivo de `src/`, `tests/`, o `scripts/`. Probablemente residuales de exploraciones tempranas o reservadas para Paso 8 (jose para JWT en CI). Verificar antes de borrar.

**S15. `concurrently` lanza `tsx watch` para workers; al primer `process.exit` ya no respawnea**
Indirecto pero relacionado a S6: el flujo "configuré .env, reinicio workers" no funciona limpio si workers exited via SCHEDULER_ENABLED.

**S16. `.studio_analytics_id.txt` no está en `.gitignore`**
Generado por `prisma studio`. Untracked en repo. Cosmético.

## Tests débiles

Lista de aserciones que pasan con el código correcto pero **también pasarían con mutaciones triviales del código** (mutation testing manual). Se atacan en commit 3.

**T1. Fronteras exactas de `Briefing.summary >= 50 chars`**
`tests/unit/domain/briefing/Briefing.test.ts:60-67` prueba `"muy corto"` (9) y `""` (0). NO prueba **exactamente 49** (debe rechazar) ni **exactamente 50** (debe aceptar). Mutante: `< MIN_SUMMARY_LENGTH` → `<= MIN_SUMMARY_LENGTH` pasa el test actual.

**T2. `Briefing.restore` solo verifica id+summary, no preserva el resto**
`tests/unit/domain/briefing/Briefing.test.ts:104-122`. Mutante: `restore` que olvida copiar `userId` o `tokensUsedInput` slip past.

**T3. `EmailMessage.MAX_FUTURE_SKEW_MS = 60s` no testea exactamente 60001ms vs 60000ms**
`tests/unit/domain/email-message/EmailMessage.test.ts:82-94`. Pruebas con +5min y +30s pero no la frontera exacta. Mutante: `> now + MAX_FUTURE_SKEW_MS` → `>= now + MAX_FUTURE_SKEW_MS` pasa.

**T4. `User.briefingHour` no testea NaN/Infinity**
`tests/unit/domain/user/UserBriefing.test.ts:32-41`. Cubre 24, -1, 8.5 — no `NaN`, `Infinity`. `Number.isInteger(NaN) === false` así que rechazaría, pero el comportamiento no está enclavado por test.

**T5. `User.briefingTimezone` no testea casos edge de Intl.DateTimeFormat**
`tests/unit/domain/user/UserBriefing.test.ts:43-55`. Solo `"Mars/OlympusMons"` y `""`. NO testea `"europe/madrid"` (lowercase — Intl es case-sensitive y debería rechazar), `"UTC"` (acepta), `"Etc/GMT+5"` (acepta — ¿queremos esto?).

**T6. `EmailDelivery.create` no valida `sentAt` (no hay invariante)**
`tests/unit/domain/briefing/EmailDelivery.test.ts`. No hay test sobre dates futuras absurdas o muy antiguas. El dominio tampoco las valida — pero entonces el smell #11 está confirmado: faltan invariantes.

**T7. `GenerateBriefing` truncation: el "primer email solo > budget" no se testea**
`tests/unit/application/briefing/GenerateBriefing.test.ts:118-132`. El loop hace `if (runningChars + charsForThis > charBudget && considered.length > 0) break`. Mutante: quitar `&& considered.length > 0` → ningún test detecta. Caso real: un solo email muy largo que excede el budget completo debería seguir incluyéndose (no hay alternativa).

**T8. `FetchInboxEmails`: integración desaparece DESPUÉS del refresh exitoso**
Línea 56-58 (uncovered en coverage report — `src/application/use-cases/email/FetchInboxEmails.ts:57`). No hay test que cubra la rama "refresh OK pero `findByUserId` segunda llamada devuelve null" → `GmailIntegrationNotFoundError`.

**T9. `AesGcmTokenEncryption.encrypt` no verifica forma del output**
`tests/unit/infrastructure/security/AesGcmTokenEncryption.test.ts`. Roundtrip + tampering + key incorrecta cubiertos. Pero NO se verifica:
- Output es base64 válido (mutante: cambiar `.toString("base64")` por `"hex"` rompe `decrypt` pero no detecta directamente la regresión en encrypt).
- Output ≥ 28 bytes mínimos (12 IV + 16 authTag + ≥0 ciphertext).
- IV efectivamente rota (parcialmente cubierto por "ciphertext distinto" pero no comprueba bytes 0-12).

**T10. `HtmlBriefingEmailRenderer` no testea XSS en `subject`**
`tests/unit/infrastructure/email/HtmlBriefingEmailRenderer.test.ts:60-66`. Cubre escape en HTML body (displayName con `<script>`). NO cubre subject inyectado vía displayName transitiva (subject es `"Tu briefing matutino — ${dateLabel}"` que no incluye displayName, pero el `<title>` interno SÍ usa subject directamente — lo cual es seguro pero merece test).

**T11. `Session.create` no verifica el formato del id (longitud + alfabeto)**
`tests/unit/domain/session/Session.test.ts`. Cubre que `value matches /^[0-9a-f]{64}$/` indirectamente (sí — línea 16). OK, este NO es débil. Lo dejo descrito por completitud.

**T12. `TriggerBriefingForUser` solo cubre happy path + user-not-found**
`tests/unit/application/scheduling/TriggerBriefingForUser.test.ts`. NO cubre: scheduler.triggerNow lanza error → debe propagar; resultado del scheduler se devuelve verbatim (cubierto parcialmente: `flowId` matches).

**T13. `EncryptedToken` cobertura 88.88%, línea 13 uncovered**
Reportado por `pnpm test:unit:coverage`. Línea 13 probablemente una rama de validación.

## Cobertura visible

`pnpm test:unit:coverage` (incluye solo `src/domain/**` y `src/application/**`):

```
Statements   : 98.4%   (370/376)
Branches     : 97.72%  (129/132)
Functions    : 99.27%  (137/138)
Lines        : 98.39%  (367/373)
```

Archivos por debajo del 100% statements:
- `src/application/use-cases/email/FetchInboxEmails.ts` — 96.15% (línea 57: rama "integration null tras refresh")
- `src/application/use-cases/gmail/CompleteGmailConnection.ts` — 80% (líneas 64-69: rama del user encontrado vs no encontrado tras integration save — el "user no encontrado" NO está testeado)
- `src/domain/email-message/EmailMessage.ts` — 96% (línea 109: getter `receivedAt` no usado en tests)
- `src/domain/gmail-integration/EncryptedToken.ts` — 88.88% (línea 13)

Todos por encima del threshold de 80%. Los huecos están concentrados en happy-path-only: las ramas de error son las uncovered, lo cual es exactamente lo que queremos atacar en commit 3.

## Dependencies justificadas

Walk-through de runtime deps (`dependencies` en `package.json`):

| Dep | Versión | Uso real | Veredicto |
|---|---|---|---|
| `@googleapis/gmail` | ^14.0.1 | `GmailEmailFetcher` (auth.OAuth2 + gmail v1) | ✅ |
| `@prisma/adapter-pg` | ^7.8.0 | `clients.ts` (driver adapter Prisma 7) | ✅ |
| `@prisma/client` | ^7.8.0 | repositorios | ✅ |
| `@tanstack/react-query` | ^5.100.1 | tRPC client (peer dep) | ✅ |
| `@trpc/*` | ^11.16.0 | API tipada | ✅ |
| `bcryptjs` | ^3.0.3 | `BcryptPasswordHasher` | ✅ |
| `bullmq` | ^5.76.1 | jobs + scheduler + flow producer | ✅ |
| `cookie` | ^1.1.1 | route handlers tRPC | ✅ |
| `google-auth-library` | ^9.15.1 | `GoogleOAuthClient` (OAuth2Client) | ✅ |
| `googleapis` | ^171.4.0 | **NO se usa.** No hay `import "googleapis"` en src/. | 🟡 borrar |
| `ioredis` | ^5.10.1 | `clients.ts` (Redis client) | ✅ |
| `jose` | ^6.2.2 | **NO se usa.** No hay `import "jose"` en src/. | 🟡 borrar |
| `next` | ^15.5.15 | framework | ✅ |
| `nodemailer` | ^6.10.1 | `NodemailerEmailSender` | ✅ |
| `openai` | ^4.104.0 | `OpenAIBriefingGenerator` | ⚠️ peer warning con zod@4 (commit 5 lo aborda) |
| `pg` | ^8.20.0 | adapter postgres | ✅ |
| `prisma` | ^7.8.0 | CLI + generator | ✅ |
| `react` / `react-dom` | ^19.2.5 | UI | ✅ |
| `zod` | ^4.3.6 | validación de schemas | ✅ (peer warning con openai — commit 5) |

**Acción**: borrar `googleapis` y `jose` del `package.json` cabe en commit 5 si se confirma que no rompe nada. Si en duda, dejar y documentar.

## Findings críticos para Paso 8 (deploy + hardening)

Lista de cosas que el deploy de Paso 8 **necesita resolver explícitamente**:

1. **TOKEN_ENCRYPTION_KEY** — env var obligatoria. Hosting debe permitir secrets management.
2. **`buildContainer` valida `TOKEN_ENCRYPTION_KEY` en boot** — un deploy sin la var setteada hace crash al primer request. ¿Queremos health check que detecte esto antes de aceptar tráfico?
3. **`SCHEDULER_ENABLED`** — fakea `pnpm worker:start` para CI/build. En el deploy real necesitamos que sea `true` por default y solo falsy en dry runs.
4. **OPENAI_API_KEY**, **GOOGLE_CLIENT_ID**/**SECRET**, **SMTP_*** — secrets obligatorios; documentar mecanismo del provider elegido (Vercel/Railway/etc.).
5. **`removeOnFail` 7 días en BullMQ contiene email content** — antes de production, decidir política. Para MVP single-user es aceptable; para portfolio público con tráfico real no.
6. **CORS / security headers** no configurados. Next.js default es permisivo.
7. **Rate limiting** mencionado en CLAUDE.md como "desde el día uno" pero NO implementado. Crítico para `/api/trpc/auth.*` antes de exponer dominio público.
8. **Postgres y Redis externos** — el code-actual asume Postgres y Redis como servicios independientes (ver `clients.ts`). Provider hosting debe permitirlo (Neon + Upstash, o Railway con add-ons).
9. **Migrations en deploy**: `db:deploy` debe ejecutarse en el pipeline de release antes de levantar la nueva versión.
10. **Logs en producción**: actualmente `console.log` plano. Commit 4 introduce `Logger` abstraction — el deploy debe pipear logs al provider (Vercel/Railway) y/o a Sentry.
11. **Mailpit es solo dev**. Producción necesita SMTP real (Resend, SES, Postmark, etc.) — decisión Bloque del 08a.
12. **Browser-side bundle**: confirmar que NADA de `src/infrastructure/` (Prisma, Gmail SDK, OpenAI) se cuele al cliente. `next build` debería detectarlo, pero validación manual antes del primer deploy.

---

**Generado:** 2026-04-26 · **Branch:** `feat/07b-revision-y-debug` · **Comparación:** `feat/03-oauth-gmail..feat/07-scheduling-cron` (32 commits).
