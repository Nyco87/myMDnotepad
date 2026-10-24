// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({
  getSettings: vi.fn(async () => ({ recent_emojis: ["🚀"] })),
  saveSettings: vi.fn(async () => {}),
  saveImage: vi.fn(),
  importImage: vi.fn(),
  resolveAsset: (r: string) => r,
}));

import { mountToolbar } from "./toolbar";
import { makeEditor, setRange, setCursor } from "../editor/test-helpers";

function setup(md: string) {
  const ed = makeEditor(md);
  document.body.appendChild(ed.view.dom);
  const el = document.createElement("div");
  document.body.appendChild(el);
  const tb = mountToolbar(el, () => ed.view);
  const btn = (id: string) => el.querySelector(`[data-id=${id}]`) as HTMLButtonElement;
  return { ed, el, tb, btn };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("toolbar", () => {
  it("has the buttons in the specified order with French tooltips", () => {
    const { el } = setup("a\n");
    const ids = [...el.querySelectorAll<HTMLElement>(".tb-btn")].map((b) => b.dataset.id);
    expect(ids).toEqual(["bold", "italic", "strike", "code", "heading", "bullet", "ordered", "task", "quote", "codeblock", "table", "link", "image", "hr", "emoji"]);
    expect((el.querySelector("[data-id=bold]") as HTMLElement).title).toBe("Gras (Ctrl+B)");
  });

  it("symbols_button_uses_omega_and_tooltip", () => {
    const { btn } = setup("a\n");
    expect(btn("emoji").textContent).toBe("Ω");
    expect(btn("emoji").title).toBe("Symboles");
  });

  it("strike_button_is_explicit", () => {
    const { btn } = setup("a\n");
    expect(btn("strike").title).toBe("Barré (Ctrl+Shift+X)");
    expect(btn("strike").querySelector("s")?.textContent).toBe("S");
  });

  it("applies bold on click and reflects it as active", () => {
    const { ed, btn, tb } = setup("hello\n");
    setRange(ed.view, 1, 6);
    btn("bold").click();
    expect(ed.getMarkdown()).toBe("**hello**\n");
    tb.refresh();
    expect(btn("bold").classList.contains("active")).toBe(true);
    expect(btn("italic").classList.contains("active")).toBe(false);
  });

  it("does not steal focus on mousedown", () => {
    const { btn } = setup("a\n");
    const ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    btn("bold").dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("shows the current heading and block state", () => {
    const { ed, btn, tb } = setup("# Title\n\n- item\n");
    setCursor(ed.view, 2);
    tb.refresh();
    expect(btn("heading").textContent).toBe("Titre 1 ▾");
    setCursor(ed.view, 12);
    tb.refresh();
    expect(btn("heading").textContent).toBe("Paragraphe ▾");
    expect(btn("bullet").classList.contains("active")).toBe(true);
  });

  it("link popover: Enter applies, empty href removes, Escape cancels", () => {
    const { ed, btn } = setup("hello\n");
    setRange(ed.view, 1, 6);
    btn("link").click();
    const input = () => document.querySelector(".link-pop input") as HTMLInputElement;
    input().value = "https://a.b";
    input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(ed.getMarkdown()).toBe("[hello](https://a.b)\n");
    expect(document.querySelector(".link-pop")).toBeNull();

    setCursor(ed.view, 3);
    btn("link").click();
    expect(input().value).toBe("https://a.b");
    input().value = "";
    input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(ed.getMarkdown()).toBe("hello\n");

    setRange(ed.view, 1, 6);
    btn("link").click();
    input().value = "https://x.y";
    input().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(ed.getMarkdown()).toBe("hello\n");
    expect(document.querySelector(".link-pop")).toBeNull();
  });

  it("prefills the link field when the selection looks like a URL", () => {
    const { ed, btn } = setup("https://example.com\n");
    setRange(ed.view, 1, 20);
    btn("link").click();
    expect((document.querySelector(".link-pop input") as HTMLInputElement).value).toBe("https://example.com");
  });

  it("emoji button opens the palette with recents and inserts at the cursor", async () => {
    const { ed, btn } = setup("ab\n");
    setCursor(ed.view, 2);
    btn("emoji").click();
    await vi.waitFor(() => expect(document.querySelector(".emoji-palette")).not.toBeNull());
    (document.querySelector(".emoji-btn") as HTMLElement).click();
    expect(ed.getMarkdown()).toBe("a🚀b\n");
  });
});
