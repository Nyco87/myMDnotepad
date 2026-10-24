import { open } from "@tauri-apps/plugin-dialog";
import { setRoot } from "../api";

const errText = (e: unknown): string => (typeof e === "string" ? e : e instanceof Error ? e.message : String(e));

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
  title.textContent = "Choisis le dossier de tes notes";
  box.appendChild(title);

  if (reason === "missing") {
    const missing = document.createElement("p");
    missing.className = "first-run-missing";
    missing.textContent = `Le dossier ${previous ?? ""} est introuvable.`;
    box.appendChild(missing);
  }

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "first-run-btn";
  btn.textContent = "Choisir un dossier…";
  box.appendChild(btn);

  const error = document.createElement("p");
  error.className = "first-run-error";
  error.setAttribute("role", "alert");
  error.hidden = true;
  box.appendChild(error);

  const tip = document.createElement("p");
  tip.className = "first-run-tip";
  tip.textContent = "Astuce : un dossier OneDrive synchronise tes notes automatiquement.";
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
          error.textContent = errText(e);
          error.hidden = false;
        } finally {
          btn.disabled = false;
        }
      })();
    });
  });
}
