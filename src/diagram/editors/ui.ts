/** Petits éléments d'interface partagés par les éditeurs de briques. */

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export const clone = <T>(value: T): T => structuredClone(value);

export function textInput(value: string, placeholder: string, onInput: (v: string) => void, className = "ws-in"): HTMLInputElement {
  const input = el("input", className);
  input.type = "text";
  input.value = value;
  input.placeholder = placeholder;
  input.setAttribute("aria-label", placeholder);
  input.addEventListener("input", () => onInput(input.value));
  return input;
}

export function selectBox(
  options: { value: string; label: string }[],
  value: string,
  label: string,
  onChange: (v: string) => void,
): HTMLSelectElement {
  const select = el("select", "ws-sel");
  select.setAttribute("aria-label", label);
  for (const o of options) {
    const opt = el("option", "", o.label);
    opt.value = o.value;
    select.appendChild(opt);
  }
  select.value = value;
  select.addEventListener("change", () => onChange(select.value));
  return select;
}

export function button(text: string, title: string, onClick: () => void, className = "ws-ib"): HTMLButtonElement {
  const b = el("button", className, text);
  b.type = "button";
  b.title = title;
  b.setAttribute("aria-label", title);
  b.addEventListener("click", onClick);
  return b;
}

/** Zone d'erreur d'un champ ; `paintErrors` la remplit. */
export function errorSlot(where: string): HTMLElement {
  const e = el("div", "ws-error");
  e.dataset.where = where;
  e.setAttribute("role", "alert");
  return e;
}

export function label(text: string): HTMLElement {
  return el("div", "ws-lbl", text);
}

/** Boutons ↑ ↓ ✕ d'une ligne de liste. */
export function rowTools(index: number, count: number, ops: { move(dir: -1 | 1): void; remove(): void }): HTMLElement {
  const box = el("span", "ws-tools");
  const up = button("↑", "Monter", () => ops.move(-1));
  const down = button("↓", "Descendre", () => ops.move(1));
  up.disabled = index === 0;
  down.disabled = index === count - 1;
  box.append(up, down, button("✕", "Supprimer", ops.remove, "ws-ib ws-del"));
  return box;
}

export function addButton(text: string, onClick: () => void): HTMLButtonElement {
  return button(text, text, onClick, "ws-add");
}

export function moveItem<T>(list: T[], index: number, dir: -1 | 1): void {
  const j = index + dir;
  if (j < 0 || j >= list.length) return;
  [list[index], list[j]] = [list[j], list[index]];
}

let uidCounter = 0;
/** Identifiant interne unique (les identifiants écrits dans le code sont renumérotés à la génération). */
export const uid = (prefix: string): string => `${prefix}_${++uidCounter}`;
