const TOAST_MS = 5000;

export interface ToastOptions {
  /** Reste affiché jusqu'au clic (avis de conflit : l'utilisateur doit savoir où est l'autre version). */
  sticky?: boolean;
}

export type Toast = (message: string, opts?: ToastOptions) => void;

/**
 * Zone de message en bas à droite de la fenêtre. Les messages sont affichés l'un après l'autre (file d'attente :
 * aucun n'en cache un autre) ; chacun disparaît après ~5 s ou au clic, sauf un message `sticky` qui attend le clic.
 */
export function mountToast(parent: HTMLElement = document.body): Toast {
  const el = document.createElement("div");
  el.className = "toast";
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  el.hidden = true;
  parent.appendChild(el);
  const queue: { message: string; sticky: boolean }[] = [];
  let current: { message: string; sticky: boolean } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const next = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
    current = queue.shift() ?? null;
    if (!current) {
      el.hidden = true;
      el.classList.remove("toast-sticky");
      return;
    }
    el.textContent = current.message;
    el.classList.toggle("toast-sticky", current.sticky);
    el.title = current.sticky ? "Cliquer pour fermer" : "";
    el.hidden = false;
    if (!current.sticky) timer = setTimeout(next, TOAST_MS);
  };

  el.addEventListener("click", next);

  return (message, opts = {}) => {
    const sticky = opts.sticky ?? false;
    const waiting = queue.find((q) => q.message === message);
    if (waiting) {
      waiting.sticky ||= sticky;
      return;
    }
    if (current?.message === message && (current.sticky || !sticky)) return;
    queue.push({ message, sticky });
    if (!current) next();
  };
}
