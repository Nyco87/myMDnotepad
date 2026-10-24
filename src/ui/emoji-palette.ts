import { EMOJI_GROUPS } from "./emoji-data";

/** Puts `e` first, removes duplicates, keeps at most `max` entries. Returns a new array. */
export function pushRecent(recents: string[], e: string, max = 8): string[] {
  return [e, ...recents.filter((r) => r !== e)].slice(0, max);
}

/**
 * Popover under `anchor`: "Récents" (only when non-empty) then the spec groups.
 * Click on an emoji calls `onPick` and closes; Escape or a mousedown outside closes.
 */
export function openEmojiPalette(anchor: HTMLElement, recents: string[], onPick: (e: string) => void): void {
  document.querySelector(".emoji-palette")?.remove();
  const pop = document.createElement("div");
  pop.className = "emoji-palette";

  const groups = recents.length > 0 ? [{ label: "Récents", emojis: recents }, ...EMOJI_GROUPS] : EMOJI_GROUPS;
  for (const g of groups) {
    const label = document.createElement("div");
    label.className = "emoji-label";
    label.textContent = g.label;
    const grid = document.createElement("div");
    grid.className = "emoji-grid";
    for (const e of g.emojis) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "emoji-btn";
      b.textContent = e;
      b.addEventListener("click", () => {
        close();
        onPick(e);
      });
      grid.appendChild(b);
    }
    pop.append(label, grid);
  }

  const close = (): void => {
    document.removeEventListener("mousedown", onOutside, true);
    document.removeEventListener("keydown", onKey, true);
    pop.remove();
  };
  const onOutside = (e: MouseEvent): void => {
    if (!pop.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };
  pop.addEventListener("mousedown", (e) => e.preventDefault()); // keep editor focus/selection

  document.body.appendChild(pop);
  const a = anchor.getBoundingClientRect();
  pop.style.left = `${Math.max(0, Math.min(a.left, window.innerWidth - pop.offsetWidth - 4))}px`;
  pop.style.top = `${a.bottom + 4}px`;
  document.addEventListener("mousedown", onOutside, true);
  document.addEventListener("keydown", onKey, true);
}
