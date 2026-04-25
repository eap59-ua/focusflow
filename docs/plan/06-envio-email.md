# Paso 6 — Envío del email diario del Briefing

Sexta fase del MVP. Construye el job BullMQ que toma un `Briefing` ya generado, lo renderiza como email HTML/texto plano, y lo envía al usuario. Para dev usamos **Mailpit** (SMTP local que captura emails sin enviarlos), para prod nodemailer + SMTP configurable.

**Dependencia de entrada:** Paso 5 disponible (`Briefing` entity persistida, `BriefingRepositoryPort.findById`).

**Dependencia de salida:** desbloquea Paso 7 (scheduling diario), que orquesta el flow `sync → generate → send`.

## Aviso sobre escritura predictiva

Escrito antes de ejecutar Paso 5. Si el repo real diverge de las asunciones, parar y reportar.

## Pre-requisitos verificables

1. `git status` limpio sobre `feat/05-briefing-openai`.
2. Tests verdes.
3. `docker compose ps` — `postgres` y `redis` running.
4. Mailpit todavía no está en `docker-compose.yml` — este plan lo añade.

## Branch

`feat/06-envio-email` desde `feat/05-briefing-openai`.

## Deps pre-autorizadas

```bash
pnpm add nodemailer@^6
pnpm add -D @types/nodemailer
```

Justificación:
- `nodemailer`: estándar de envío de email en Node.js. Soporta SMTP, sendmail, varias APIs. Para dev usaremos su transport SMTP apuntando a Mailpit local; para prod, mismo transport apuntando a SMTP de provider real (Resend, SES, etc., decisión de Paso 8).
- `@types/nodemailer`: nodemailer no incluye tipos propios (a diferencia de cookie@1+).

**NO añadir:**
- `@react-email/components` ni libs de templating React. Para MVP usamos template HTML inline simple — añadir React Email es scope de Paso 8 si quieres templates más sofisticados.
- `mjml` por la misma razón.
- Provider SDKs (`resend`, `@aws-sdk/client-ses`) — la decisión de provider se hace en Paso 8. Por ahora abstraemos vía SMTP genérico.

## Variables de entorno

Añadir al `.env.example`:

```
# Email sending (dev: Mailpit local; prod: configurar SMTP real en Paso 8)
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
EMAIL_FROM_ADDRESS=focusflow@local.dev
EMAIL_FROM_NAME=FocusFlow
```

Defaults apuntan a Mailpit local. Cuando llegue Paso 8 se cambian al provider real.

## Modificar `docker-compose.yml`

Añadir servicio Mailpit:

```yaml
services:
  # ... postgres, redis ya existentes
  mailpit:
    image: axllent/mailpit:latest
    restart: unless-stopped
    ports:
      - "1025:1025"   # SMTP
      - "8025:8025"   # Web UI
    environment:
      MP_MAX_MESSAGES: 5000
      MP_DATABASE: /data/mailpit.db
    volumes:
      - mailpit-data:/data

volumes:
  mailpit-data:
  # ... otros volúmenes existentes
```

Mailpit UI accessible en `http://localhost:8025` para inspeccionar emails enviados durante dev/smoke.

## Modelo de datos

**Sin cambios al schema**. El estado de envío (success/fail, retries) lo tracka BullMQ; no necesitamos tabla `briefing_emails_sent`. Si en post-MVP queremos historial de envíos para dashboard, se añade entonces.

## Domain

`src/domain/briefing/EmailDelivery.ts` (en el mismo namespace que `Briefing`):

Value Object inmutable que representa una entrega exitosa:

```ts
{
  briefingId: string
  recipientEmail: string
  sentAt: Date
  messageId: string  // SMTP Message-Id devuelto por nodemailer
}
```

No es entidad porque no se persiste en este paso. Si Paso 7 decide trackear, se promueve a entidad.

## Application

Port `src/application/ports/EmailSenderPort.ts`:

```ts
export interface SendEmailParams {
  to: { email: string, name?: string }
  from: { email: string, name?: string }
  subject: string
  html: string
  text: string  // fallback texto plano (clientes sin HTML, accesibilidad)
}
export interface EmailSenderPort {
  send(params: SendEmailParams): Promise<{ messageId: string }>
}
```

Use case `src/application/use-cases/briefing/SendBriefingEmail.ts`:

Input: `{ briefingId: string }`.

Flujo:
1. `BriefingRepositoryPort.findById(briefingId)` → si null → `BriefingNotFoundError`.
2. `UserRepositoryPort.findById(briefing.userId)` → si null → `UserNotFoundError`.
3. Construir contenido vía `BriefingEmailRenderer` (puerto separado para testabilidad, ver abajo).
4. `EmailSenderPort.send({ to: { email: user.email }, from: { email: env.EMAIL_FROM_ADDRESS, name: env.EMAIL_FROM_NAME }, subject, html, text })`.
5. Retornar `EmailDelivery` value object.

Nuevo puerto `BriefingEmailRendererPort`:

```ts
export interface RenderedEmail {
  subject: string
  html: string
  text: string
}
export interface BriefingEmailRendererPort {
  render(briefing: Briefing, user: User): RenderedEmail
}
```

Razón de extraer renderer como puerto: separar lógica de presentación (templates) de orquestación (use case). Tests unitarios del use case mockean al renderer; tests del renderer son aislados.

## Infrastructure

`src/infrastructure/adapters/NodemailerEmailSender.ts`:

```ts
import nodemailer from 'nodemailer'

export class NodemailerEmailSender implements EmailSenderPort {
  private transporter: nodemailer.Transporter

  constructor(config: { host: string, port: number, secure: boolean, user?: string, pass?: string }) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.user && config.pass ? { user: config.user, pass: config.pass } : undefined,
    })
  }

  async send(params: SendEmailParams): Promise<{ messageId: string }> {
    const info = await this.transporter.sendMail({
      from: `"${params.from.name ?? ''}" <${params.from.email}>`,
      to: `"${params.to.name ?? ''}" <${params.to.email}>`,
      subject: params.subject,
      html: params.html,
      text: params.text,
    })
    return { messageId: info.messageId }
  }
}
```

`src/infrastructure/email/HtmlBriefingEmailRenderer.ts`:

Implementa `BriefingEmailRendererPort`. Template HTML inline minimalista (table-based para compatibilidad con clientes email; sin Tailwind ni JS):

```ts
export class HtmlBriefingEmailRenderer implements BriefingEmailRendererPort {
  render(briefing: Briefing, user: User): RenderedEmail {
    const subject = `Tu briefing matutino — ${formatDateES(briefing.createdAt)}`
    
    const text = `Hola ${user.displayName},

${briefing.summary}

—
FocusFlow
Generado por ${briefing.modelUsed}, ${briefing.emailsConsidered} emails procesados.`

    const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 640px; margin: 0 auto; padding: 24px; color: #1a1a1a; background: #fafafa;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background: #fff; border-radius: 8px; padding: 32px;">
    <tr><td>
      <h1 style="margin: 0 0 8px; font-size: 22px;">Buenos días, ${escapeHtml(user.displayName)}.</h1>
      <p style="margin: 0 0 24px; color: #666; font-size: 14px;">Tu briefing matutino del ${formatDateES(briefing.createdAt)}.</p>
      <div style="font-size: 16px; line-height: 1.6;">${markdownToHtml(briefing.summary)}</div>
      <hr style="margin: 32px 0; border: 0; border-top: 1px solid #eee;">
      <p style="margin: 0; font-size: 12px; color: #999;">
        Generado por ${escapeHtml(briefing.modelUsed)} · ${briefing.emailsConsidered} emails procesados${briefing.emailsTruncated > 0 ? ` (${briefing.emailsTruncated} omitidos por longitud)` : ''}
      </p>
    </td></tr>
  </table>
  <p style="margin: 24px 0 0; text-align: center; font-size: 11px; color: #aaa;">FocusFlow · <a href="http://localhost:3030/settings" style="color: #aaa;">Ajustes</a></p>
</body></html>`

    return { subject, html, text }
  }
}
```

Helpers:
- `escapeHtml(s)`: escapado básico de `& < > " '`. Implementar inline, sin librería.
- `formatDateES(d)`: `Intl.DateTimeFormat('es-ES', { dateStyle: 'long' }).format(d)`. Sin librería.
- `markdownToHtml(s)`: el summary de OpenAI viene en markdown ligero (negritas, listas). Implementar conversión MUY simple inline (regex para `**bold**`, `- item`, dobles saltos como párrafos). Si Claude Code prefiere usar `marked` u otra librería, **parar y preguntar** — la conversión inline es 30 líneas y evita una dep.

`src/infrastructure/container.ts`: cablear `NodemailerEmailSender` con env vars y `HtmlBriefingEmailRenderer`.

## Jobs

Modificar `src/jobs/queues.ts`:

```ts
export const sendBriefingEmailQueue = new Queue('send-briefing-email', { connection })
```

`src/jobs/workers/send-briefing-email.ts`:

```ts
export interface SendBriefingEmailJobData {
  briefingId: string
}
export interface SendBriefingEmailJobResult {
  messageId: string
}

export function buildSendBriefingEmailWorker(deps: {
  sendBriefingEmail: SendBriefingEmail
  connection: ConnectionOptions
}): Worker<SendBriefingEmailJobData, SendBriefingEmailJobResult> {
  return new Worker(
    'send-briefing-email',
    async (job) => {
      const delivery = await deps.sendBriefingEmail.execute(job.data)
      return { messageId: delivery.messageId }
    },
    { 
      connection: deps.connection,
      attempts: 3,
      backoff: { type: 'exponential', delay: 60000 }, // 1m, 2m, 4m
    },
  )
}
```

## Commits (7 commits)

1. `chore(infra): añadir Mailpit a docker-compose para envío de email en dev`
2. `feat(domain): EmailDelivery value object`
3. `feat(application): EmailSenderPort + BriefingEmailRendererPort + SendBriefingEmail use case`
4. `feat(infra): NodemailerEmailSender adapter`
5. `feat(infra): HtmlBriefingEmailRenderer con template inline`
6. `feat(jobs): cola send-briefing-email + worker con retry exponencial`
7. `test(integration): SendBriefingEmail end-to-end contra Mailpit`

## Testing

**Unit tests** (~12 nuevos): use case con mocks de los 3 puertos, renderer con varios casos (briefing con/sin truncado, user con/sin displayName, summary corto/largo).

**Integration tests** (~3 nuevos): worker procesa job, contenido renderizado correcto en Mailpit (consultar API de Mailpit en `http://localhost:8025/api/v1/messages` para verificar), retry al fallar (mockear transporter para fallar las 2 primeras veces).

**Smoke real:** con Mailpit corriendo (`docker compose up -d mailpit`), ejecutar manualmente:

```ts
// scripts/smoke-send-email.ts (no commitear, solo dev)
import { container } from '../src/infrastructure/container'
const briefingId = '<id de briefing existente>'
await container.sendBriefingEmail.execute({ briefingId })
console.log('Enviado. Ver en http://localhost:8025')
```

Visitar Mailpit UI, ver el email renderizado.

## Criterios de aceptación

- [ ] 7 commits, gate verde.
- [ ] `pnpm test:unit` ≥ 159/159.
- [ ] `pnpm test:integration` ≥ 27/27.
- [ ] Mailpit en docker-compose, accessible en `http://localhost:8025`.
- [ ] HTML email pasa validación HTML básica (sin tags rotos).
- [ ] Texto plano del email es legible sin HTML (accesibilidad).
- [ ] No hay React Email, marked, ni libs de templating añadidas.
- [ ] Cobertura ≥ 80% en `domain/briefing/EmailDelivery` y `application/use-cases/briefing/SendBriefingEmail`.

## Desviaciones aceptables

- Cambios menores en el HTML del template para mejor compatibilidad con clientes email (Outlook tiene cuirks).
- Reordenar secciones del email si mejora UX.
- Añadir el preheader/preview text invisible al inicio del HTML.

## Desviaciones que requieren parar

- Instalar `react-email`, `mjml`, `marked`, `markdown-it`, etc.
- Persistir histórico de envíos en DB (eso es post-MVP).
- Cambiar de Mailpit a otro mock SMTP sin justificación.

## Al terminar

Reporte estándar.

**Branch siguiente:** `feat/07-scheduling-cron` desde `feat/06-envio-email`.
