// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ minimize: async () => {}, toggleMaximize: async () => {}, close: async () => {} }),
}));

import { setLanguage } from "../i18n";
import { themeCss } from "../test-support/theme-css";
import { mountTitlebar, SETTINGS_TAB } from "./titlebar";

beforeEach(() => {
  document.body.textContent = "";
  setLanguage("fr");
});

function mount() {
  const el = document.createElement("header");
  document.body.appendChild(el);
  const h = { onActivate: vi.fn(), onClose: vi.fn(), onNew: vi.fn(), onSettings: vi.fn() };
  return { el, h, bar: mountTitlebar(el, h) };
}

describe("titlebar", () => {
  it("has a ⚙ button (no more « ⋯ ») that asks for the settings tab", () => {
    const { el, h } = mount();
    const gear = el.querySelector<HTMLButtonElement>(".titlebar-settings")!;
    expect(gear.textContent).toBe("⚙");
    expect(el.textContent).not.toContain("⋯");
    gear.click();
    expect(h.onSettings).toHaveBeenCalledTimes(1);
  });

  it("renders the settings tab like a tab, activates and closes it by its special id", () => {
    const { el, h, bar } = mount();
    bar.render([
      { rel: "a.md", title: "a", active: false, missing: false },
      { rel: SETTINGS_TAB, title: "Réglages", active: true, missing: false },
    ]);
    const tab = el.querySelector<HTMLElement>(".tab-settings")!;
    expect(tab.classList.contains("active")).toBe(true);
    expect(tab.textContent).toContain("Réglages");
    expect(tab.title).toBe("");
    tab.click();
    expect(h.onActivate).toHaveBeenCalledWith(SETTINGS_TAB);
    tab.querySelector<HTMLButtonElement>(".tab-close")!.click();
    expect(h.onClose).toHaveBeenCalledWith(SETTINGS_TAB);
  });

  it("follows the language: tooltips and the settings tab label", () => {
    const { el, bar } = mount();
    bar.render([{ rel: SETTINGS_TAB, title: "Réglages", active: true, missing: false }]);
    setLanguage("en");
    expect(el.querySelector(".tab-settings")!.textContent).toContain("Settings");
    expect(el.querySelector<HTMLElement>(".titlebar-settings")!.title).toBe("Settings");
    expect(el.querySelector<HTMLElement>(".tab-new")!.title).toBe("New note (Ctrl+N)");
    expect(el.querySelector<HTMLElement>(".win-min")!.title).toBe("Minimize");
  });

  const tabs = (n: number, active = 0) =>
    Array.from({ length: n }, (_, i) => ({ rel: `n${i}.md`, title: `n${i}`, active: i === active, missing: false }));
  const dims = (strip: HTMLElement, scrollWidth: number, clientWidth: number) => {
    Object.defineProperty(strip, "scrollWidth", { configurable: true, value: scrollWidth });
    Object.defineProperty(strip, "clientWidth", { configurable: true, value: clientWidth });
  };

  it("gives tabs a 140-220px width range and the new-tab button lives outside the scroll strip", () => {
    const css = themeCss();
    expect(css).toMatch(/\.tab \{[^}]*min-width: 140px[^}]*max-width: 220px/);
    const { el, bar } = mount();
    bar.render(tabs(2));
    expect(el.querySelector(".tabstrip .tab-new")).toBeNull();
    expect(el.querySelector(".tab-new")).not.toBeNull();
    expect(el.querySelector<HTMLElement>(".tab")!.title).toBe("n0.md");
  });

  it("shows the arrows only when tabs overflow, and clicking scrolls by one tab", () => {
    const { el, bar } = mount();
    const strip = el.querySelector<HTMLElement>(".tabstrip")!;
    const prev = el.querySelector<HTMLButtonElement>(".tab-scroll-prev")!;
    const next = el.querySelector<HTMLButtonElement>(".tab-scroll-next")!;
    dims(strip, 300, 500);
    bar.render(tabs(2));
    expect(prev.hidden && next.hidden).toBe(true);
    dims(strip, 900, 500);
    bar.render(tabs(6));
    expect(prev.hidden).toBe(false);
    expect(next.hidden).toBe(false);
    expect(prev.disabled).toBe(true);
    expect(next.disabled).toBe(false);
    const scrollBy = vi.fn();
    strip.scrollBy = scrollBy as unknown as typeof strip.scrollBy;
    next.click();
    expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ left: 160 }));
    strip.scrollLeft = 400;
    strip.dispatchEvent(new Event("scroll"));
    expect(next.disabled).toBe(true);
    expect(prev.disabled).toBe(false);
    prev.click();
    expect(scrollBy).toHaveBeenLastCalledWith(expect.objectContaining({ left: -160 }));
  });

  it("has i18n tooltips on the arrows and scrolls horizontally on wheel", () => {
    const { el, bar } = mount();
    const strip = el.querySelector<HTMLElement>(".tabstrip")!;
    expect(el.querySelector<HTMLElement>(".tab-scroll-prev")!.title).toBe("Onglets précédents");
    setLanguage("en");
    expect(el.querySelector<HTMLElement>(".tab-scroll-next")!.title).toBe("Next tabs");
    dims(strip, 900, 500);
    bar.render(tabs(6));
    const ev = new WheelEvent("wheel", { deltaY: 50, cancelable: true });
    strip.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(strip.scrollLeft).toBe(50);
  });

  it("scrolls the active tab into view on every render", () => {
    const spy = vi.fn();
    (Element.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = spy;
    const { el, bar } = mount();
    bar.render(tabs(5, 3));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.contexts[0]).toBe(el.querySelector(".tab.active"));
  });
});
