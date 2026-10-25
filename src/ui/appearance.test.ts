// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { applyTransparencyCss, panelAlpha } from "./appearance";

describe("appearance", () => {
  it("keeps today's veil (0.72) as the default and spans opaque to see-through", () => {
    expect(panelAlpha(50)).toBe(0.72);
    expect(panelAlpha(0)).toBe(1);
    expect(panelAlpha(100)).toBe(0.3);
  });
  it("is monotonic and clamps out-of-range or invalid values", () => {
    for (let t = 0; t < 100; t++) expect(panelAlpha(t)).toBeGreaterThan(panelAlpha(t + 1));
    expect(panelAlpha(-20)).toBe(1);
    expect(panelAlpha(500)).toBe(0.3);
    expect(panelAlpha(NaN)).toBe(0.72);
  });
  it("only changes the --panel veil, not the editor background", () => {
    applyTransparencyCss(100);
    expect(document.documentElement.style.getPropertyValue("--panel")).toBe("rgba(32, 32, 32, 0.3)");
    expect(document.documentElement.style.getPropertyValue("--editor-bg")).toBe("");
  });
});
