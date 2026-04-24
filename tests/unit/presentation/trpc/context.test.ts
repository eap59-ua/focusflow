// @vitest-environment node
import { describe, expect, it } from "vitest";

import { extractSessionId } from "@/presentation/trpc/context";

function makeRequest(cookieHeader: string | null): Request {
  const headers = new Headers();
  if (cookieHeader !== null) {
    headers.set("cookie", cookieHeader);
  }
  return new Request("http://localhost/api/trpc/anything", { headers });
}

describe("extractSessionId", () => {
  it("devuelve null si no hay header Cookie", () => {
    expect(extractSessionId(makeRequest(null))).toBe(null);
  });

  it("devuelve null si el Cookie header no contiene la cookie de sesión", () => {
    expect(extractSessionId(makeRequest("other=value; another=x"))).toBe(null);
  });

  it("devuelve el valor de focusflow.session cuando está presente", () => {
    const token =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    expect(
      extractSessionId(
        makeRequest(`focusflow.session=${token}; other=x`),
      ),
    ).toBe(token);
  });

  it("maneja el caso de un Cookie header vacío", () => {
    expect(extractSessionId(makeRequest(""))).toBe(null);
  });
});
