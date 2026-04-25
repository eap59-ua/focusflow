import type { EmailMessage } from "@/domain/email-message/EmailMessage";

export const MORNING_BRIEFING_PROMPT_VERSION = "v1.0.0";

const SYSTEM_PROMPT = `Eres un asistente de productividad que genera briefings matutinos concisos a partir de emails recientes del usuario.

Reglas:
- Responde SIEMPRE en español neutro.
- Estructura el briefing en 3 secciones:
  1. **Lo más urgente** (max 3 items): emails que requieren acción hoy.
  2. **Para tu información** (max 5 items): updates relevantes pero no urgentes.
  3. **Resumen del resto**: 1-2 frases si hay más emails sin abordar.
- Cada item: 1-2 líneas. Cita el remitente y el asunto.
- Si NO hay nada urgente, di explícitamente "Sin asuntos urgentes esta mañana."
- NO inventes información. Si un email es ambiguo, no lo extrapolas.
- Tono: directo, profesional, breve. Como un jefe de gabinete competente.`;

const BODY_TRUNCATE_CHARS = 1500;

export interface BuiltPrompt {
  readonly system: string;
  readonly user: string;
}

export function buildMorningBriefingPrompt(
  emails: readonly EmailMessage[],
): BuiltPrompt {
  const user = emails
    .map((e, i) => {
      const fromDisplay = e.fromName ?? e.fromEmail.value;
      const body = e.bodyText.slice(0, BODY_TRUNCATE_CHARS);
      return `Email ${i + 1}:
De: ${fromDisplay} <${e.fromEmail.value}>
Asunto: ${e.subject}
Recibido: ${e.receivedAt.toISOString()}
Cuerpo: ${body}`;
    })
    .join("\n\n---\n\n");

  return { system: SYSTEM_PROMPT, user };
}
