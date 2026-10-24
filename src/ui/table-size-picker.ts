const N = 8;

/** 8x8 grid popover under `anchor`. Resolves {rows, cols} on click, null on Escape / outside click. */
export function pickTableSize(anchor: HTMLElement): Promise<{ rows: number; cols: number } | null> {
  return new Promise((resolve) => {
    const pop = document.createElement("div");
    pop.className = "size-picker";
    const grid = document.createElement("div");
    grid.className = "size-grid";
    const label = document.createElement("div");
    label.className = "size-label";
    label.textContent = "Tableau";
    const cells: HTMLElement[] = [];
    const paint = (rows: number, cols: number): void => {
      cells.forEach((c, i) => c.classList.toggle("on", Math.floor(i / N) < rows && i % N < cols));
      label.textContent = rows > 0 ? `${rows} × ${cols}` : "Tableau";
    };
    const done = (value: { rows: number; cols: number } | null): void => {
      document.removeEventListener("mousedown", onOutside, true);
      document.removeEventListener("keydown", onKey, true);
      pop.remove();
      resolve(value);
    };
    const onOutside = (e: MouseEvent): void => {
      if (!pop.contains(e.target as Node)) done(null);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        done(null);
      }
    };
    for (let i = 0; i < N * N; i++) {
      const c = document.createElement("div");
      c.className = "size-cell";
      const rows = Math.floor(i / N) + 1;
      const cols = (i % N) + 1;
      c.addEventListener("mouseenter", () => paint(rows, cols));
      c.addEventListener("click", () => done({ rows, cols }));
      cells.push(c);
      grid.appendChild(c);
    }
    pop.addEventListener("mousedown", (e) => e.preventDefault());
    pop.append(grid, label);

    document.body.appendChild(pop);
    const a = anchor.getBoundingClientRect();
    pop.style.left = `${Math.max(0, Math.min(a.left, window.innerWidth - pop.offsetWidth - 4))}px`;
    pop.style.top = `${a.bottom + 4}px`;
    document.addEventListener("mousedown", onOutside, true);
    document.addEventListener("keydown", onKey, true);
  });
}
