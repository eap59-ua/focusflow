// @vitest-environment node
import { describe, expect, it } from "vitest";

import { Briefing } from "@/domain/briefing/Briefing";
import { Email } from "@/domain/user/Email";
import { HashedPassword } from "@/domain/user/HashedPassword";
import { User } from "@/domain/user/User";
import { HtmlBriefingEmailRenderer } from "@/infrastructure/email/HtmlBriefingEmailRenderer";

function makeUser(displayName: string = "Jane") {
  return User.create({
    email: Email.create("user@example.com"),
    hashedPassword: HashedPassword.fromHash("$2a$10$fake"),
    displayName,
  });
}

function makeBriefing(opts: {
  summary?: string;
  emailsConsidered?: number;
  emailsTruncated?: number;
} = {}) {
  return Briefing.create({
    userId: "00000000-0000-0000-0000-000000000001",
    summary:
      opts.summary ??
      "Hoy tienes 3 reuniones importantes y dos respuestas pendientes a clientes.",
    emailsConsidered: opts.emailsConsidered ?? 5,
    emailsTruncated: opts.emailsTruncated ?? 0,
    tokensUsedInput: 1000,
    tokensUsedOutput: 200,
    modelUsed: "gpt-4o-mini",
    promptVersion: "v1.0.0",
  });
}

describe("HtmlBriefingEmailRenderer", () => {
  const renderer = new HtmlBriefingEmailRenderer();

  it("subject contiene 'briefing matutino' + fecha en español", () => {
    const user = makeUser();
    const briefing = makeBriefing();
    const { subject } = renderer.render(briefing, user);
    expect(subject).toMatch(/briefing matutino/i);
    expect(subject).toMatch(/\d{1,2} de [a-zA-Záéíóúñ]+/);
  });

  it("HTML incluye displayName del user y el summary", () => {
    const user = makeUser("Alice");
    const briefing = makeBriefing({
      summary:
        "Tienes 2 reuniones urgentes hoy y debes responder a un cliente importante por la mañana.",
    });
    const { html } = renderer.render(briefing, user);
    expect(html).toContain("Alice");
    expect(html).toContain("reuniones urgentes");
    expect(html).toContain("gpt-4o-mini");
  });

  it("escapa HTML en displayName y otras inyecciones", () => {
    const user = makeUser('<script>alert("xss")</script>');
    const briefing = makeBriefing();
    const { html } = renderer.render(briefing, user);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("texto plano contiene displayName + summary completo", () => {
    const user = makeUser("Bob");
    const briefing = makeBriefing({
      summary:
        "Resumen del día con 4 puntos clave que requieren atención inmediata por tu parte.",
    });
    const { text } = renderer.render(briefing, user);
    expect(text).toContain("Hola Bob");
    expect(text).toContain("4 puntos clave");
    expect(text).not.toContain("<");
  });

  it("incluye emailsTruncated cuando > 0", () => {
    const user = makeUser();
    const briefing = makeBriefing({
      emailsConsidered: 50,
      emailsTruncated: 12,
    });
    const { text, html } = renderer.render(briefing, user);
    expect(text).toContain("12 omitidos");
    expect(html).toContain("12 omitidos");
  });

  it("NO incluye nota de truncado cuando emailsTruncated == 0", () => {
    const user = makeUser();
    const briefing = makeBriefing({
      emailsConsidered: 5,
      emailsTruncated: 0,
    });
    const { text } = renderer.render(briefing, user);
    expect(text).not.toContain("omitidos");
  });

  it("markdown ligero: **negritas** y listas - se convierten a HTML", () => {
    const user = makeUser();
    const briefing = makeBriefing({
      summary: `**Lo más urgente**:

- Llamada con cliente
- Revisar PR del equipo
- Confirmar reunión jueves`,
    });
    const { html } = renderer.render(briefing, user);
    expect(html).toContain("<strong>Lo más urgente</strong>");
    expect(html).toContain("<ul");
    expect(html).toContain("<li");
    expect(html).toContain("Llamada con cliente");
  });
});
