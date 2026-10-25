// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const initialTree = {
  name: "",
  path: "",
  kind: "folder",
  children: [
    {
      name: "Projets",
      path: "Projets",
      kind: "folder",
      children: [
        { name: "MDnote", path: "Projets/MDnote", kind: "folder", children: [] },
        { name: "Idées", path: "Projets/Idées.md", kind: "note" },
      ],
    },
    { name: "Courses", path: "Courses.md", kind: "note" },
  ],
};

let tree: any = structuredClone(initialTree);
function addNode(dir: string, name: string, kind: "folder" | "note"): string {
  let node = tree;
  for (const part of dir.split("/").filter(Boolean)) node = node.children.find((c: any) => c.name === part);
  const path = (dir ? dir + "/" : "") + name + (kind === "note" ? ".md" : "");
  node.children.push(kind === "note" ? { name: name + ".md", path, kind } : { name, path, kind, children: [] });
  return path;
}

let fsCb: ((p: string[]) => void) | null = null;
vi.mock("../api", () => ({
  listTree: vi.fn(async () => tree),
  createNote: vi.fn(async (dir: string, base: string) => addNode(dir, base, "note")),
  createFolder: vi.fn(async (dir: string, base: string) => addNode(dir, base, "folder")),
  renameEntry: vi.fn(async (rel: string, name: string) => {
    const i = rel.lastIndexOf("/");
    return { rel: (i >= 0 ? rel.slice(0, i + 1) : "") + name + (rel.endsWith(".md") ? ".md" : "") };
  }),
  moveEntry: vi.fn(async (rel: string, dest: string) => ({ rel: `${dest ? dest + "/" : ""}${rel.split("/").pop()}` })),
  trashEntry: vi.fn(async () => {}),
  onFsChanged: vi.fn(async (cb: (p: string[]) => void) => {
    fsCb = cb;
    return () => {};
  }),
}));
vi.mock("./context-menu", () => ({ showContextMenu: vi.fn() }));

import * as api from "../api";
import { showContextMenu } from "./context-menu";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mountSidebar } from "./sidebar";

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

async function setup() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const handlers = { onOpen: vi.fn(), onRenamed: vi.fn(), onDeleted: vi.fn() };
  const sb = mountSidebar(el, handlers);
  await sb.refresh();
  const row = (path: string) => el.querySelector(`[data-path="${path}"]`) as HTMLElement;
  return { el, handlers, sb, row };
}

function dnd(type: string, data: string): Event {
  const e = new Event(type, { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown };
  e.dataTransfer = { setData: vi.fn(), getData: () => data, effectAllowed: "", dropEffect: "" };
  return e;
}

beforeEach(() => {
  vi.clearAllMocks();
  tree = structuredClone(initialTree);
});
afterEach(() => {
  document.body.innerHTML = "";
});

describe("sidebar", () => {
  it("renders_tree_with_new_note_button_first", async () => {
    const { el } = await setup();
    const first = el.firstElementChild as HTMLElement;
    expect(first.tagName).toBe("BUTTON");
    expect(first.textContent).toContain("＋ Nouvelle note");
    expect(first.textContent).toContain("Ctrl+N");
    expect(el.querySelector('[data-path="Courses.md"]')?.textContent).toContain("Courses");
    expect(el.querySelector('[data-path="Courses.md"]')?.textContent).not.toContain(".md");
  });

  it("folder_rows_carry_the_folder_class_and_are_styled_in_accent_bold_italic", async () => {
    const { row } = await setup();
    expect(row("Projets").classList.contains("folder")).toBe(true);
    expect(row("Courses.md").classList.contains("folder")).toBe(false);
    const css = readFileSync(resolve(__dirname, "../styles/theme.css"), "utf8");
    const rule = /\.sb-row\.folder \{[^}]*\}/.exec(css)![0];
    expect(rule).toContain("color: var(--accent)");
    expect(rule).toContain("font-weight: 700");
    expect(rule).toContain("font-style: italic");
    expect(/\.sb-row\.note[^{]*\{[^}]*(font-style|color: var\(--accent\))/.test(css)).toBe(false);
  });

  it("new_note_uses_selected_folder", async () => {
    const { sb, row } = await setup();
    row("Projets").click(); // expand
    row("Projets/MDnote").click();
    expect(sb.selectedDir()).toBe("Projets/MDnote");
    sb.select("Projets/MDnote");
    await sb.newNote();
    expect(api.createNote).toHaveBeenCalledWith("Projets/MDnote", "Nouvelle note");
  });

  it("selectedDir_is_parent_of_selected_note_or_root", async () => {
    const { sb } = await setup();
    expect(sb.selectedDir()).toBe("");
    sb.select("Projets/Idées.md");
    expect(sb.selectedDir()).toBe("Projets");
  });

  it("new_note_enters_inline_rename_and_commits_on_enter", async () => {
    const { el, sb, handlers } = await setup();
    sb.select("Projets");
    await sb.newNote();
    await flush();
    const input = el.querySelector("input.sb-rename") as HTMLInputElement;
    expect(input.value).toBe("Nouvelle note");
    expect(handlers.onOpen).toHaveBeenCalledWith("Projets/Nouvelle note.md");
    input.value = "Courses2";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flush();
    expect(api.renameEntry).toHaveBeenCalledWith("Projets/Nouvelle note.md", "Courses2");
    expect(handlers.onOpen).toHaveBeenLastCalledWith("Projets/Courses2.md");
    expect(handlers.onRenamed).toHaveBeenCalledWith("Projets/Nouvelle note.md", "Projets/Courses2.md");
  });

  it("same_name_does_not_call_rename", async () => {
    const { el, sb, handlers } = await setup();
    await sb.newNote();
    await flush();
    const input = el.querySelector("input.sb-rename") as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flush();
    expect(api.renameEntry).not.toHaveBeenCalled();
    expect(el.querySelector("input.sb-rename")).toBeNull();
    expect(handlers.onOpen).toHaveBeenCalledWith("Nouvelle note.md");
  });

  it("escape_keeps_the_name", async () => {
    const { el, sb } = await setup();
    await sb.newNote();
    await flush();
    const input = el.querySelector("input.sb-rename") as HTMLInputElement;
    input.value = "Autre";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flush();
    expect(api.renameEntry).not.toHaveBeenCalled();
    expect(el.querySelector("input.sb-rename")).toBeNull();
  });

  it("invalid_name_shows_error_and_keeps_editing", async () => {
    vi.mocked(api.renameEntry).mockRejectedValueOnce("Ce nom contient un caractère interdit : ?");
    const { el, sb } = await setup();
    await sb.newNote();
    await flush();
    const input = el.querySelector("input.sb-rename") as HTMLInputElement;
    input.value = "a?";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flush();
    expect(el.querySelector(".sb-rename-error")?.textContent).toBe("Ce nom contient un caractère interdit : ?");
    expect(el.querySelector("input.sb-rename")).not.toBeNull();
  });

  it("clicking_a_note_opens_it_and_a_folder_toggles", async () => {
    const { el, handlers, row } = await setup();
    expect(row("Projets/Idées.md")).toBeNull();
    row("Projets").click();
    expect(row("Projets/Idées.md")).not.toBeNull();
    row("Projets/Idées.md").click();
    expect(handlers.onOpen).toHaveBeenCalledWith("Projets/Idées.md");
    row("Projets").click();
    expect(el.querySelector('[data-path="Projets/Idées.md"]')).toBeNull();
  });

  it("expanded_state_survives_refresh", async () => {
    const { sb, row } = await setup();
    row("Projets").click();
    await sb.refresh();
    expect(row("Projets/Idées.md")).not.toBeNull();
  });

  it("fs_changed_refreshes", async () => {
    await setup();
    await flush();
    expect(fsCb).not.toBeNull();
    const before = vi.mocked(api.listTree).mock.calls.length;
    fsCb!(["x.md"]);
    await flush();
    expect(vi.mocked(api.listTree).mock.calls.length).toBe(before + 1);
  });

  it("context_menu_has_the_four_entries", async () => {
    const { row } = await setup();
    row("Courses.md").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 5, clientY: 6 }));
    const items = vi.mocked(showContextMenu).mock.calls[0][2];
    expect(items.map((i) => i.label)).toEqual(["Nouvelle note ici", "Nouveau dossier", "Renommer", "Supprimer"]);
    expect(items[3].danger).toBe(true);
  });

  it("delete_asks_confirmation", async () => {
    const { row, handlers } = await setup();
    row("Courses.md").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    const del = vi.mocked(showContextMenu).mock.calls[0][2][3];
    del.action();
    await flush();
    const dlg = document.querySelector(".confirm-dialog") as HTMLElement;
    expect(dlg.textContent).toContain('Envoyer "Courses" à la Corbeille ?');
    expect(api.trashEntry).not.toHaveBeenCalled();
    (dlg.querySelector(".confirm-cancel") as HTMLButtonElement).click();
    await flush();
    expect(api.trashEntry).not.toHaveBeenCalled();
    expect(document.querySelector(".confirm-dialog")).toBeNull();

    del.action();
    await flush();
    (document.querySelector(".confirm-ok") as HTMLButtonElement).click();
    await flush();
    expect(api.trashEntry).toHaveBeenCalledWith("Courses.md");
    expect(handlers.onDeleted).toHaveBeenCalledWith("Courses.md");
  });

  it("drag_drop_moves_onto_folder", async () => {
    const { row, handlers } = await setup();
    row("Courses.md").dispatchEvent(dnd("dragstart", "Courses.md"));
    row("Projets").dispatchEvent(dnd("dragover", "Courses.md"));
    row("Projets").dispatchEvent(dnd("drop", "Courses.md"));
    await flush();
    expect(api.moveEntry).toHaveBeenCalledWith("Courses.md", "Projets");
    expect(handlers.onRenamed).toHaveBeenCalledWith("Courses.md", "Projets/Courses.md");
  });

  it("drag_drop_onto_own_folder_is_ignored", async () => {
    const { row } = await setup();
    row("Projets").click();
    row("Projets").dispatchEvent(dnd("dragstart", "Projets"));
    row("Projets/MDnote").dispatchEvent(dnd("drop", "Projets"));
    await flush();
    expect(api.moveEntry).not.toHaveBeenCalled();
  });
  it("rename_commits_on_blur", async () => {
    const { el, sb, handlers } = await setup();
    await sb.newNote();
    await flush();
    const input = el.querySelector("input.sb-rename") as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    input.value = "Par blur";
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const other = document.createElement("button");
    document.body.appendChild(other);
    other.focus();
    await flush();
    expect(api.renameEntry).toHaveBeenCalledWith("Nouvelle note.md", "Par blur");
    expect(handlers.onRenamed).toHaveBeenCalledWith("Nouvelle note.md", "Par blur.md");
    expect(document.activeElement).toBe(other);
    vi.mocked(document.hasFocus).mockRestore();
  });

  it("rerender_does_not_steal_focus_back", async () => {
    const { el, sb, row } = await setup();
    await sb.newNote();
    await flush();
    const input = el.querySelector("input.sb-rename") as HTMLInputElement;
    // La fenêtre perd le focus (Alt+Tab) : pas de validation, et un rendu ne reprend pas le focus.
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    input.blur();
    await flush();
    expect(api.renameEntry).not.toHaveBeenCalled();
    row("Courses.md").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    const again = el.querySelector("input.sb-rename") as HTMLInputElement;
    expect(again).not.toBeNull();
    expect(document.activeElement).not.toBe(again);
    hasFocus.mockRestore();
  });

  it("double_enter_renames_once", async () => {
    let release!: (v: api.Moved) => void;
    vi.mocked(api.renameEntry).mockImplementationOnce(() => new Promise<api.Moved>((r) => (release = r)));
    const { el, sb } = await setup();
    await sb.newNote();
    await flush();
    const input = el.querySelector("input.sb-rename") as HTMLInputElement;
    input.value = "Une fois";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flush();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    release({ rel: "Une fois.md" });
    await flush();
    expect(api.renameEntry).toHaveBeenCalledTimes(1);
  });

  it("refresh_is_single_flight_with_one_trailing_run", async () => {
    const { sb } = await setup();
    const before = vi.mocked(api.listTree).mock.calls.length;
    await Promise.all([sb.refresh(), sb.refresh(), sb.refresh(), sb.refresh()]);
    expect(vi.mocked(api.listTree).mock.calls.length).toBe(before + 2);
  });

  it("cancel_edit_refreshes_the_tree", async () => {
    const { el, sb } = await setup();
    await sb.newNote();
    await flush();
    const before = vi.mocked(api.listTree).mock.calls.length;
    const input = el.querySelector("input.sb-rename") as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flush();
    expect(vi.mocked(api.listTree).mock.calls.length).toBe(before + 1);
  });

  it("errors_go_to_onError_when_provided", async () => {
    vi.mocked(api.createNote).mockRejectedValueOnce("Disque plein");
    const el = document.createElement("div");
    document.body.appendChild(el);
    const onError = vi.fn();
    const sb = mountSidebar(el, { onOpen: vi.fn(), onRenamed: vi.fn(), onDeleted: vi.fn(), onError });
    await sb.refresh();
    await sb.newNote();
    expect(onError).toHaveBeenCalledWith("Disque plein");
    expect((el.querySelector(".sb-banner") as HTMLElement).hidden).toBe(true);
  });
  it("rename_locks_tabs_first_and_notifies_before_refresh", async () => {
    const { el, sb, handlers } = await setup();
    await sb.newNote();
    await flush();
    const release = vi.fn();
    const beforeMutate = vi.fn(async (_rel: string) => release);
    (handlers as any).beforeMutate = beforeMutate;
    const before = vi.mocked(api.listTree).mock.calls.length;
    const input = el.querySelector("input.sb-rename") as HTMLInputElement;
    input.value = "Verrou";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flush();
    expect(beforeMutate).toHaveBeenCalledWith("Nouvelle note.md");
    const order = (m: any, i = 0) => m.mock.invocationCallOrder[i];
    expect(order(beforeMutate)).toBeLessThan(order(api.renameEntry));
    expect(order(handlers.onRenamed)).toBeLessThan(order(api.listTree, before));
    expect(order(release)).toBeLessThan(order(api.listTree, before));
  });

  it("trash_locks_tabs_first_and_notifies_before_refresh", async () => {
    const { row, handlers } = await setup();
    const release = vi.fn();
    const beforeMutate = vi.fn(async (_rel: string) => release);
    (handlers as any).beforeMutate = beforeMutate;
    const before = vi.mocked(api.listTree).mock.calls.length;
    row("Courses.md").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    vi.mocked(showContextMenu).mock.calls[0][2][3].action();
    await flush();
    (document.querySelector(".confirm-ok") as HTMLButtonElement).click();
    await flush();
    const order = (m: any, i = 0) => m.mock.invocationCallOrder[i];
    expect(order(beforeMutate)).toBeLessThan(order(api.trashEntry));
    expect(order(handlers.onDeleted)).toBeLessThan(order(api.listTree, before));
    expect(release).toHaveBeenCalled();
  });

  it("failed_lock_aborts_the_move", async () => {
    const { row, handlers } = await setup();
    const onError = vi.fn();
    (handlers as any).onError = onError;
    (handlers as any).beforeMutate = vi.fn(async () => {
      throw new Error("« Courses » n'a pas pu être enregistrée : Disque plein");
    });
    row("Projets").dispatchEvent(dnd("drop", "Courses.md"));
    await flush();
    expect(api.moveEntry).not.toHaveBeenCalled();
    expect(handlers.onRenamed).not.toHaveBeenCalled();
    expect(onError.mock.calls.flat().join(" ")).toMatch(/Disque plein/);
  });

  it("move_with_warning_follows_new_path_and_shows_warning", async () => {
    vi.mocked(api.moveEntry).mockResolvedValueOnce({ rel: "Projets/Courses.md", warning: "liens non mis à jour" });
    const { row, handlers } = await setup();
    const onError = vi.fn();
    (handlers as any).onError = onError;
    row("Projets").dispatchEvent(dnd("drop", "Courses.md"));
    await flush();
    expect(handlers.onRenamed).toHaveBeenCalledWith("Courses.md", "Projets/Courses.md");
    expect(onError).toHaveBeenCalledWith("liens non mis à jour");
  });

  it("rename_with_warning_follows_new_path_and_shows_warning", async () => {
    vi.mocked(api.renameEntry).mockResolvedValueOnce({ rel: "Courses2.md", warning: "liens non mis à jour" });
    const { row, handlers, el } = await setup();
    const onError = vi.fn();
    (handlers as any).onError = onError;
    row("Courses.md").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    const rename = vi.mocked(showContextMenu).mock.calls[0][2].find((i: any) => /renommer/i.test(i.label));
    rename!.action();
    await flush();
    const input = el.querySelector("input.sb-rename") as HTMLInputElement;
    input.value = "Courses2";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flush();
    expect(handlers.onRenamed).toHaveBeenCalledWith("Courses.md", "Courses2.md");
    expect(onError).toHaveBeenCalledWith("liens non mis à jour");
    expect(el.querySelector("input.sb-rename")).toBeNull();
  });

  it("failed_move_releases_the_lock", async () => {
    vi.mocked(api.moveEntry).mockRejectedValueOnce("Impossible");
    const { row, handlers } = await setup();
    const release = vi.fn();
    (handlers as any).beforeMutate = vi.fn(async () => release);
    row("Courses.md").dispatchEvent(dnd("dragstart", "Courses.md"));
    row("Projets").dispatchEvent(dnd("drop", "Courses.md"));
    await flush();
    expect(release).toHaveBeenCalled();
    expect(handlers.onRenamed).not.toHaveBeenCalled();
  });
});
