import { Plugin, type Command } from "prosemirror-state";
import type { EditorView, NodeViewConstructor } from "prosemirror-view";
import { importImage, resolveAsset, saveImage } from "../api";

const SCHEME = /^[a-z][a-z0-9+.-]+:/i; // http:, https:, data:, file:… (2+ letters, so "C:\" is not a scheme)

/**
 * Root-relative path of an image link written in the note at `noteRel`
 * ("proj/sub/a.md" + "../img/x.png" -> "proj/img/x.png"), or null when the link
 * is not relative (URL scheme, absolute path) and must be used as is.
 * No percent-encoding here: convertFileSrc (resolveAsset) does it.
 */
export function imageAssetPath(noteRel: string, src: string): string | null {
  if (SCHEME.test(src) || src.startsWith("/") || src.startsWith("\\") || /^[a-z]:[\\/]/i.test(src)) return null;
  const parts = noteRel.split(/[\\/]/).slice(0, -1);
  for (const seg of src.split(/[\\/]/)) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

function displaySrc(noteRel: string, src: string): string {
  const rel = imageAssetPath(noteRel, src);
  return rel === null ? src : resolveAsset(rel);
}

/** Image node view: resolves the link; a broken image becomes a small grey placeholder (never throws). */
export function imageNodeView(noteRel: () => string): NodeViewConstructor {
  return (initial) => {
    let node = initial;
    const dom = document.createElement("span");
    dom.className = "img-wrap";
    const img = document.createElement("img");
    dom.appendChild(img);

    const label = (): string => String(node.attrs.alt || String(node.attrs.src).split(/[\\/]/).pop() || "image");
    const load = (): void => {
      dom.classList.remove("img-broken");
      dom.querySelector(".img-fallback")?.remove();
      img.hidden = false;
      img.alt = node.attrs.alt ?? "";
      if (node.attrs.title) img.title = node.attrs.title;
      else img.removeAttribute("title");
      try {
        img.src = displaySrc(noteRel(), String(node.attrs.src));
      } catch {
        img.dispatchEvent(new Event("error"));
      }
    };
    img.addEventListener("error", () => {
      dom.classList.add("img-broken");
      img.hidden = true;
      if (!dom.querySelector(".img-fallback")) {
        const ph = document.createElement("span");
        ph.className = "img-fallback";
        ph.textContent = label();
        dom.appendChild(ph);
      }
    });
    load();

    return {
      dom,
      update(next) {
        if (next.type !== node.type) return false;
        const changed = next.attrs.src !== node.attrs.src || next.attrs.alt !== node.attrs.alt || next.attrs.title !== node.attrs.title;
        node = next;
        if (changed) load();
        return true;
      },
    };
  };
}

/** Inserts an image node at the selection. */
export function insertImage(src: string, alt = ""): Command {
  return (state, dispatch) => {
    if (dispatch) dispatch(state.tr.replaceSelectionWith(state.schema.nodes.image.create({ src, alt })).scrollIntoView());
    return true;
  };
}

function extOf(mime: string): string {
  const sub = mime.split("/")[1]?.toLowerCase() ?? "png";
  return sub === "jpeg" ? "jpg" : sub === "svg+xml" ? "svg" : sub.replace(/[^a-z0-9]/g, "") || "png";
}

/** Pasting image files saves them next to the note and inserts an image node. Text pastes are left alone. */
export function imagePastePlugin(noteRel: () => string, onError?: (message: string) => void): Plugin {
  return new Plugin({
    props: {
      handlePaste(view: EditorView, event: ClipboardEvent) {
        const cd = event.clipboardData;
        const files = Array.from(cd?.files ?? []).filter((f) => f.type.startsWith("image/"));
        if (files.length === 0) return false;
        // Word / web / spreadsheet copies carry text next to a bitmap: let the default paste keep the text.
        const types = Array.from(cd?.types ?? []);
        if (types.includes("text/html") || types.includes("text/plain")) return false;
        event.preventDefault();
        const note = noteRel(); // captured now: a tab switch mid-paste must not redirect the file
        void (async () => {
          for (const f of files) {
            try {
              const bytes = new Uint8Array(await f.arrayBuffer());
              const link = await saveImage(note, bytes, extOf(f.type));
              if (view.isDestroyed) return;
              insertImage(link)(view.state, view.dispatch);
            } catch (err) {
              (onError ?? console.error)(`Collage de l'image impossible : ${String(err)}`);
            }
          }
        })();
        return true;
      },
    },
  });
}

/** Opens the file dialog (png/jpg/jpeg/gif/webp), imports the file next to the note and inserts it. */
export async function pickAndInsertImage(view: EditorView, noteRel: string): Promise<void> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({
    multiple: false,
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
  });
  if (typeof picked !== "string") return;
  const link = await importImage(noteRel, picked);
  if (view.isDestroyed) return;
  const base = picked.split(/[\\/]/).pop() ?? "";
  insertImage(link, base.replace(/\.[^.]+$/, ""))(view.state, view.dispatch);
}
