# ADR-0001: Stack y arquitectura de FocusFlow

**Status:** Accepted
**Date:** 2026-04-24
**Deciders:** Erardo Aldana Pessoa

> Este ADR explica el **porqué** de las decisiones. Las reglas concretas que Claude Code debe aplicar a cada sesión viven en `CLAUDE.md`. Si hay contradicción, **manda CLAUDE.md** y este ADR debe actualizarse.

## Contexto

FocusFlow es el segundo proyecto estrella del portfolio, en paralelo a StudySync. Diferenciación intencional:

- **StudySync:** social, real-time, multi-cliente (web + Android), FastAPI + Kotlin + React.
- **FocusFlow:** personal, async, single-user, web-only, Next.js 15 full-stack.

El objetivo del MVP es acotado: **Morning Briefing** — un email diario que resume la bandeja de Gmail del propio usuario, generado con LLM y enviado a una hora configurable.

**Constraints reales:**

- Desarrollador solo (Erardo), trabajando en paralelo a StudySync (también 12 semanas)
- Presupuesto tendente a 0€/mes
- Timeline: 6-8 semanas hasta MVP estable en producción
- Stack preferido: TypeScript/Node (el otro proyecto ya usa Python, queremos breadth)
- Debe ser demo-friendly: un reclutador tiene que poder darse de alta, conectar su Gmail y recibir el briefing al día siguiente sin fricción

**Fuerzas en juego:**

- Minimizar scope para que el MVP termine → un solo killer feature antes de expandir
- Arquitectura que luego soporte más integraciones (Calendar, Linear, Slack) sin reescribir
- Privacidad/seguridad real, no teatral — los contenidos de email son sensibles
- Stack que luzca en entrevistas para roles cloud/full-stack

## Decisión

**Monolito Next.js 15 (App Router) + tRPC + Prisma + PostgreSQL + BullMQ/Redis + OpenAI API, con arquitectura hexagonal estricta (misma convención que StudySync).** Despliegue: Vercel (frontend + rutas API ligeras) + Fly.io (workers BullMQ) + Supabase (Postgres gestionado + Redis) en tiers gratuitos.

---

## Opciones consideradas

### Stack

#### Opción A: Next.js 15 App Router + tRPC (ELEGIDA)

| Dimensión | Valoración |
|---|---|
| Complejidad | Media |
| Familiaridad del dev | Alta (React ya dominado, Next.js conocido) |
| DX | Altísima — tipos end-to-end cliente↔servidor |
| Ecosistema | Enorme, shadcn/ui, librerías maduras |
| Deploy | Vercel free tier cubre MVP |

**Pros:** Un solo codebase front+back con tipos compartidos. tRPC elimina el boilerplate de OpenAPI/fetch. App Router da Server Components para ahorrar JS al cliente.
**Cons:** Rutas API de Next no son ideales para jobs largos → por eso los workers van aparte en BullMQ.

#### Opción B: Remix + REST

**Pros:** Nested routing y loaders bonitos.
**Cons:** Sin tipos end-to-end por defecto, menos adopción. Descartado.

#### Opción C: Backend separado (FastAPI o Express) + frontend React

**Pros:** Backend más reutilizable si en el futuro hay móvil.
**Cons:** MVP no necesita móvil (StudySync ya lo cubre). Doblar infra es overkill para single-dev. Descartado.

### Cola de jobs

#### Opción A: BullMQ + Redis (ELEGIDA)

**Pros:** Madura, tipada, retries/backoff built-in, dashboard opcional (Bull Board), corre en cualquier VPS con Redis. Redis lo necesitamos igual para rate-limiting y cache, así que coste incremental cero.
**Cons:** Requiere proceso worker separado (bien — lo queremos fuera de Vercel).

#### Opción B: Vercel Cron + funciones serverless

**Pros:** Zero-infra, todo dentro de Vercel.
**Cons:** Timeouts (10s free / 60s pro) matan llamadas largas a OpenAI + Gmail. Retries manuales. Descartado para jobs que tocan LLM.

#### Opción C: Inngest / Temporal

**Pros:** Modelos más potentes (workflows, step functions).
**Cons:** Vendor lock-in. BullMQ es suficiente para el MVP, y migrar más adelante es barato. Descartado por YAGNI.

### LLM provider

#### Opción A: OpenAI API (ELEGIDA)

**Pros:** GPT-4o-mini es barato (~$0.15 per 1M input tokens) y suficientemente bueno para resumir emails. SDK Node oficial maduro. JSON mode para outputs estructurados.
**Cons:** Vendor lock-in; mitigable con un puerto `BriefingGeneratorPort` que abstrae el proveedor.

#### Opción B: Claude API (Anthropic)

**Pros:** Mejor calidad de escritura para resúmenes narrativos.
**Cons:** Un poco más caro, pero irrelevante a este volumen. Decisión reversible por diseño — el puerto nos permite cambiar en una línea.

**Decisión práctica:** arrancamos con OpenAI por coste + familiaridad; el puerto nos deja swap a Claude si la calidad pide mejora.

### OAuth con Gmail

#### Opción A: Google OAuth directo con `googleapis` SDK (ELEGIDA)

**Pros:** Control total del flujo, menos capas, menos deps. Refresh tokens gestionados por nosotros.
**Cons:** Más código de plumbing inicial.

#### Opción B: NextAuth.js / Auth.js

**Pros:** Cubre login + OAuth en un solo paquete.
**Cons:** Pensado principalmente para auth de login, no para "el usuario ya está logueado y conecta una tercera cuenta de Google para leer su Gmail". Se puede forzar pero no es limpio. Y NextAuth añade capas que no necesitamos en single-user MVP.

**Decisión:** Google OAuth directo, encapsulado en un adapter `GmailOAuthClient` en `infrastructure/`.

### Privacidad de datos sensibles

#### Decisión: **Zero-retention para contenido de emails**

- Los tokens OAuth se almacenan **encriptados en reposo** (AES-256-GCM con clave en env var).
- El **contenido de los emails nunca se persiste**. Al generar el briefing: fetch → LLM → send → drop. La única cosa que se guarda es el briefing final (que es output del LLM, ya sin PII bruta) y metadata mínima (timestamps, conteos).
- El usuario puede borrar todo con un botón. GDPR-friendly desde día cero.

Esto es no-negociable y va reflejado en `CLAUDE.md` como regla.

### Hosting

#### Stack elegido

- **Vercel** (free tier) — Next.js app (frontend + rutas API ligeras)
- **Fly.io** (free tier) — worker BullMQ + cron scheduler
- **Supabase** (free tier) — PostgreSQL gestionado
- **Upstash Redis** (free tier) — Redis para BullMQ y rate-limit

**Total coste mensual esperado para MVP:** 0€. Si sube la demanda, la primera parada de pago es Supabase Pro (25$/mes) cuando superemos 500MB de DB.

---

## Análisis de trade-offs

**Principal dilema:** monolito Next.js vs backend separado. Optamos por monolito porque:

1. StudySync ya demuestra "backend + mobile + web" (FastAPI/Kotlin/React). FocusFlow no necesita repetir esa historia; puede demostrar "Next.js full-stack bien hecho con separación de capas".
2. Un solo dev en 6-8 semanas no puede permitirse mantener dos repos sincronizados.
3. La separación que importa no es de procesos, sino de **capas** — y eso lo conseguimos con la arquitectura hexagonal dentro de Next.js.

**Segundo dilema:** arquitectura hexagonal dentro de Next.js. Alguien podría decir que es over-engineering para un MVP single-user. Rebatimos:

1. El CLAUDE.md apunta a que la disciplina se beneficia cuando Claude Code itera sobre el repo — tener capas limpias evita que el LLM "corrompa" la arquitectura.
2. Las integraciones futuras (Calendar, Linear, Slack) serán mucho más rápidas de añadir con puertos bien definidos que con código acoplado a APIs concretas.
3. Los tests son DRAMÁTICAMENTE más fáciles de escribir cuando mockear implica implementar una interface, no inyectar un objeto con N métodos fakes.

**Tercer dilema:** TypeScript estricto. La tentación es usar `any` en los adapters de Gmail/OpenAI. La regla en CLAUDE.md es: permitido solo en adapters de librerías sin tipos, con comentario justificando. Esto evita que `any` se cuele en el dominio.

## Consecuencias

**Qué se hace más fácil:**

- Tests unitarios de dominio y application con 0 mocks de librerías (solo mocks de puertos propios).
- Cambiar de OpenAI a Claude o Gmail a Outlook en el futuro: reescribes el adapter, no tocas casos de uso.
- Onboarding de un segundo dev (si algún día): leer `src/domain` + `CLAUDE.md` + ADR da el 80% del contexto.
- Debugging: un job fallido queda atrapado en BullMQ con retries visibles, no se pierde en un timeout de lambda.

**Qué se hace más difícil:**

- Primera semana de scaffolding tiene más boilerplate que un Next.js naive. Hay que vivir con eso.
- Onboarding mental a "un use case = un archivo, un puerto = una interface" para gente que no conozca hex.

**A revisar si:**

- El coste del scaffolding hexagonal ralentiza el MVP más de 2 semanas → re-evaluar con un approach más light (ej. domain + infrastructure, sin application layer explícita).
- BullMQ en Fly.io free tier no es suficiente (cold starts, memoria) → mover workers a un VPS pequeño o Railway.
- La calidad del briefing con GPT-4o-mini no es suficientemente buena → swap a Claude (es un puerto, una línea de DI).

---

## Action Items — backlog orientativo (8 semanas)

> Este backlog lo planifica y ejecuta Claude Code con superpowers. Lo de abajo es la visión de alto nivel; los planes semanales salen del `/plan` dentro de Claude Code cada lunes.

### Fase 1 — Semana 1: Fundación

1. [ ] Scaffold monorepo Next.js 15 App Router con estructura hexagonal vacía
2. [ ] Install de superpowers plugin, `pnpm` setup, CLAUDE.md en raíz
3. [ ] docker-compose con Postgres + Redis, `.env.example` completo
4. [ ] Prisma schema mínimo: tabla `users` + `integrations` (polimórfica para Gmail/Calendar/Linear futuros)
5. [ ] Health check endpoint `/api/health` verde en dev + tests
6. [ ] GitHub repo creado, primer commit, CI/CD con GitHub Actions (typecheck + lint + test:unit)

### Fase 2 — Semanas 2-3: Auth + Gmail OAuth

7. [ ] Signup/login con email + password (bcrypt, JWT en cookie HttpOnly). Tests unitarios del use case.
8. [ ] Flujo OAuth Google: `/api/auth/google/start` → consent → `/api/auth/google/callback` → guardar tokens encriptados
9. [ ] AES-256-GCM en `infrastructure/security/` con tests unitarios
10. [ ] Vista "Mi Gmail está conectado" con botón desconectar

### Fase 3 — Semanas 4-5: Generación del Briefing

11. [ ] Adapter `GmailClient.fetchRecent(userId, since)` → devuelve DTOs de email
12. [ ] Adapter `BriefingGenerator.generate(emails) → BriefingText`
13. [ ] Use case `GenerateMorningBriefing` orquestando los dos. Tests con puertos mockeados.
14. [ ] Endpoint manual `/api/briefing/generate-now` para triggear a demanda (modo desarrollo)

### Fase 4 — Semana 6: Entrega y scheduling

15. [ ] Adapter `EmailSender` (Resend o SMTP vía Nodemailer)
16. [ ] Job BullMQ `sendMorningBriefing` que corre `GenerateMorningBriefing` + `EmailSender.send`
17. [ ] Scheduler que encola el job según `user.briefingTime` (default 8:00 en su timezone)
18. [ ] Vista configuración: hora, timezone, opt-out

### Fase 5 — Semana 7: Histórico y polish

19. [ ] Tabla `briefings` con el texto generado (sin PII bruta de emails)
20. [ ] Vista `/dashboard` con timeline de briefings recibidos
21. [ ] Tests E2E del happy path completo (Playwright)
22. [ ] Observabilidad: Sentry o similar, logs estructurados

### Fase 6 — Semana 8: Producción y demo

23. [ ] Deploy a Vercel + Fly.io + Supabase
24. [ ] Onboarding con 3-5 beta testers (amigos)
25. [ ] Landing en el subdominio del portfolio
26. [ ] Grabación de demo de 90s
27. [ ] Actualizar `eap-portfolio/index.html` añadiendo FocusFlow en la sección de proyectos

---

## Métricas de éxito (realistas)

- ✅ MVP en producción en ≤8 semanas
- ✅ 3+ beta testers reciben briefings diarios durante ≥1 semana sin fallos
- ✅ Coste de infra ≤5€/mes incluso con 20 usuarios
- ✅ Cobertura de tests ≥80% en `domain` + `application`
- 🎯 Si pasa esto: 50 usuarios reales, mención en Product Hunt, interés de inversores/empresas

**NO son objetivos:**

- Multi-tenant / teams — único usuario por cuenta, sin compartir briefings
- Mobile app — web es suficiente para leer un email
- Integración con más servicios que Gmail — expansión post-MVP

---

## Notas de implementación

### División `src/app/` vs `src/presentation/`

En la primera sesión de scaffolding detectamos que Next.js 15 solo reconoce el App Router en `app/` (raíz) o `src/app/`. No existe configuración pública para redirigir el directorio al ubicado originalmente en `src/presentation/app/` (lo confirmamos por fallo de `next lint`, `next dev` y `next build`, y por ausencia de flag en `next.config.ts`).

**Decisión:** dividir presentación en dos carpetas, manteniendo la capa hexagonal intacta:

- **`src/app/`** — routing del App Router (layouts, pages, route handlers API). Impuesto por Next.js. Los archivos aquí son **delgados**: parsean inputs, llaman al `container`, formatean `Response`. Sin lógica de negocio.
- **`src/presentation/`** — resto de la capa de presentación hexagonal: componentes React, tRPC routers, helpers de UI, adapters de la capa de presentación. Aquí vive la lógica de UI reutilizable que los route handlers consumen.

**Por qué no otras alternativas:**

- *Symlink `src/app` → `src/presentation/app`*: frágil en Windows (requiere developer mode) y en CI.
- *Archivos proxy en `src/app/` que re-exporten desde `src/presentation/app/`*: duplica la jerarquía de carpetas y añade N archivos placeholder por cada ruta, sin beneficio arquitectónico real.

**Impacto sobre la regla de dependencias:** ninguno. `src/app/` pertenece conceptualmente a la capa de presentación; aplican las mismas reglas (no importa de `infrastructure/` directamente, consume el `container`, no contiene reglas de negocio). La separación física es una concesión al framework, no un cambio arquitectónico.

Esta regla queda también reflejada en `CLAUDE.md` para que Claude Code la aplique cada sesión.

---

## Referencias

- `CLAUDE.md` — reglas de repo (source of truth para Claude Code en cada sesión)
- `README.md` — setup local, variables de entorno, arranque
- `docs/adr/` — ADRs posteriores numerados secuencialmente (0002, 0003…)
- ADR hermano: `STUDYSYNC-ADR.md` para referencia del otro proyecto
