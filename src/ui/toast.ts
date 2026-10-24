const TOAST_MS = 5000;

export interface ToastOptions {
  /** Reste affiché jusqu'au clic (avis de conflit : l'utilisateur doit savoir où est l'autre version). */
  sticky?: boolean;
}

export type Toast = (message: string, opts?: ToastOptions) => void;

/**
 * Zone de message en bas à droite de la fenêtre. Les messages ordinaires sont affichés l'un après l'autre (file
 * d'attente : aucun n'en cache un autre) ; chacun disparaît après ~5 s ou au clic. Un message `sticky` n'entre pas
 * dans la file : il s'empile au-dessus, reste affiché jusqu'au clic et ne bloque jamais les autres messages.
 */
export function mountToast(parent: HTMLElement = document.body): Toast {
  const stack = document.createElement("div");
  stack.className = "toast-stack";
  const el = document.createElement("div");
  el.className = "toast";
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  el.hidden = true;
  stack.appendChild(el);
  parent.appendChild(stack);
  const queue: string[] = [];
  const stickies = new Map<string, HTMLElement>();
  let current: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const next = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
    current = queue.shift() ?? null;
    if (current === null) {
      el.hidden = true;
      return;
    }
    el.textContent = current;
    el.hidden = false;
    timer = setTimeout(next, TOAST_MS);
  };

  el.addEventListener("click", next);

  return (message, opts = {}) => {
    if (opts.sticky) {
      if (stickies.has(message)) return;
      const s = document.createElement("div");
      s.className = "toast toast-sticky";
      s.setAttribute("role", "status");
      s.title = "Cliquer pour fermer";
      s.textContent = message;
      s.addEventListener("click", () => {
        s.remove();
        stickies.delete(message);
      });
      stickies.set(message, s);
      stack.appendChild(s);
      return;
    }
    if (current === message || queue.includes(message)) return;
    queue.push(message);
    if (current === null) next();
  };
}
