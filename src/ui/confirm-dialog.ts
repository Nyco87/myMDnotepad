import { t } from "../i18n";

/**
 * Modale de confirmation sombre (remplace window.confirm).
 * Échap annule, Entrée confirme. Résout `true` si confirmé, `false` sinon.
 */
export function confirmDialog(message: string, okLabel = t("confirm.trash"), cancelLabel = t("common.cancel")): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    const dlg = document.createElement("div");
    dlg.className = "confirm-dialog";
    dlg.setAttribute("role", "alertdialog");
    dlg.setAttribute("aria-modal", "true");
    const p = document.createElement("p");
    p.className = "confirm-message";
    p.textContent = message;
    const row = document.createElement("div");
    row.className = "confirm-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "confirm-cancel";
    cancel.textContent = cancelLabel;
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "confirm-ok";
    ok.textContent = okLabel;
    row.append(cancel, ok);
    dlg.append(p, row);
    overlay.appendChild(dlg);

    const finish = (value: boolean): void => {
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      resolve(value);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        finish(true);
      }
    };
    cancel.addEventListener("click", () => finish(false));
    ok.addEventListener("click", () => finish(true));
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) finish(false);
    });
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(overlay);
    ok.focus();
  });
}
