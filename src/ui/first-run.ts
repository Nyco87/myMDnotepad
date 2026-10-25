import { open } from "@tauri-apps/plugin-dialog";
import { setRoot } from "../api";
import { errorText, tr } from "../i18n";

/**
 * Écran de premier lancement (ou de dossier introuvable). La promesse se résout après un `setRoot` réussi ;
 * en cas d'échec, l'erreur s'affiche et le bouton reste actif.
 */
export function showFirstRun(el: HTMLElement, reason: "unset" | "missing", previous?: string): Promise<void> {
  el.textContent = "";
  el.hidden = false;
  const box = document.createElement("div");
  box.className = "first-run";

  const title = document.createElement("h1");
  tr(title, { text: "firstRun.title" });
  box.appendChild(title);

  if (reason === "missing") {
    const missing = document.createElement("p");
    missing.className = "first-run-missing";
    tr(missing, { text: "firstRun.missing" }, { path: previous ?? "" });
    box.appendChild(missing);
  }

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "first-run-btn";
  tr(btn, { text: "firstRun.choose" });
  box.appendChild(btn);

  const error = document.createElement("p");
  error.className = "first-run-error";
  error.setAttribute("role", "alert");
  error.hidden = true;
  box.appendChild(error);

  const tip = document.createElement("p");
  tip.className = "first-run-tip";
  tr(tip, { text: "firstRun.tip" });
  box.appendChild(tip);

  el.appendChild(box);

  return new Promise<void>((resolve) => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      btn.disabled = true;
      error.hidden = true;
      void (async () => {
        try {
          const picked = await open({ directory: true });
          if (typeof picked !== "string") return; // annulé
          await setRoot(picked);
          el.textContent = "";
          resolve();
        } catch (e) {
          error.textContent = errorText(e);
          error.hidden = false;
        } finally {
          btn.disabled = false;
        }
      })();
    });
  });
}
