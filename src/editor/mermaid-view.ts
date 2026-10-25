import { DOMSerializer, type Node as PMNode } from "prosemirror-model";
import type { NodeView, NodeViewConstructor } from "prosemirror-view";
import { diagramAccent, renderMermaid, type RenderResult } from "../diagram/render";

/** Called when a diagram is clicked: position of its node and its mermaid code. */
export type EditDiagram = (pos: number, code: string) => void;

const isMermaid = (node: PMNode): boolean => node.type.name === "code_block" && node.attrs.language === "mermaid";

/* ---- Rendering queue: one drawing at a time, each after the browser is idle ---- */

const idle = (): Promise<void> =>
  new Promise((resolve) => {
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (ric) ric(() => resolve(), { timeout: 500 });
    else setTimeout(resolve, 0);
  });

let chain: Promise<unknown> = Promise.resolve();

/**
 * Start-up gate: while held, no diagram is drawn (so mermaid is not even loaded). `main` holds it first thing and
 * releases it once the window is ready, which keeps mermaid off the start-up critical path. Open by default.
 */
let gate: Promise<void> = Promise.resolve();
let openGate: (() => void) | null = null;

export function holdDiagramRendering(): void {
  if (openGate) return;
  gate = new Promise((resolve) => (openGate = resolve));
}

export function releaseDiagramRendering(): void {
  openGate?.();
  openGate = null;
}

/** Runs `task` after the previous queued tasks, once the gate is open and the browser is idle. A task that throws does not block the queue. */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(() => gate).then(idle).then(task);
  chain = run.catch(() => {});
  return run;
}

const CACHE_MAX = 64;
const cache = new Map<string, RenderResult>();

function drawn(code: string): Promise<RenderResult> {
  const key = `${diagramAccent()}\n${code}`;
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  return enqueue(async () => {
    const result = await renderMermaid(code);
    cache.set(key, result);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
    return result;
  });
}

/** Test hook: forgets cached drawings. */
export function clearDiagramCache(): void {
  cache.clear();
}

/* ---- Node views ---- */

function mermaidView(initial: PMNode, getPos: () => number | undefined, onEdit: () => EditDiagram | undefined): NodeView {
  let node = initial;
  let alive = true;
  let shown: string | null = null;
  let generation = 0;

  const dom = document.createElement("div");
  dom.className = "diagram";
  dom.contentEditable = "false";
  dom.setAttribute("role", "button");
  dom.title = "Modifier le schéma";

  const show = (result: RenderResult, code: string): void => {
    dom.classList.remove("diagram-pending");
    dom.textContent = "";
    if (result.ok) {
      dom.classList.remove("diagram-failed");
      dom.innerHTML = result.svg;
      return;
    }
    dom.classList.add("diagram-failed");
    const box = document.createElement("div");
    box.className = "diagram-error";
    const message = document.createElement("div");
    message.className = "diagram-error-message";
    message.textContent = result.error;
    const pre = document.createElement("pre");
    pre.textContent = code;
    box.append(message, pre);
    dom.appendChild(box);
  };

  const draw = (): void => {
    const code = node.textContent;
    if (code === shown) return;
    shown = code;
    const mine = ++generation;
    if (code.trim() === "") {
      show({ ok: false, error: "Schéma vide : cliquez pour le créer." }, "");
      return;
    }
    dom.classList.add("diagram-pending");
    void drawn(code).then((result) => {
      if (alive && mine === generation) show(result, code);
    });
  };
  draw();

  const onAccent = (): void => {
    shown = null; // the colours changed: draw again
    draw();
  };
  document.addEventListener("accent-changed", onAccent);

  dom.addEventListener("click", (e) => {
    e.preventDefault();
    const pos = getPos();
    if (pos !== undefined) onEdit()?.(pos, node.textContent);
  });

  return {
    dom,
    update(next) {
      if (next.type !== node.type || !isMermaid(next)) return false;
      node = next;
      draw();
      return true;
    },
    // No contentDOM: the code is never shown nor typed into here; the workshop edits it.
    stopEvent: () => true,
    ignoreMutation: () => true,
    selectNode: () => dom.classList.add("ProseMirror-selectednode"),
    deselectNode: () => dom.classList.remove("ProseMirror-selectednode"),
    destroy() {
      alive = false;
      document.removeEventListener("accent-changed", onAccent);
    },
  };
}

/** Plain code block, rendered exactly as the schema's `toDOM` (`<pre><code>`). */
function plainView(initial: PMNode): NodeView {
  let node = initial;
  const { dom, contentDOM } = DOMSerializer.renderSpec(document, node.type.spec.toDOM!(node));
  return {
    dom,
    contentDOM,
    update(next) {
      if (next.type !== node.type || isMermaid(next)) return false;
      node = next;
      const lang = next.attrs.language as string;
      if (lang) (dom as HTMLElement).setAttribute("data-language", lang);
      else (dom as HTMLElement).removeAttribute("data-language");
      return true;
    },
  };
}

/** `code_block` node view: mermaid blocks are drawn as diagrams, the others stay code. */
export const codeBlockView =
  (onEdit: () => EditDiagram | undefined): NodeViewConstructor =>
  (node, _view, getPos) =>
    isMermaid(node) ? mermaidView(node, getPos, onEdit) : plainView(node);
