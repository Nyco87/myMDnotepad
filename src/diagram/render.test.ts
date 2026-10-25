// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  loads: 0,
  initialize: vi.fn(),
  render: vi.fn(async (_id: string, _code: string) => ({ svg: "<svg>ok</svg>" })),
}));
vi.mock("mermaid", () => {
  m.loads++;
  return { default: { initialize: m.initialize, render: m.render } };
});

import { renderMermaid } from "./render";

beforeEach(() => {
  m.render.mockClear();
  m.initialize.mockClear();
});

describe("renderMermaid", () => {
  it("does not import mermaid before the first call", async () => {
    expect(m.loads).toBe(0);
    await renderMermaid('pie\n    "a" : 1\n');
    expect(m.loads).toBe(1);
    await renderMermaid('pie\n    "b" : 1\n');
    expect(m.loads).toBe(1);
  });

  it("returns the svg", async () => {
    const r = await renderMermaid('pie\n    "a" : 1\n');
    expect(r).toEqual({ ok: true, svg: "<svg>ok</svg>" });
  });

  it("returns the error message instead of throwing", async () => {
    m.render.mockRejectedValueOnce(new Error("Parse error on line 2"));
    const r = await renderMermaid("pie\n???");
    expect(r).toEqual({ ok: false, error: "Parse error on line 2" });
  });

  it("initializes securely with the accent as border color and re-initializes when it changes", async () => {
    document.documentElement.style.setProperty("--accent", "#112233");
    await renderMermaid("pie\n");
    const cfg = m.initialize.mock.calls[m.initialize.mock.calls.length - 1][0];
    expect(cfg.securityLevel).toBe("strict");
    expect(cfg.startOnLoad).toBe(false);
    expect(cfg.themeVariables.primaryBorderColor).toBe("#112233");
    const n = m.initialize.mock.calls.length;
    await renderMermaid("pie\n");
    expect(m.initialize.mock.calls.length).toBe(n);
    document.documentElement.style.setProperty("--accent", "#445566");
    await renderMermaid("pie\n");
    expect(m.initialize.mock.calls.length).toBe(n + 1);
  });
});
