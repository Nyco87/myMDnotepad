export interface ContextMenuItem {
  label: string;
  action: () => void;
  danger?: boolean;
}

let closeCurrent: (() => void) | null = null;

/** Shows a floating menu at viewport (x, y). Closes on Escape, outside click, scroll or after an action. */
export function showContextMenu(x: number, y: number, items: ContextMenuItem[]): void {
  closeCurrent?.();
  const menu = document.createElement("div");
  menu.className = "ctx-menu";
  menu.setAttribute("role", "menu");
  const buttons: HTMLButtonElement[] = [];
  let active = -1;

  const setActive = (i: number): void => {
    active = (i + buttons.length) % buttons.length;
    buttons.forEach((b, j) => b.classList.toggle("active", j === active));
  };

  const close = (): void => {
    document.removeEventListener("mousedown", onOutside, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("scroll", close, true);
    window.removeEventListener("blur", close);
    menu.remove();
    if (closeCurrent === close) closeCurrent = null;
  };
  const onOutside = (e: MouseEvent): void => {
    if (!menu.contains(e.target as Node)) close();
  };
  // Capture phase + stopPropagation: the editor must not also react to these keys while the menu is open.
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      setActive(active + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      setActive(active < 0 ? -1 : active - 1);
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      e.stopPropagation();
      buttons[active].click();
    }
  };

  for (const item of items) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ctx-item" + (item.danger ? " danger" : "");
    b.setAttribute("role", "menuitem");
    b.textContent = item.label;
    b.addEventListener("mousedown", (e) => e.preventDefault()); // keep editor focus
    b.addEventListener("mouseenter", () => setActive(buttons.indexOf(b)));
    b.addEventListener("click", () => {
      close();
      item.action();
    });
    menu.appendChild(b);
    buttons.push(b);
  }

  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(0, Math.min(x, window.innerWidth - r.width - 4))}px`;
  menu.style.top = `${Math.max(0, Math.min(y, window.innerHeight - r.height - 4))}px`;

  document.addEventListener("mousedown", onOutside, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("scroll", close, true);
  window.addEventListener("blur", close);
  closeCurrent = close;
}
