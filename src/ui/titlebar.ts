import { getCurrentWindow } from "@tauri-apps/api/window";

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
  newBtn.title = "Nouvelle note (Ctrl+N)";
  newBtn.addEventListener("click", () => h.onNew());

  const drag = document.createElement("div");
  drag.className = "titlebar-drag";
  drag.setAttribute("data-tauri-drag-region", "");

  const ctl = document.createElement("div");
  ctl.className = "win-ctl";
  const winBtn = (label: string, title: string, cls: string, act: () => Promise<void>): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `win-btn ${cls}`;
    b.textContent = label;
    b.title = title;
    b.setAttribute("aria-label", title);
    b.addEventListener("click", () => void act().catch((e) => console.error(e)));
    return b;
  };
  ctl.append(
    winBtn("─", "Réduire", "win-min", () => getCurrentWindow().minimize()),
    winBtn("☐", "Agrandir", "win-max", () => getCurrentWindow().toggleMaximize()),
    winBtn("✕", "Fermer", "win-close", () => getCurrentWindow().close()),
  );

  el.append(strip, drag, ctl);

  const renderTab = (t: TabView): HTMLElement => {
    const tab = document.createElement("div");
    tab.className = "tab" + (t.active ? " active" : "") + (t.missing ? " missing" : "");
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", String(t.active));
    tab.dataset.rel = t.rel;
    tab.title = t.missing ? "Fichier introuvable sur le disque" : t.rel;

    const label = document.createElement("span");
    label.className = "tab-label";
    label.textContent = `📄 ${t.title}`;

    const close = document.createElement("button");
    close.type = "button";
    close.className = "tab-close";
    close.textContent = "✕";
    close.title = "Fermer (Ctrl+W)";
    close.setAttribute("aria-label", `Fermer ${t.title}`);
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
