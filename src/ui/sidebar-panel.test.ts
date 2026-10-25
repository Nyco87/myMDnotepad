// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { themeCss } from "../test-support/theme-css";
import { clampWidth, mountSidebarPanel, SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from "./sidebar-panel";

afterEach(() => {
  document.body.innerHTML = "";
});

function setup(opts: { width?: number | null; collapsed?: boolean } = {}) {
  const host = document.createElement("div");
  host.innerHTML = '<button class="sb-new"></button><div class="sb-tree"></div>';
  document.body.appendChild(host);
  const onChange = vi.fn();
  const newNote = vi.fn();
  const panel = mountSidebarPanel(host, { width: opts.width ?? null, collapsed: opts.collapsed ?? false, onChange, newNote });
  const q = <T extends HTMLElement>(s: string) => host.querySelector(s) as T;
  return { host, onChange, newNote, panel, q };
}

const mouse = (type: string, x: number) => new MouseEvent(type, { bubbles: true, clientX: x });

describe("sidebar panel", () => {
  it("clamps_width_between_160_and_480", () => {
    expect(clampWidth(10)).toBe(SIDEBAR_MIN_WIDTH);
    expect(clampWidth(9999)).toBe(SIDEBAR_MAX_WIDTH);
    expect(clampWidth(300.4)).toBe(300);
    expect([SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH]).toEqual([160, 480]);
  });

  it("applies_the_persisted_width_clamped_or_the_default", () => {
    expect(setup({ width: 320 }).host.style.width).toBe("320px");
    expect(setup({ width: 5000 }).host.style.width).toBe("480px");
    expect(setup().host.style.width).toBe(`${SIDEBAR_DEFAULT_WIDTH}px`);
  });

  it("drag_handle_resizes_with_clamp_and_persists_on_release", () => {
    const { host, q, onChange } = setup({ width: 220 });
    const grip = q(".sb-grip");
    grip.dispatchEvent(mouse("pointerdown", 220));
    document.dispatchEvent(mouse("pointermove", 300));
    expect(host.style.width).toBe("300px");
    document.dispatchEvent(mouse("pointermove", 900));
    expect(host.style.width).toBe("480px");
    document.dispatchEvent(mouse("pointermove", 0));
    expect(host.style.width).toBe("160px");
    expect(onChange).not.toHaveBeenCalled();
    document.dispatchEvent(mouse("pointerup", 0));
    expect(onChange).toHaveBeenCalledWith({ sidebar_width: 160 });
    document.dispatchEvent(mouse("pointermove", 400)); // plus de glissement
    expect(host.style.width).toBe("160px");
  });

  it("double_click_on_the_handle_resets_to_default", () => {
    const { host, q, onChange } = setup({ width: 400 });
    q(".sb-grip").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(host.style.width).toBe(`${SIDEBAR_DEFAULT_WIDTH}px`);
    expect(onChange).toHaveBeenCalledWith({ sidebar_width: null });
  });

  it("toggle_button_collapses_and_expands_and_persists", () => {
    const { host, q, onChange, panel } = setup({ width: 300 });
    const toggle = q(".sb-toggle");
    expect(toggle.title).toBe("Réduire le panneau (Ctrl+\)");
    expect(host.classList.contains("collapsed")).toBe(false);
    toggle.click();
    expect(host.classList.contains("collapsed")).toBe(true);
    expect(panel.isCollapsed()).toBe(true);
    expect(host.style.width).toBe("44px");
    expect(onChange).toHaveBeenLastCalledWith({ sidebar_collapsed: true });
    expect(toggle.title).toBe("Développer le panneau (Ctrl+\)");
    toggle.click();
    expect(host.classList.contains("collapsed")).toBe(false);
    expect(host.style.width).toBe("300px");
    expect(onChange).toHaveBeenLastCalledWith({ sidebar_collapsed: false });
  });

  it("starts_collapsed_when_persisted_and_shows_only_the_icon_new_note_button", () => {
    const { host, q, newNote } = setup({ collapsed: true });
    expect(host.classList.contains("collapsed")).toBe(true);
    expect(host.style.width).toBe("44px");
    const mini = q(".sb-mini-new");
    expect(mini.title).toBe("Nouvelle note (Ctrl+N)");
    mini.click();
    expect(newNote).toHaveBeenCalled();
    const css = themeCss();
    expect(css).toMatch(/\.sidebar-host\.collapsed \.sb-tree[^{]*\{[^}]*display: none/);
    expect(css).toMatch(/\.sb-mini-new \{[^}]*display: none/);
  });

  it("toggle_method_flips_state_for_the_keyboard_shortcut", () => {
    const { panel } = setup();
    panel.toggle();
    expect(panel.isCollapsed()).toBe(true);
    panel.toggle();
    expect(panel.isCollapsed()).toBe(false);
  });

  it("css_transition_is_short_and_disabled_for_reduced_motion", () => {
    const css = themeCss();
    expect(css).toMatch(/\.sidebar-host \{[^}]*transition: width 120ms/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{[^}]*\.sidebar-host \{ transition: none/);
  });

  it("puts_the_collapse_chevron_on_the_same_row_as_the_new_note_button", () => {
    const { q, host } = setup();
    const row = q(".sb-head");
    expect(row.contains(q(".sb-new"))).toBe(true);
    expect(row.contains(q(".sb-toggle"))).toBe(true);
    expect(host.querySelectorAll(".sb-head").length).toBe(1);
  });
});
