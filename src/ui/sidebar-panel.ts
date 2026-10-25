import { onLanguageChanged, tr } from "../i18n";

export const SIDEBAR_DEFAULT_WIDTH = 220;
export const SIDEBAR_MIN_WIDTH = 160;
export const SIDEBAR_MAX_WIDTH = 480;
export const SIDEBAR_COLLAPSED_WIDTH = 44;

export const clampWidth = (w: number): number => Math.round(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, w)));

export interface SidebarPanelOptions {
  /** Largeur enregistrée (null = défaut). */
  width: number | null;
  collapsed: boolean;
  /** Réglage à enregistrer (`sidebar_width` null = retour au défaut). */
  onChange(patch: { sidebar_width?: number | null; sidebar_collapsed?: boolean }): void;
  newNote(): void;
}

export interface SidebarPanelHandle {
  toggle(): void;
  isCollapsed(): boolean;
  width(): number;
}

const SVG_NS = "http://www.w3.org/2000/svg";

function icon(paths: string[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    svg.appendChild(p);
  }
  return svg;
}

/**
 * Habille le panneau latéral : poignée de redimensionnement (bord droit), bouton réduire/développer en haut,
 * bande étroite avec seulement « ＋ » quand il est réduit. `host` est le conteneur déjà rempli par `mountSidebar`.
 */
export function mountSidebarPanel(host: HTMLElement, opts: SidebarPanelOptions): SidebarPanelHandle {
  let width = opts.width === null ? SIDEBAR_DEFAULT_WIDTH : clampWidth(opts.width);
  let collapsed = opts.collapsed;

  const head = document.createElement("div");
  head.className = "sb-head";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "sb-toggle";
  toggle.appendChild(icon(["M10 3.5 5.5 8l4.5 4.5"]));
  const mini = document.createElement("button");
  mini.type = "button";
  mini.className = "sb-mini-new";
  mini.appendChild(icon(["M8 3v10M3 8h10"]));
  tr(mini, { title: "sidebar.newNoteIcon", aria: "sidebar.newNoteIcon" });
  // Le bouton « Nouvelle note » partage la rangée du chevron (réduit : masqué par le CSS).
  const newBtn = host.querySelector(":scope > .sb-new");
  if (newBtn) head.append(newBtn);
  head.append(toggle, mini);

  const grip = document.createElement("div");
  grip.className = "sb-grip";
  grip.setAttribute("role", "separator");
  grip.setAttribute("aria-orientation", "vertical");
  tr(grip, { aria: "sidebar.resize" });

  host.prepend(head);
  host.appendChild(grip);

  const apply = (): void => {
    host.classList.toggle("collapsed", collapsed);
    host.style.width = `${collapsed ? SIDEBAR_COLLAPSED_WIDTH : width}px`;
    tr(toggle, collapsed ? { title: "sidebar.expand", aria: "sidebar.expand" } : { title: "sidebar.collapse", aria: "sidebar.collapse" });
    toggle.setAttribute("aria-expanded", String(!collapsed));
    mini.hidden = !collapsed;
    grip.hidden = collapsed;
  };

  const doToggle = (): void => {
    collapsed = !collapsed;
    apply();
    opts.onChange({ sidebar_collapsed: collapsed });
  };
  toggle.addEventListener("click", doToggle);
  mini.addEventListener("click", () => opts.newNote());

  grip.addEventListener("pointerdown", (e) => {
    if (collapsed || (e as MouseEvent).button > 0) return;
    e.preventDefault();
    const startX = (e as MouseEvent).clientX;
    const startW = width;
    host.classList.add("resizing");
    const move = (ev: Event): void => {
      width = clampWidth(startW + ((ev as MouseEvent).clientX - startX));
      apply();
    };
    const up = (): void => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
      host.classList.remove("resizing");
      opts.onChange({ sidebar_width: width });
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
  });
  grip.addEventListener("dblclick", () => {
    width = SIDEBAR_DEFAULT_WIDTH;
    apply();
    opts.onChange({ sidebar_width: null });
  });

  apply();
  onLanguageChanged(apply);
  return { toggle: doToggle, isCollapsed: () => collapsed, width: () => width };
}
