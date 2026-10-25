// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const r = vi.hoisted(() => ({
  render: vi.fn(),
  running: 0,
  maxRunning: 0,
  accent: "#60cdff",
}));
vi.mock("../diagram/render", () => ({
  renderMermaid: (code: string) => r.render(code),
  diagramAccent: () => r.accent,
}));

import { createEditor } from "./editor";
import { clearDiagramCache } from "./mermaid-view";

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await new Promise((res) => setTimeout(res, 5));
};

const PIE = '```mermaid\npie\n    "a" : 1\n```\n';

const editors: { destroy(): void }[] = [];

function make(md: string, onEditDiagram?: (pos: number, code: string) => void) {
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  const ed = createEditor(mount, { markdown: md, onChange: () => {}, noteRel: "a.md", onEditDiagram });
  editors.push(ed);
  return { ed, mount };
}

beforeEach(() => {
  editors.splice(0).forEach((e) => e.destroy());
  document.body.innerHTML = "";
  r.accent = "#60cdff";
  clearDiagramCache();
  r.running = 0;
  r.maxRunning = 0;
  r.render.mockReset();
  r.render.mockImplementation(async (code: string) => {
    r.running++;
    r.maxRunning = Math.max(r.maxRunning, r.running);
    await new Promise((res) => setTimeout(res, 3));
    r.running--;
    return { ok: true, svg: `<svg data-code="${code.length}"><text>dessin</text></svg>` };
  });
});

describe("mermaid node view", () => {
  it("shows the drawing in .diagram and never the code", async () => {
    const { mount } = make(PIE);
    await flush();
    const diagram = mount.querySelector(".diagram")!;
    expect(diagram.querySelector("svg")).not.toBeNull();
    expect(mount.querySelector("pre")).toBeNull();
    expect(mount.textContent).not.toContain('"a" : 1');
  });

  it("shows an error frame with the message and the code in a <pre>", async () => {
    r.render.mockResolvedValue({ ok: false, error: "Parse error on line 2" });
    const { mount } = make("```mermaid\npie\n???\n```\n");
    await flush();
    const err = mount.querySelector(".diagram-error")!;
    expect(err.textContent).toContain("Parse error on line 2");
    expect(err.querySelector("pre")!.textContent).toBe("pie\n???");
  });

  it("leaves the markdown strictly identical", async () => {
    const md = '```mermaid\n%%{init: {"theme": "dark"}}%%\npie\n  "a":1\n\n\n```\n';
    r.render.mockResolvedValue({ ok: false, error: "x" });
    const { ed } = make(md);
    await flush();
    expect(ed.getMarkdown()).toBe(md);
    expect(make(PIE).ed.getMarkdown()).toBe(PIE);
  });

  it("calls onEditDiagram(pos, code) on click", async () => {
    const onEdit = vi.fn();
    const { mount } = make("texte\n\n" + PIE, onEdit);
    await flush();
    (mount.querySelector(".diagram") as HTMLElement).click();
    expect(onEdit).toHaveBeenCalledWith(7, 'pie\n    "a" : 1');
  });

  it("draws consecutive diagrams one at a time", async () => {
    const md = "```mermaid\npie\n    \"a\" : 1\n```\n\n```mermaid\npie\n    \"b\" : 2\n```\n\n```mermaid\npie\n    \"c\" : 3\n```\n";
    const { mount } = make(md);
    await flush();
    await flush();
    expect(r.render).toHaveBeenCalledTimes(3);
    expect(r.maxRunning).toBe(1);
    expect(mount.querySelectorAll(".diagram svg").length).toBe(3);
  });

  it("keeps ordinary code blocks as code", async () => {
    const { mount, ed } = make("```ts\nconst a = 1;\n```\n");
    await flush();
    expect(mount.querySelector("pre code")!.textContent).toBe("const a = 1;");
    expect(mount.querySelector("pre")!.getAttribute("data-language")).toBe("ts");
    expect(r.render).not.toHaveBeenCalled();
    expect(ed.getMarkdown()).toBe("```ts\nconst a = 1;\n```\n");
  });

  it("an empty mermaid block shows a hint without calling mermaid", async () => {
    const { mount } = make("```mermaid\n```\n");
    await flush();
    expect(mount.querySelector(".diagram-error")).not.toBeNull();
    expect(r.render).not.toHaveBeenCalled();
  });

  it("draws again on accent-changed", async () => {
    const { mount } = make(PIE);
    await flush();
    r.render.mockClear();
    r.accent = "#ff0000";
    document.dispatchEvent(new CustomEvent("accent-changed", { detail: "#ff0000" }));
    await flush();
    expect(r.render).toHaveBeenCalledTimes(1);
    expect(mount.querySelector(".diagram svg")).not.toBeNull();
  });
});
