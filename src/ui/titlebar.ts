import { getCurrentWindow } from "@tauri-apps/api/window";
import { tr, type Key } from "../i18n";

/** `rel` de l'onglet spécial « Réglages » (ce n'est pas une note : aucun fichier). */
export const SETTINGS_TAB = "::settings";

export interface TabView {
  rel: string;
  title: string;
  active: boolean;
  /** Fichier introuvable sur le disque. */
  missing: boolean;
}

export interface TitlebarHandlers {
  onActivate(rel: string): void;
  onClose(rel: string): void;
  onNew(): void;
  /** Clic sur l'icône ⚙ : ouvre (ou active) l'onglet Réglages. */
  onSettings?(): void;
}

export interface TitlebarHandle {
  render(tabs: TabView[]): void;
}

/**
 * Barre de titre façon Terminal Windows : onglets, bouton ＋ (nouvelle note), zone vide déplaçable
 * (`data-tauri-drag-region`) et boutons de fenêtre ─ ☐ ✕.
 */
export function mountTitlebar(el: HTMLElement, h: TitlebarHandlers): TitlebarHandle {
  el.classList.add("titlebar");
  el.setAttribute("data-tauri-drag-region", "");
  el.textContent = "";

  const strip = document.createElement("div");
  strip.className = "tabstrip";
  strip.setAttribute("role", "tablist");
  strip.setAttribute("data-tauri-drag-region", "");

  const newBtn = document.createElement("button");
  newBtn.type = "button";
  newBtn.className = "tab-new";
  newBtn.textContent = "＋";
  tr(newBtn, { title: "titlebar.newNote" });
  newBtn.addEventListener("click", () => h.onNew());

  const drag = document.createElement("div");
  drag.className = "titlebar-drag";
  drag.setAttribute("data-tauri-drag-region", "");

  const settingsBtn = document.createElement("button");
  settingsBtn.type = "button";
  settingsBtn.className = "titlebar-menu titlebar-settings";
  settingsBtn.textContent = "⚙";
  tr(settingsBtn, { title: "titlebar.settings", aria: "titlebar.settings" });
  settingsBtn.addEventListener("click", () => h.onSettings?.());

  const ctl = document.createElement("div");
  ctl.className = "win-ctl";
  const winBtn = (label: string, title: Key, cls: string, act: () => Promise<void>): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `win-btn ${cls}`;
    b.textContent = label;
    tr(b, { title, aria: title });
    b.addEventListener("click", () => void act().catch((e) => console.error(e)));
    return b;
  };
  ctl.append(
    winBtn("─", "titlebar.minimize", "win-min", () => getCurrentWindow().minimize()),
    winBtn("☐", "titlebar.maximize", "win-max", () => getCurrentWindow().toggleMaximize()),
    winBtn("✕", "common.close", "win-close", () => getCurrentWindow().close()),
  );

  el.append(strip, drag, settingsBtn, ctl);

  const renderTab = (t: TabView): HTMLElement => {
    const tab = document.createElement("div");
    tab.className = "tab" + (t.active ? " active" : "") + (t.missing ? " missing" : "");
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", String(t.active));
    tab.dataset.rel = t.rel;
    if (t.missing) tr(tab, { title: "titlebar.missing" });
    else if (t.rel !== SETTINGS_TAB) tab.title = t.rel;

    const label = document.createElement("span");
    label.className = "tab-label";
    if (t.rel === SETTINGS_TAB) {
      label.append("⚙ ");
      label.append(tr(document.createElement("span"), { text: "titlebar.settings" }));
      tab.classList.add("tab-settings");
    } else label.textContent = `📄 ${t.title}`;

    const close = document.createElement("button");
    close.type = "button";
    close.className = "tab-close";
    close.textContent = "✕";
    tr(close, { title: "titlebar.closeTab", aria: "titlebar.closeNamed" }, { title: t.title });
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      h.onClose(t.rel);
    });

    tab.append(label, close);
    tab.addEventListener("click", () => h.onActivate(t.rel));
    tab.addEventListener("auxclick", (e) => {
      if (e.button === 1) {
        e.preventDefault();
        h.onClose(t.rel);
      }
    });
    return tab;
  };

  return {
    render(tabs) {
      strip.textContent = "";
      for (const t of tabs) strip.appendChild(renderTab(t));
      strip.appendChild(newBtn);
      strip.querySelector(".tab.active")?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    },
  };
}
