// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";

const listeners: ((hex: string) => void)[] = [];
vi.mock("../api", () => ({
  getAccentColor: vi.fn(async () => "#0063b1"),
  onAccentChanged: vi.fn(async (cb: (hex: string) => void) => {
    listeners.push(cb);
    return () => {
      listeners.splice(listeners.indexOf(cb), 1);
    };
  }),
}));

import { accentVars, applyAccent, initAccent } from "./accent";

const lum = (hex: string): number => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

afterEach(() => document.documentElement.removeAttribute("style"));

test("light accent gets dark text", () => expect(accentVars("#60cdff")["--accent-fg"]).toBe("#000000"));
test("dark accent gets white text", () => expect(accentVars("#0063b1")["--accent-fg"]).toBe("#ffffff"));
test("tints are rgba of the accent", () => expect(accentVars("#0063b1")["--accent-tint-22"]).toBe("rgba(0, 99, 177, 0.22)"));
test("hover is lighter, pressed darker", () => {
  const v = accentVars("#0063b1");
  expect(lum(v["--accent-hover"])).toBeGreaterThan(lum("#0063b1"));
  expect(lum(v["--accent-pressed"])).toBeLessThan(lum("#0063b1"));
});
test("invalid hex falls back to #60cdff", () => expect(accentVars("nope")["--accent"]).toBe("#60cdff"));
test("applyAccent sets CSS variables on root", () => {
  applyAccent("#0063b1", document.documentElement);
  expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#0063b1");
});
test("initAccent applies the current accent and follows live changes", async () => {
  const stop = await initAccent();
  expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#0063b1");
  listeners[0]("#e74856");
  expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#e74856");
  stop();
  expect(listeners).toHaveLength(0);
});

describe("highlight style", () => {
  test("is derived from the accent, not a fixed amber", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync("src/styles/theme.css", "utf8");
    const rule = /\.ProseMirror mark \{[^}]*\}/.exec(css)![0];
    expect(rule).toContain("var(--accent-tint-35)");
    expect(rule).toContain("color: inherit");
    expect(css).not.toContain("#9a6700");
  });
});
