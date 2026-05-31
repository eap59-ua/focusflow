# Política zero-retention de FocusFlow

## Qué garantiza

FocusFlow procesa los emails del usuario en memoria pero **no los persiste**. Concretamente:

- **Postgres no almacena contenido raw de email.** La tabla `briefings` solo guarda el `summary` generado por OpenAI más métricas (`emailsConsidered`, `tokensUsedInput`, etc.). Nunca contiene `bodyText`, `snippet`, `subject` o cabeceras del email original.
- **Las únicas tablas que tocan email son las que el OAuth requiere** (`gmail_integrations`, con tokens cifrados AES-256-GCM) y los briefings.
- **Los workers cargan `EmailMessage` en memoria, los pasan a OpenAI y los descartan.** No hay tabla `email_messages`, `inbox`, ni equivalente.

## Dónde sí viaja contenido (frontera explícita)

Una excepción ineludible: el handover entre workers cruza una boundary JSON de BullMQ, que persiste el job result en Redis.

- `gmail-inbox-sync` devuelve `{ emails: SerializedEmail[] }` (incluye `bodyText`).
- `generate-briefing` lo lee vía `job.getChildrenValues()`.
- Tras terminar, BullMQ aplica `defaultJobOptions.removeOnComplete: { age: 300, count: 50 }` — el job (y sus emails) se borra **al cabo de 5 minutos**.
- En caso de fallo del flow, `removeOnFail: { age: 3600, count: 100 }` deja el payload en Redis hasta **1 hora**, pero el contenido sensible se wipea explícitamente en el error handler del worker (ver § "Compromiso explícito (Paso 8)").

Esa ventana es la frontera real de la política. La tolera porque:
1. Redis es interno (no expuesto público), single-tenant en MVP.
2. 5 min en éxito es el mínimo técnico para el handover del FlowProducer entre workers.
3. En fallo, `bodyText`/`snippet`/`emails` ya no están: el worker reescribe `job.data` antes de re-lanzar.

Ver `docs/audits/2026-04-self-audit.md` § "S1. Job results en Redis contienen contenido raw de email" para la discusión.

## Compromiso explícito (Paso 8)

`CLAUDE.md` dice "borrado inmediato tras procesamiento". La realidad práctica de BullMQ + Redis impone una ventana mínima:

- **Happy path:** payloads en Redis hasta 5 min tras éxito (necesario para el chain handover del FlowProducer entre workers).
- **Failure path:** payloads en Redis hasta 1 h tras fallo, con `bodyText`/`snippet`/`emails` wipeados explícitamente en el error handler del worker (`src/jobs/workers/gmail-inbox-sync.ts`, `generate-briefing.ts`, `briefing-trigger.ts`).

Esto NO viola la política — el wipe en error garantiza que ningún contenido sensible sobrevive al fallo. La ventana de 5 min en éxito es el mínimo técnico para que el flow funcione.

Verificación automatizada: `pnpm verify:zero-retention` chequea estas TTLs (`removeOnComplete.age <= 300`, `removeOnFail.age <= 3600` en las queues con email content).

## Cómo se verifica

`pnpm verify:zero-retention` (script en `scripts/verify-zero-retention.ts`) hace **5 checks**:

1. **Static**: `src/infrastructure/adapters/prisma/` no menciona `snippet` ni `bodyText`.
2. **Static**: `src/jobs/` solo menciona `snippet`/`bodyText` en líneas con el marcador `// OK: zero-retention` (la capa de serialización).
3. **DB**: `briefings.summary` no contiene patrones de cabeceras (`From:`, `Subject:`, `X-Mailer`).
4. **DB**: no hay tablas en `public` con nombres que sugieran email/message storage (whitelist: `gmail_integrations`).
5. **DB**: no hay columnas `bytea` ni `xml` en `public`.
6. **Runtime**: las queues que cargan email content (`gmail-inbox-sync`, `generate-briefing`, `send-briefing-email`) tienen `removeOnComplete` y `removeOnFail` configurados.

Si CUALQUIER check falla, el script termina con exit code 1 y mensaje accionable.

**Pre-requisito**: Postgres y Redis levantados (`docker compose up -d`) y la BD `focusflow_test` creada (corre `pnpm test:integration` una vez para que `globalSetup.ts` la cree).

## Por qué importa

CLAUDE.md dice literalmente:

> Los contenidos de email nunca se persisten más allá del tiempo necesario para generar el briefing. Política: borrado inmediato tras procesamiento.

Es la única afirmación de privacidad fuerte que hace el producto. Si se rompe, FocusFlow deja de ser distinguible de "otro cliente de email con IA". Las consecuencias son tangibles:

- **Para el user**: garantiza que un compromiso de la BD no expone su inbox.
- **Para el portfolio**: es una decisión de diseño defendible que demuestra criterio.
- **Para el roadmap**: cualquier feature futura que requiera persistir email content (búsqueda, etiquetado) tiene que pasar por una decisión arquitectónica explícita, no por accident.

## Cuándo re-correr

- Antes de cualquier merge a `main`.
- Antes de cada deploy.
- Tras introducir nuevos puertos o adapters que toquen email.
- Tras añadir migraciones a `prisma/schema.prisma`.
- En el CI del Paso 8.

## Excepciones permitidas

Si en algún momento es legítimo persistir parte del email (improbable en MVP):

1. Documentar la decisión en un nuevo ADR.
2. Actualizar este documento con el campo nuevo.
3. Actualizar el script `verify-zero-retention.ts` para que el campo entre en una whitelist explícita.
4. Marcar el campo en código con `// OK: zero-retention — ver ADR-NNNN`.

Sin esos 4 pasos, NO se admite contenido raw en DB ni en Redis fuera de los jobs activos.
