import * as api from "../api";
import type { TreeNode } from "../api";
import { confirmDialog } from "./confirm-dialog";
import { showContextMenu } from "./context-menu";

export interface SidebarHandlers {
  /** Ouvre la note `rel` (clic, ou création d'une nouvelle note ; le contrôleur donne ensuite le focus à l'éditeur). */
  onOpen(rel: string): void;
  /**
   * Une note ou un dossier a changé de chemin (renommage, déplacement).
   * Pour un dossier, `oldRel`/`newRel` sont les chemins du DOSSIER : le contrôleur d'onglets doit
   * remapper par préfixe tout onglet dont le chemin commence par `oldRel + "/"`.
   */
  onRenamed(oldRel: string, newRel: string): void;
  /**
   * Une note ou un dossier est parti à la Corbeille. Pour un dossier, `rel` est le chemin du DOSSIER :
   * le contrôleur d'onglets doit fermer tout onglet dont le chemin commence par `rel + "/"`.
   */
  onDeleted(rel: string): void;
}

export interface SidebarHandle {
  refresh(): Promise<void>;
  /** Sélectionne `rel` (déplie ses dossiers parents). */
  select(rel: string): void;
  /** Crée une note dans `selectedDir()`, passe son nom en édition, puis appelle `onOpen`. */
  newNote(): Promise<void>;
  /** Dossier sélectionné, ou dossier de la note sélectionnée, ou "" (racine). */
  selectedDir(): string;
}

const DEFAULT_NOTE = "Nouvelle note";
const DEFAULT_FOLDER = "Nouveau dossier";
const ERROR_MS = 4000;

type Editing = { path: string; kind: "folder" | "note"; original: string; value: string; isNew: boolean; error: string | null };

const parentOf = (rel: string): string => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");
const displayName = (n: { name: string; kind: string }): string => (n.kind === "note" ? n.name.replace(/\.md$/i, "") : n.name);
const baseOf = (rel: string): string => {
  const last = rel.slice(rel.lastIndexOf("/") + 1);
  return last.replace(/\.md$/i, "");
};
const errText = (e: unknown): string => (typeof e === "string" ? e : e instanceof Error ? e.message : String(e));

export function mountSidebar(el: HTMLElement, handlers: SidebarHandlers): SidebarHandle {
  el.classList.add("sidebar");
  el.textContent = "";

  const newBtn = document.createElement("button");
  newBtn.type = "button";
  newBtn.className = "sb-new";
  const newLabel = document.createElement("span");
  newLabel.textContent = "＋ Nouvelle note";
  const newHint = document.createElement("span");
  newHint.className = "sb-new-hint";
  newHint.textContent = "Ctrl+N";
  newBtn.append(newLabel, newHint);

  const banner = document.createElement("div");
  banner.className = "sb-banner";
  banner.setAttribute("role", "alert");
  banner.hidden = true;

  const treeEl = document.createElement("div");
  treeEl.className = "sb-tree";
  treeEl.tabIndex = 0;
  el.append(newBtn, banner, treeEl);

  let tree: TreeNode | null = null;
  const expanded = new Set<string>();
  let selected = "";
  let selectedKind: "folder" | "note" | null = null;
  let editing: Editing | null = null;
  let dragPath: string | null = null;
  let bannerTimer: ReturnType<typeof setTimeout> | null = null;
  const kinds = new Map<string, "folder" | "note">();

  const showError = (msg: string): void => {
    banner.textContent = msg;
    banner.hidden = false;
    if (bannerTimer) clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => {
      banner.hidden = true;
    }, ERROR_MS);
  };

  const expandAncestors = (rel: string): void => {
    let p = parentOf(rel);
    while (p) {
      expanded.add(p);
      p = parentOf(p);
    }
  };

  const indexKinds = (n: TreeNode): void => {
    for (const c of n.children ?? []) {
      kinds.set(c.path, c.kind);
      if (c.kind === "folder") indexKinds(c);
    }
  };

  // ---- Rendu ----

  const render = (): void => {
    treeEl.textContent = "";
    const children = tree?.children ?? [];
    if (children.length === 0) {
      const empty = document.createElement("div");
      empty.className = "sb-empty";
      empty.textContent = "Aucune note";
      treeEl.appendChild(empty);
      return;
    }
    const walk = (nodes: TreeNode[], depth: number): void => {
      for (const n of nodes) {
        treeEl.appendChild(renderRow(n, depth));
        if (n.kind === "folder" && expanded.has(n.path)) walk(n.children ?? [], depth + 1);
      }
    };
    walk(children, 0);
    const input = treeEl.querySelector<HTMLInputElement>("input.sb-rename");
    if (input) {
      input.focus();
      input.select();
    }
  };

  const renderRow = (n: TreeNode, depth: number): HTMLElement => {
    const row = document.createElement("div");
    row.className = "sb-row " + n.kind + (n.path === selected ? " selected" : "");
    row.dataset.path = n.path;
    row.dataset.kind = n.kind;
    row.style.paddingLeft = `${8 + depth * 14}px`;
    row.draggable = editing?.path !== n.path;
    row.setAttribute("role", "treeitem");
    if (n.kind === "folder") row.setAttribute("aria-expanded", String(expanded.has(n.path)));

    const chev = document.createElement("span");
    chev.className = "sb-chev";
    chev.textContent = n.kind === "folder" ? (expanded.has(n.path) ? "▾" : "▸") : "";
    row.appendChild(chev);

    if (editing && editing.path === n.path) {
      const wrap = document.createElement("div");
      wrap.className = "sb-rename-wrap";
      const input = document.createElement("input");
      input.type = "text";
      input.className = "sb-rename";
      input.value = editing.value;
      input.spellcheck = false;
      input.addEventListener("input", () => {
        if (editing) editing.value = input.value;
      });
      input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          void commitEdit(input.value);
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancelEdit();
        }
      });
      input.addEventListener("click", (e) => e.stopPropagation());
      wrap.appendChild(input);
      if (editing.error) {
        const err = document.createElement("div");
        err.className = "sb-rename-error";
        err.textContent = editing.error;
        wrap.appendChild(err);
      }
      row.appendChild(wrap);
    } else {
      const label = document.createElement("span");
      label.className = "sb-label";
      label.textContent = displayName(n);
      row.appendChild(label);
    }

    row.addEventListener("click", () => onRowClick(n));
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      selected = n.path;
      selectedKind = n.kind;
      render();
      showContextMenu(e.clientX, e.clientY, rowMenu(n));
    });
    row.addEventListener("dragstart", (e) => {
      dragPath = n.path;
      if (e.dataTransfer) {
        e.dataTransfer.setData("text/plain", n.path);
        e.dataTransfer.effectAllowed = "move";
      }
    });
    row.addEventListener("dragend", () => {
      dragPath = null;
      clearDropMarks();
    });
    row.addEventListener("dragover", (e) => {
      const dest = n.kind === "folder" ? n.path : parentOf(n.path);
      if (!dragPath || !canMove(dragPath, dest)) return;
      e.preventDefault();
      e.stopPropagation();
      clearDropMarks();
      if (n.kind === "folder") row.classList.add("drop-target");
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    });
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const dest = n.kind === "folder" ? n.path : parentOf(n.path);
      void dropOn(dest, e);
    });
    return row;
  };

  const clearDropMarks = (): void => {
    treeEl.classList.remove("drop-target");
    treeEl.querySelectorAll(".drop-target").forEach((r) => r.classList.remove("drop-target"));
  };

  // ---- Actions ----

  const refresh = async (): Promise<void> => {
    try {
      tree = await api.listTree();
    } catch (e) {
      showError(errText(e));
      return;
    }
    kinds.clear();
    indexKinds(tree);
    if (selected && !kinds.has(selected)) {
      selected = "";
      selectedKind = null;
    }
    // Ne pas détruire le champ de saisie en cours : le rendu aura lieu à la fin de l'édition.
    if (!editing) render();
  };

  const onRowClick = (n: TreeNode): void => {
    selected = n.path;
    selectedKind = n.kind;
    if (n.kind === "folder") {
      if (expanded.has(n.path)) expanded.delete(n.path);
      else expanded.add(n.path);
      render();
    } else {
      render();
      handlers.onOpen(n.path);
    }
  };

  const startEdit = (path: string, isNew: boolean): void => {
    const kind = kinds.get(path) ?? (path.endsWith(".md") ? "note" : "folder");
    const original = baseOf(path);
    editing = { path, kind, original, value: original, isNew, error: null };
    expandAncestors(path);
    render();
  };

  const cancelEdit = (): void => {
    editing = null;
    render();
  };

  const commitEdit = async (raw: string): Promise<void> => {
    const ed = editing;
    if (!ed) return;
    const name = raw.trim();
    ed.value = raw;
    if (name === ed.original) {
      editing = null;
      render();
      if (ed.isNew && ed.kind === "note") handlers.onOpen(ed.path);
      return;
    }
    let newPath: string;
    try {
      newPath = await api.renameEntry(ed.path, name);
    } catch (e) {
      if (editing === ed) {
        ed.error = errText(e);
        render();
      }
      return;
    }
    editing = null;
    if (selected === ed.path) selected = newPath;
    else if (selected.startsWith(ed.path + "/")) selected = newPath + selected.slice(ed.path.length);
    if (expanded.delete(ed.path)) expanded.add(newPath);
    await refresh();
    render();
    handlers.onRenamed(ed.path, newPath);
    if (ed.isNew && ed.kind === "note") handlers.onOpen(newPath);
  };

  const createIn = async (dir: string, kind: "note" | "folder"): Promise<void> => {
    let path: string;
    try {
      path = kind === "note" ? await api.createNote(dir, DEFAULT_NOTE) : await api.createFolder(dir, DEFAULT_FOLDER);
    } catch (e) {
      showError(errText(e));
      await refresh();
      return;
    }
    editing = null; // abandonne une édition précédente
    expandAncestors(path);
    await refresh();
    kinds.set(path, kind);
    selected = path;
    selectedKind = kind;
    startEdit(path, true);
    if (kind === "note") handlers.onOpen(path);
  };

  const trash = async (rel: string): Promise<void> => {
    const name = baseOf(rel);
    const ok = await confirmDialog(`Envoyer "${name}" à la Corbeille ?`);
    if (!ok) return;
    try {
      await api.trashEntry(rel);
    } catch (e) {
      showError(errText(e));
      await refresh();
      return;
    }
    if (selected === rel || selected.startsWith(rel + "/")) {
      selected = "";
      selectedKind = null;
    }
    expanded.delete(rel);
    await refresh();
    handlers.onDeleted(rel);
  };

  const canMove = (src: string, destDir: string): boolean => {
    if (!src) return false;
    if (destDir === parentOf(src)) return false; // déjà là
    if (destDir === src || destDir.startsWith(src + "/")) return false; // dans lui-même
    return true;
  };

  const dropOn = async (destDir: string, e: DragEvent): Promise<void> => {
    clearDropMarks();
    const src = dragPath ?? e.dataTransfer?.getData("text/plain") ?? "";
    dragPath = null;
    if (!canMove(src, destDir)) return;
    try {
      const newPath = await api.moveEntry(src, destDir);
      if (destDir) expanded.add(destDir);
      if (selected === src) selected = newPath;
      if (expanded.delete(src)) expanded.add(newPath);
      await refresh();
      handlers.onRenamed(src, newPath);
    } catch (err) {
      showError(errText(err));
      await refresh();
    }
  };

  const rowMenu = (n: TreeNode) => {
    const dir = n.kind === "folder" ? n.path : parentOf(n.path);
    return [
      { label: "Nouvelle note ici", action: () => void createIn(dir, "note") },
      { label: "Nouveau dossier", action: () => void createIn(dir, "folder") },
      { label: "Renommer", action: () => startEdit(n.path, false) },
      { label: "Supprimer", danger: true, action: () => void trash(n.path) },
    ];
  };

  // ---- Événements globaux ----

  newBtn.addEventListener("click", () => void handle.newNote());

  treeEl.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, [
      { label: "Nouvelle note ici", action: () => void createIn("", "note") },
      { label: "Nouveau dossier", action: () => void createIn("", "folder") },
    ]);
  });
  treeEl.addEventListener("keydown", (e) => {
    if (e.key === "F2" && selected && !editing) {
      e.preventDefault();
      startEdit(selected, false);
    }
  });
  treeEl.addEventListener("dragover", (e) => {
    if (!dragPath || !canMove(dragPath, "")) return;
    e.preventDefault();
    clearDropMarks();
    treeEl.classList.add("drop-target");
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  });
  treeEl.addEventListener("dragleave", (e) => {
    if (e.target === treeEl) treeEl.classList.remove("drop-target");
  });
  treeEl.addEventListener("drop", (e) => {
    e.preventDefault();
    void dropOn("", e);
  });

  const handle: SidebarHandle = {
    refresh,
    select(rel: string): void {
      selected = rel;
      selectedKind = kinds.get(rel) ?? (rel.endsWith(".md") ? "note" : "folder");
      expandAncestors(rel);
      if (!editing) render();
    },
    newNote: () => createIn(handle.selectedDir(), "note"),
    selectedDir(): string {
      if (!selected) return "";
      return selectedKind === "folder" ? selected : parentOf(selected);
    },
  };

  void api.onFsChanged(() => void refresh()).catch(() => {});
  return handle;
}
