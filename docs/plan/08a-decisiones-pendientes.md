# Paso 8 — Decisiones pendientes antes de escribir el plan

Cuando vuelvas con tiempo y quieras desplegar, contesta estas 6 preguntas. Con tus respuestas, escribo `docs/plan/08-deploy-hardening.md` ajustado a lo elegido (commits específicos, env vars exactas, comandos del provider). Sin tus respuestas el plan se queda genérico y obliga a re-escribir secciones cuando elijas.

Cada pregunta lleva una **recomendación** que cuadra con el estado actual del repo. No es vinculante.

## 1. Hosting

¿Dónde corre el deploy?

- **A) Vercel + Neon (Postgres) + Upstash (Redis)** — más cómodo para Next.js, free tiers generosos, deploy automático desde GitHub. Tres dashboards que coordinar pero los tres tienen UI buena. Coste: ~$0/mes en MVP, ~$25/mes con uso real (Vercel Pro a partir de uso, Neon free hasta 0.5GB, Upstash hasta 10K commands/día).
- **B) Railway** — todo en uno (Next.js + Postgres + Redis como add-ons), $5/mes mínimo (hobby plan). Deploy desde GitHub. Operacionalmente más simple: un solo dashboard.
- **C) VPS (Hetzner/DigitalOcean) con Docker Compose** — más control, más barato (~$5/mes), pero ops manual: nginx, certbot, backups, monitoring. Solo si te interesa el aprendizaje devops.
- **D) Otro / no deployar** — el código se queda en GitHub como portfolio sin URL pública. Válido si el objetivo es solo demostrar la implementación.

**Recomendación**: A (Vercel + Neon + Upstash). El stack está optimizado para Next.js y los workers de BullMQ funcionan bien en serverless con un proceso separado para el worker (Vercel Functions con `maxDuration` o un servicio dedicado en Railway/Fly.io solo para los workers — esto último introduce un híbrido). Si te importa la simplicidad operacional, B (Railway) es defendible.

**Consecuencia para el plan**: cambia los comandos de deploy, las env vars secretas (Vercel CLI vs Railway dashboard) y el approach al worker process (en Vercel hay que dividir frontend ↔ worker en dos servicios).

## 2. Dominio

¿Cómo se llama la URL?

- **A)** Subdominio gratis del provider (`focusflow.vercel.app`, `focusflow.up.railway.app`).
- **B)** Dominio propio (~$10-15/año en Namecheap/Porkbun/Cloudflare). Mejor para portfolio profesional.

**Recomendación**: B si el proyecto va a ser linkeable desde tu CV/portfolio. Si es solo "lo dejo corriendo para mí", A.

**Consecuencia para el plan**: si B, el plan incluye paso de DNS (CNAME al provider) y configuración de SSL (los providers lo gestionan automático tras añadir el domain).

## 3. Error tracking

¿Cómo capturamos errores en producción?

- **A) Sentry** — free tier 5k errores/mes; SDK de Next.js auto-instrumenta. SaaS.
- **B) Solo logs en consola del provider** — más espartano. Vercel/Railway capturan stdout/stderr y permiten queries básicas.
- **C) Self-hosted (Sentry self-hosted, GlitchTip)** — overkill para single-user MVP.

**Recomendación**: A. El logger ya existe (`ConsoleLogger` que produce JSON parseable); añadir `Sentry.init()` en `src/app/layout.tsx` + capturar errores no-handled en workers es ~30 líneas. Free tier sobra para MVP.

**Consecuencia para el plan**: si A, añade dep `@sentry/nextjs` + 1 env var (`SENTRY_DSN`) + 1 commit "feat(observability): integrar Sentry".

## 4. CI

¿Tenemos pipeline?

- **A) GitHub Actions con gate completo**: typecheck + lint + test:unit + test:integration con servicios docker. Free para repos públicos (incluido este si pasa a público).
- **B) No CI; deploy directo del provider valida en runtime** — el provider corre `next build` y si falla, no merge. Pero los tests no se ejecutan automáticamente.

**Recomendación**: A. Es un commit ligero (1 archivo `.github/workflows/ci.yml`) y captura regresiones que `next build` no detecta (tests rotos, lint roto). El integration test requiere servicios (`postgres`/`redis`) — GH Actions soporta `services:` directamente.

**Consecuencia para el plan**: si A, 1 commit "ci(github-actions): typecheck + lint + tests + integration con services". Tiempo estimado: 30-45 min.

## 5. Modo de la OAuth consent screen de Google

¿Quién va a usar la app?

- **A) Quedarse en "Testing"** — solo tú como user en la lista de testers. Sin verificación de Google, gratis. Suficiente si nadie más va a usarlo. Las únicas limitaciones: pantalla "Google hasn't verified this app" en el primer login, y máximo ~100 testers manualmente añadidos.
- **B) Publicar y verificar** — proceso de 4-6 semanas con Google, requiere privacy policy + terms of service hosted, scopes "sensitive" sometidos a review. Solo si abres la app a más users.

**Recomendación**: A. El producto es single-user; tú eres el único tester real. Si en algún momento quieres compartirlo, mover a B no es destructivo (es el mismo OAuth Client ID, solo cambia el estado del consent screen).

**Consecuencia para el plan**: si A, no hay trabajo extra. Si B, el plan incluye redactar privacy policy + ToS y submission a Google (tiempos largos de espera).

## 6. Branding mínimo

¿Cómo se presenta visualmente la app?

- **A) Logo + favicon caseros** — 5 min en Excalidraw / icon.kitchen. Algo monocromo y simple.
- **B) Sin branding** — look default Next.js, focus en la UX funcional. Para portfolio personal eso transmite "código serio, no pintura". Para portfolio público con tráfico, peor.

**Recomendación**: A si vas a linkearlo desde portfolio público; B si es estrictamente personal.

**Consecuencia para el plan**: si A, 1 commit "chore(branding): logo + favicon + meta tags". Si B, simplemente añade meta tags útiles (`og:image` placeholder, theme-color) sin diseño.

---

## Cómo respondes

Una respuesta tipo:

```
1. A
2. B (focusflow.dev si está libre, si no .app)
3. A
4. A
5. A
6. A (logo monocromo simple)
```

Con eso escribo `docs/plan/08-deploy-hardening.md` con commits específicos del orden:

1. `chore(env): vars de prod en provider X`
2. `ci(github-actions): pipeline completo`
3. `feat(observability): Sentry`
4. `feat(security): rate limit + headers + CSP`
5. `chore(branding): logo + favicon`
6. `docs(deploy): README sección "Deploy a producción"`
7. `chore(deploy): primer push a prod`

Cada uno con gate verde, env vars exactas según provider, y rollback documentado.

---

## Si NO contestas y empiezas a deployar igual

El plan se quedaría genérico tipo: "decide hosting, decide dominio, decide CI...". Cada commit del plan tendría 2-3 ramas posibles según tu elección. Acabarías leyendo más de lo que ejecutas. Por eso me paro aquí: 6 respuestas de una palabra son cinco minutos de tu tiempo y me ahorran escribir el plan dos veces.

---

**Autor del documento**: Claude Code (Opus 4.7) ejecutando plan 07b. **Branch**: `feat/07b-revision-y-debug`.
