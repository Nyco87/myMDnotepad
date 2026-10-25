// @vitest-environment jsdom
import { themeCss } from "../test-support/theme-css";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({
  getSettings: vi.fn(async () => ({ recent_emojis: ["🚀"] })),
  saveSettings: vi.fn(async () => {}),
  updateSettings: vi.fn(async () => ({})),
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
    expect(ids).toEqual(["heading", "bold", "italic", "strike", "highlight", "code", "emoji", "bullet", "ordered", "task", "indent", "outdent", "quote", "alert", "codeblock", "table", "link", "image", "hr", "diagram"]);
    expect((el.querySelector("[data-id=bold]") as HTMLElement).title).toBe("Gras (Ctrl+B)");
  });

  it("alert_button_opens_the_five_kinds_inserts_or_changes_kind", () => {
    const { ed, btn } = setup("texte\n");
    expect(btn("alert").querySelector("svg")).not.toBeNull();
    expect(btn("alert").textContent).toBe("▾");
    expect(btn("alert").title).toBe("Alerte");
    setCursor(ed.view, 2);
    btn("alert").click();
    const labels = () => [...document.querySelectorAll<HTMLElement>(".ctx-menu button")].map((b) => b.textContent);
    expect(labels()).toEqual(["Note", "Astuce", "Important", "Attention", "Danger"]);
    (document.querySelectorAll(".ctx-menu button")[3] as HTMLElement).click();
    expect(ed.view.state.doc.firstChild!.type.name).toBe("alert");
    expect(ed.view.state.doc.firstChild!.attrs.kind).toBe("warning");
    expect(ed.getMarkdown()).toBe("> [!WARNING]\n> texte\n");
    expect(btn("alert").classList.contains("active")).toBe(true);
    // Cursor already inside an alert: the kind changes, nothing is nested.
    btn("alert").click();
    (document.querySelectorAll(".ctx-menu button")[4] as HTMLElement).click();
    expect(ed.getMarkdown()).toBe("> [!CAUTION]\n> texte\n");
  });

  it("diagram button is last and opens the workshop", async () => {
    const { btn, el } = setup("a\n");
    const ids = [...el.querySelectorAll<HTMLElement>(".tb-btn")].map((b) => b.dataset.id);
    expect(ids.indexOf("diagram")).toBe(ids.length - 1);
    expect(btn("diagram").title).toBe("Schéma");
    expect(btn("diagram").textContent).toBe("🔀");
    btn("diagram").click();
    await vi.waitFor(() => expect(document.querySelector(".ws-overlay")).not.toBeNull());
    (document.querySelector(".ws-cancel") as HTMLElement).click();
    expect(document.querySelector(".ws-overlay")).toBeNull();
  });

  it("highlight_button_swatch_uses_the_same_tint_as_the_mark", () => {
    const mark = /\.ProseMirror mark \{[^}]*background: ([^;]+);/.exec(themeCss())![1];
    const btn = /\.tb-btn\.b-highlight \{[^}]*\}/.exec(themeCss())![0];
    expect(btn).toContain(`transparent 60%, ${mark} 60%`);
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

  it("highlight button follows strike and toggles the mark", () => {
    const { ed, btn } = setup("hello\n");
    expect(btn("highlight").title).toBe("Surligner (Ctrl+Shift+H)");
    expect(btn("highlight").previousElementSibling).toBe(btn("strike"));
    setRange(ed.view, 1, 6);
    btn("highlight").click();
    expect(ed.getMarkdown()).toBe("==hello==\n");
  });

  it("invoke runs a popup action anchored on the given element", () => {
    const { ed, el } = setup("hello\n");
    const handle = mountToolbar(el, () => ed.view);
    const anchor = document.createElement("span");
    document.body.appendChild(anchor);
    handle.invoke("link", anchor);
    expect(document.querySelector(".link-pop")).not.toBeNull();
    handle.invoke("nope", anchor); // unknown id: ignored
    handle.destroy();
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
    expect(btn("heading").textContent).toBe("H1 ▾");
    expect(btn("heading").title).toBe("Style de paragraphe");
    setCursor(ed.view, 12);
    tb.refresh();
    expect(btn("heading").textContent).toBe("¶ ▾");
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
