import { t, type Key } from "../i18n";
import { mountFlowEditor } from "./editors/flow-editor";
import { mountGanttEditor } from "./editors/gantt-editor";
import { mountPieEditor } from "./editors/pie-editor";
import { mountStateEditor } from "./editors/state-editor";
import { button, el } from "./editors/ui";
import { generateDiagram, normalizeCode, parseDiagram, type DiagramKind, type DiagramModel } from "./model";
import { renderMermaid } from "./render";
import { validateModel } from "./validate";

export interface WorkshopOptions {
  /** Code mermaid existant à modifier. Sans code, l'atelier commence par le choix du type. */
  code?: string;
}

const TYPES: { kind: DiagramKind; icon: string; label: Key }[] = [
  { kind: "flow", icon: "🔀", label: "ws.type.flow" },
  { kind: "pie", icon: "🥧", label: "ws.type.pie" },
  { kind: "gantt", icon: "📅", label: "ws.type.gantt" },
  { kind: "state", icon: "🔁", label: "ws.type.state" },
];

const EMPTY: Record<DiagramKind, DiagramModel> = {
  pie: { kind: "pie", title: "", slices: [] },
  flow: { kind: "flow", direction: "TD", nodes: [], edges: [] },
  state: { kind: "state", states: [], transitions: [], start: null, ends: [] },
  gantt: { kind: "gantt", title: "", sections: [] },
};

/** Délai minimal entre deux dessins de l'aperçu pendant la saisie. */
const PREVIEW_MS = 250;

function mountEditor(root: HTMLElement, model: DiagramModel, onChange: (m: DiagramModel) => void): () => void {
  switch (model.kind) {
    case "pie":
      return mountPieEditor(root, model, onChange);
    case "flow":
      return mountFlowEditor(root, model, onChange);
    case "state":
      return mountStateEditor(root, model, onChange);
    case "gantt":
      return mountGanttEditor(root, model, onChange);
  }
}

/**
 * Atelier de schémas : fenêtre modale (type → briques + aperçu → Insérer). Résout le code mermaid à écrire, ou
 * `null` si l'utilisateur annule. Un code qui ne se relit pas en briques s'ouvre directement en mode code, inchangé.
 */
export function openDiagramWorkshop(opts: WorkshopOptions = {}): Promise<string | null> {
  return new Promise((resolve) => {
    const initial = opts.code !== undefined && opts.code.trim() !== "" ? opts.code : undefined;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // ---- Structure ----
    const overlay = el("div", "ws-overlay");
    const dialog = el("div", "ws");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", t("ws.title"));
    dialog.tabIndex = -1;
    const title = el("b", "ws-title");
    const subtitle = el("span", "ws-subtitle");
    const header = el("div", "ws-head");
    header.append(title, subtitle);
    const left = el("div", "ws-left");
    const preview = el("div", "ws-right");
    // Le dessin mermaid peut contenir des liens : jamais de navigation hors de l'application.
    for (const type of ["click", "auxclick"]) preview.addEventListener(type, (e) => e.preventDefault());
    const previewSvg = el("div", "ws-preview-svg");
    const previewMsg = el("div", "ws-preview-msg");
    preview.append(previewSvg, previewMsg);
    const body = el("div", "ws-body");
    body.append(left, preview);
    const toggle = button("", "", () => onToggle(), "ws-btn ws-code-toggle");
    const cancel = button(t("common.cancel"), t("common.cancel"), () => finish(null), "ws-btn ws-cancel");
    const insert = button(t("ws.insert"), t("ws.insert"), () => onInsert(), "ws-btn ws-primary ws-insert");
    const actions = el("span", "ws-actions");
    actions.append(cancel, insert);
    const footer = el("div", "ws-foot");
    footer.append(toggle, actions);
    dialog.append(header, body, footer);
    overlay.appendChild(dialog);

    // ---- État ----
    let mode: "type" | "bricks" | "code" = "type";
    let model: DiagramModel | null = null;
    let unmount: (() => void) | null = null;
    let codeArea: HTMLTextAreaElement | null = null;
    let done = false;

    // ---- Aperçu : au plus un dessin toutes les 250 ms pendant la saisie ----
    let lastRun = -Infinity;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending: string | null = null;
    let seq = 0;
    const showHint = (text: string): void => {
      previewSvg.textContent = "";
      previewMsg.textContent = text;
      previewMsg.classList.remove("ws-preview-error");
    };
    const runPreview = (): void => {
      timer = null;
      lastRun = Date.now();
      const code = pending;
      const mine = ++seq;
      if (code === null) return showHint(t("ws.previewHint"));
      void renderMermaid(code).then((result) => {
        if (done || mine !== seq) return;
        if (result.ok) {
          previewMsg.textContent = "";
          previewSvg.innerHTML = result.svg;
        } else {
          previewSvg.textContent = "";
          previewMsg.textContent = result.error;
          previewMsg.classList.add("ws-preview-error");
        }
      });
    };
    const schedulePreview = (code: string | null): void => {
      pending = code;
      if (timer !== null) return; // un dessin est déjà prévu : il prendra le code le plus récent
      const wait = Math.max(0, lastRun + PREVIEW_MS - Date.now());
      if (wait === 0) runPreview();
      else timer = setTimeout(runPreview, wait);
    };

    // ---- Résultat ----
    /** Un code relu sans changement est rendu tel qu'il était (aucune réécriture pour un simple espace). */
    const finalize = (code: string): string => (initial !== undefined && normalizeCode(code) === normalizeCode(initial) ? initial : code);
    const currentCode = (): string | null => {
      if (mode === "code") return codeArea?.value ?? null;
      return model ? generateDiagram(model) : null;
    };
    const canInsert = (): boolean => {
      if (mode === "bricks") return model !== null && validateModel(model).length === 0;
      if (mode === "code") return (codeArea?.value.trim() ?? "") !== "";
      return false;
    };
    const refreshChrome = (): void => {
      insert.hidden = mode === "type";
      insert.disabled = !canInsert();
      toggle.hidden = mode === "type";
      if (mode === "bricks") {
        toggle.textContent = t("ws.viewCode");
        toggle.disabled = false;
        toggle.title = "";
      } else if (mode === "code") {
        const readable = parseDiagram(codeArea?.value ?? "") !== null;
        toggle.textContent = t("ws.backToBricks");
        toggle.disabled = !readable;
        toggle.title = readable ? "" : t("ws.notReadable");
      }
    };

    const clearLeft = (): void => {
      unmount?.();
      unmount = null;
      codeArea = null;
      left.textContent = "";
    };

    // ---- Écrans ----
    const showTypes = (): void => {
      mode = "type";
      model = null;
      clearLeft();
      title.textContent = t("ws.newTitle");
      subtitle.textContent = t("ws.whichType");
      const cards = el("div", "ws-types");
      for (const ty of TYPES) {
        const card = el("button", "ws-type");
        card.type = "button";
        card.dataset.kind = ty.kind;
        card.append(el("span", "ws-type-icon", ty.icon), document.createTextNode(t(ty.label)));
        card.addEventListener("click", () => showBricks(EMPTY[ty.kind]));
        cards.appendChild(card);
      }
      left.appendChild(cards);
      showHint(t("ws.chooseType"));
      schedulePreview(null);
      refreshChrome();
    };

    const showBricks = (next: DiagramModel): void => {
      mode = "bricks";
      model = next;
      clearLeft();
      const type = TYPES.find((ty) => ty.kind === next.kind)!;
      title.textContent = `② ${t(type.label)}`;
      subtitle.textContent = "";
      const host = el("div", "ws-bricks");
      left.appendChild(host);
      unmount = mountEditor(host, next, (changed) => {
        model = changed;
        refreshChrome();
        schedulePreview(validateModel(changed).length === 0 ? generateDiagram(changed) : null);
      });
      schedulePreview(validateModel(next).length === 0 ? generateDiagram(next) : null);
      refreshChrome();
      host.querySelector<HTMLElement>("input, select, button")?.focus();
    };

    const showCode = (text: string): void => {
      mode = "code";
      model = null;
      clearLeft();
      title.textContent = t("ws.codeTitle");
      subtitle.textContent = "";
      const area = el("textarea", "ws-code");
      area.value = text;
      area.spellcheck = false;
      area.setAttribute("aria-label", t("ws.codeAria"));
      area.addEventListener("input", () => {
        refreshChrome();
        schedulePreview(area.value.trim() === "" ? null : area.value);
      });
      codeArea = area;
      left.appendChild(area);
      schedulePreview(text.trim() === "" ? null : text);
      refreshChrome();
      area.focus();
    };

    const onToggle = (): void => {
      if (mode === "bricks" && model) showCode(generateDiagram(model));
      else if (mode === "code") {
        const parsed = parseDiagram(codeArea?.value ?? "");
        if (parsed) showBricks(parsed);
      }
    };

    const onInsert = (): void => {
      if (!canInsert()) return;
      const code = currentCode();
      if (code !== null) finish(finalize(code));
    };

    // ---- Fermeture ----
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        if (e.target instanceof HTMLSelectElement) return; // Échap ferme la liste déroulante, pas l'atelier
        e.preventDefault();
        e.stopPropagation();
        finish(null);
      } else if (e.key === "Enter" && e.ctrlKey) {
        e.preventDefault();
        e.stopPropagation();
        onInsert();
      }
    };
    function finish(value: string | null): void {
      if (done) return;
      done = true;
      if (timer !== null) clearTimeout(timer);
      seq++;
      document.removeEventListener("keydown", onKey, true);
      unmount?.();
      overlay.remove();
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
      resolve(value);
    }

    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(overlay);

    if (initial === undefined) showTypes();
    else {
      const parsed = parseDiagram(initial);
      if (parsed) showBricks(parsed);
      else showCode(initial);
    }
    if (!dialog.contains(document.activeElement)) dialog.focus();
  });
}
