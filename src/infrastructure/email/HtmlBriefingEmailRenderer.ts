import type {
  BriefingEmailRendererPort,
  RenderedEmail,
} from "@/application/ports/BriefingEmailRendererPort";
import type { Briefing } from "@/domain/briefing/Briefing";
import type { User } from "@/domain/user/User";

const DATE_FORMATTER = new Intl.DateTimeFormat("es-ES", { dateStyle: "long" });

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateEs(d: Date): string {
  return DATE_FORMATTER.format(d);
}

function markdownToHtml(md: string): string {
  const escaped = escapeHtml(md);
  const blocks = escaped.split(/\n{2,}/).map((block) => block.trim());
  const out: string[] = [];

  for (const block of blocks) {
    if (block.length === 0) continue;
    const lines = block.split("\n").map((l) => l.trim());
    const allLis = lines.every(
      (l) => l.startsWith("- ") || l.startsWith("* "),
    );
    if (allLis && lines.length > 0) {
      const items = lines.map((l) =>
        l.replace(/^[-*]\s+/, "").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>"),
      );
      out.push(
        `<ul style="margin: 8px 0 16px 20px; padding: 0;">${items
          .map((i) => `<li style="margin: 4px 0;">${i}</li>`)
          .join("")}</ul>`,
      );
    } else {
      const html = block
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\n/g, "<br>");
      out.push(`<p style="margin: 0 0 12px;">${html}</p>`);
    }
  }
  return out.join("\n");
}

export class HtmlBriefingEmailRenderer implements BriefingEmailRendererPort {
  render(briefing: Briefing, user: User): RenderedEmail {
    const dateLabel = formatDateEs(briefing.createdAt);
    const subject = `Tu briefing matutino — ${dateLabel}`;

    const truncatedNote =
      briefing.emailsTruncated > 0
        ? ` (${briefing.emailsTruncated} omitidos por longitud)`
        : "";

    const text = `Hola ${user.displayName},

${briefing.summary}

—
FocusFlow
Generado por ${briefing.modelUsed}, ${briefing.emailsConsidered} emails procesados${truncatedNote}.`;

    const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 640px; margin: 0 auto; padding: 24px; color: #1a1a1a; background: #fafafa;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background: #fff; border-radius: 8px; padding: 32px;">
    <tr><td>
      <h1 style="margin: 0 0 8px; font-size: 22px;">Buenos días, ${escapeHtml(user.displayName)}.</h1>
      <p style="margin: 0 0 24px; color: #666; font-size: 14px;">Tu briefing matutino del ${escapeHtml(dateLabel)}.</p>
      <div style="font-size: 16px; line-height: 1.6;">${markdownToHtml(briefing.summary)}</div>
      <hr style="margin: 32px 0; border: 0; border-top: 1px solid #eee;">
      <p style="margin: 0; font-size: 12px; color: #999;">
        Generado por ${escapeHtml(briefing.modelUsed)} · ${briefing.emailsConsidered} emails procesados${escapeHtml(truncatedNote)}
      </p>
    </td></tr>
  </table>
  <p style="margin: 24px 0 0; text-align: center; font-size: 11px; color: #aaa;">FocusFlow</p>
</body></html>`;

    return { subject, html, text };
  }
}
