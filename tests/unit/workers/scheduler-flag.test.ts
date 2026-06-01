import { describe, expect, it } from "vitest";

import { isSchedulerDisabled } from "@/workers/scheduler-flag";

// S6 (audit): el scheduler está habilitado por defecto; sólo el valor explícito
// "false" lo desactiva. Pinea la semántica documentada en el README.
describe("isSchedulerDisabled", () => {
  it("true SÓLO cuando el valor es exactamente 'false'", () => {
    expect(isSchedulerDisabled("false")).toBe(true);
  });

  it("false cuando es undefined (sin setear = habilitado)", () => {
    expect(isSchedulerDisabled(undefined)).toBe(false);
  });

  it("false cuando el valor es 'true'", () => {
    expect(isSchedulerDisabled("true")).toBe(false);
  });

  it("false con cualquier otro valor (sólo 'false' desactiva)", () => {
    expect(isSchedulerDisabled("0")).toBe(false);
    expect(isSchedulerDisabled("FALSE")).toBe(false);
  });
});
