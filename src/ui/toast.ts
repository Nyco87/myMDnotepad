const TOAST_MS = 5000;

/** Zone de message unique en bas à droite de la fenêtre ; chaque message remplace le précédent et disparaît après ~5 s. */
export function mountToast(parent: HTMLElement = document.body): (message: string) => void {
  const el = document.createElement("div");
  el.className = "toast";
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  el.hidden = true;
  parent.appendChild(el);
  let timer: ReturnType<typeof setTimeout> | null = null;
  el.addEventListener("click", () => {
    el.hidden = true;
  });
  return (message: string) => {
    el.textContent = message;
    el.hidden = false;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      el.hidden = true;
    }, TOAST_MS);
  };
}
