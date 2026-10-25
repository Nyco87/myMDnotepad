// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { resolveLink, routeLink } from "./links";
import { createEditor, type EditorHandle } from "./editor";
import { cursorAtEnd, pressKey, setCursor } from "./test-helpers";

describe("resolveLink", () => {
  it("opens http, https and mailto externally", () => {
    expect(resolveLink("https://a.fr/x?y=1", "n.md")).toEqual({ kind: "external", url: "https://a.fr/x?y=1" });
    expect(resolveLink("HTTP://a.fr", "n.md")).toEqual({ kind: "external", url: "HTTP://a.fr" });
    expect(resolveLink("mailto:a@b.fr", "n.md")).toEqual({ kind: "external", url: "mailto:a@b.fr" });
  });

  it("ignores other schemes and non-note targets", () => {
    for (const h of ["javascript:alert(1)", "file:///C:/x.md", "C:\\x.md", "data:text/html,a", "#ancre", "img.png", "", "ftp://x/y.md"]) {
      expect(resolveLink(h, "n.md")).toEqual({ kind: "ignore" });
    }
  });

  it("resolves relative .md links against the folder of the current note", () => {
    expect(resolveLink("autre.md", "n.md")).toEqual({ kind: "note", rel: "autre.md" });
    expect(resolveLink("autre.md", "Projets/n.md")).toEqual({ kind: "note", rel: "Projets/autre.md" });
    expect(resolveLink("./sub/b.md", "Projets/n.md")).toEqual({ kind: "note", rel: "Projets/sub/b.md" });
    expect(resolveLink("../c.md", "Projets/sub/n.md")).toEqual({ kind: "note", rel: "Projets/c.md" });
    expect(resolveLink("../../c.MD", "Projets/sub/n.md")).toEqual({ kind: "note", rel: "c.MD" });
  });

  it("decodes percent-encoding, drops fragment and query, accepts backslashes", () => {
    expect(resolveLink("mes%20notes/a%20b.md#titre", "n.md")).toEqual({ kind: "note", rel: "mes notes/a b.md" });
    expect(resolveLink("a.md?x=1", "n.md")).toEqual({ kind: "note", rel: "a.md" });
    expect(resolveLink("sub\\a.md", "n.md")).toEqual({ kind: "note", rel: "sub/a.md" });
  });

  it("refuses to climb above the notes root; root-relative links start at the root", () => {
    expect(resolveLink("../../x.md", "a/n.md")).toEqual({ kind: "ignore" });
    expect(resolveLink("/x/y.md", "a/n.md")).toEqual({ kind: "note", rel: "x/y.md" });
  });
});

function make(md: string, noteRel = "Projets/n.md") {
  const openExternal = vi.fn();
  const openNote = vi.fn();
  const ed: EditorHandle = createEditor(document.createElement("div"), {
    markdown: md,
    onChange: () => {},
    noteRel,
    links: () => ({ openExternal, openNote }),
  });
  return { ed, openExternal, openNote };
}

const clickLink = (ed: EditorHandle, href: string, init: MouseEventInit) => {
  const a = ed.view.dom.querySelector(`a[href="${href}"]`)!;
  const ev = new MouseEvent("click", { bubbles: true, cancelable: true, ...init });
  a.dispatchEvent(ev);
  return ev;
};

describe("routeLink", () => {
  it("routes_by_resolveLink_result", () => {
    const h = { openExternal: vi.fn(), openNote: vi.fn() };
    routeLink("https://a.fr", "P/n.md", h);
    routeLink("b.md", "P/n.md", h);
    routeLink("javascript:x", "P/n.md", h);
    expect(h.openExternal).toHaveBeenCalledTimes(1);
    expect(h.openExternal).toHaveBeenCalledWith("https://a.fr");
    expect(h.openNote).toHaveBeenCalledTimes(1);
    expect(h.openNote).toHaveBeenCalledWith("P/b.md");
  });
});

describe("link click handler", () => {
  it("ctrl_click_on_external_link_is_routed_and_default_prevented", () => {
    const { ed, openExternal } = make("[x](https://a.fr)\n");
    const ev = clickLink(ed, "https://a.fr", { ctrlKey: true });
    expect(openExternal).toHaveBeenCalledWith("https://a.fr");
    expect(ev.defaultPrevented).toBe(true);
  });

  it("ctrl_click_on_relative_note_link_opens_the_resolved_note", () => {
    const { ed, openNote } = make("[x](../autre.md)\n", "Projets/sub/n.md");
    clickLink(ed, "../autre.md", { ctrlKey: true });
    expect(openNote).toHaveBeenCalledWith("Projets/autre.md");
  });

  it("ctrl_click_on_other_scheme_is_ignored", () => {
    const { ed, openExternal, openNote } = make("[x](ftp://a.fr/b)\n");
    clickLink(ed, "ftp://a.fr/b", { ctrlKey: true });
    expect(openExternal).not.toHaveBeenCalled();
    expect(openNote).not.toHaveBeenCalled();
  });

  it("plain_click_does_nothing", () => {
    const { ed, openExternal } = make("[x](https://a.fr)\n");
    const ev = clickLink(ed, "https://a.fr", {});
    expect(openExternal).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });

  it("ctrl_enter_on_a_link_opens_it_but_still_toggles_tasks", () => {
    const { ed, openExternal } = make("[x](https://a.fr)\n\n- [ ] t\n");
    setCursor(ed.view, 2);
    expect(pressKey(ed.view, "Enter", { ctrl: true })).toBe(true);
    expect(openExternal).toHaveBeenCalledWith("https://a.fr");
    openExternal.mockClear();
    cursorAtEnd(ed.view);
    pressKey(ed.view, "Enter", { ctrl: true });
    expect(openExternal).not.toHaveBeenCalled();
    expect(ed.getMarkdown()).toContain("- [x] t");
  });

  it("links_get_a_ctrl_click_tooltip_unless_they_have_a_title", () => {
    const { ed } = make('[x](https://a.fr) [y](https://b.fr "Mon titre")\n');
    expect((ed.view.dom.querySelector('a[href="https://a.fr"]') as HTMLElement).title).toBe("Ctrl+clic pour ouvrir");
    expect((ed.view.dom.querySelector('a[href="https://b.fr"]') as HTMLElement).title).toBe("Mon titre");
  });
});
