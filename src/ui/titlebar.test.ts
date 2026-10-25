// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ minimize: async () => {}, toggleMaximize: async () => {}, close: async () => {} }),
}));

import { setLanguage } from "../i18n";
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
});
