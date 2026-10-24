// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { EditorHandle, EditorOptions } from "../editor/editor";
import { createTabs, conflictName, type TabsController, type TabsIO } from "./tabs";

type FakeEditor = EditorHandle & { type(md: string): void; setMarkdown: Mock<(md: string) => void>; destroy: Mock<() => void> };

let disk: Map<string, { content: string; mtime_ms: number }>;
let clock: number;
let editors: Map<string, FakeEditor>;
let io: {
  readNote: Mock<TabsIO["readNote"]>;
  writeNote: Mock<TabsIO["writeNote"]>;
  createNote: Mock<TabsIO["createNote"]>;
};
let messages: string[];

function put(rel: string, content: string): void {
  disk.set(rel, { content, mtime_ms: ++clock });
}

function fakeEditor(_mount: HTMLElement, opts: EditorOptions): EditorHandle {
  let md = opts.markdown;
  const h = {
    view: { focus: vi.fn() } as unknown as EditorHandle["view"],
    getMarkdown: () => md,
    setMarkdown: vi.fn((m: string) => {
      md = m;
    }),
    isDirty: () => false,
    destroy: vi.fn(),
    type(m: string) {
      md = m;
      opts.onChange(m);
    },
  } as FakeEditor;
  editors.set(opts.noteRel, h);
  return h;
}

function setup(extra: { delay?: number } = {}): TabsController {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return createTabs({
    host,
    io,
    makeEditor: fakeEditor,
    autosaveDelayMs: extra.delay ?? 10_000,
    now: () => new Date(2026, 9, 24, 18, 30),
    notify: (m) => messages.push(m),
  });
}

beforeEach(() => {
  disk = new Map();
  clock = 1000;
  editors = new Map();
  messages = [];
  io = {
    readNote: vi.fn(async (rel: string) => {
      const f = disk.get(rel);
      if (!f) throw "Note introuvable";
      return { ...f };
    }),
    writeNote: vi.fn(async (rel: string, content: string) => {
      put(rel, content);
      return disk.get(rel)!.mtime_ms;
    }),
    createNote: vi.fn(async (dir: string, base: string) => {
      const rel = (dir ? dir + "/" : "") + base + ".md";
      put(rel, "");
      return rel;
    }),
  };
  put("a.md", "A");
  put("b.md", "B");
  put("c.md", "C");
  put("Projets/MDnote.md", "# MDnote");
});
afterEach(() => {
  document.body.innerHTML = "";
});

describe("tabs controller", () => {
  it("open_existing_tab_activates_instead_of_duplicating", async () => {
    const tabs = setup();
    await tabs.open("a.md");
    await tabs.open("b.md");
    expect(tabs.active()).toBe("b.md");
    await tabs.open("a.md");
    expect(tabs.list()).toEqual(["a.md", "b.md"]);
    expect(tabs.active()).toBe("a.md");
    expect(io.readNote).toHaveBeenCalledTimes(2);
    // Deux ouvertures simultanées de la même note ne créent qu'un onglet.
    await Promise.all([tabs.open("c.md"), tabs.open("c.md")]);
    expect(tabs.list()).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("close_active_activates_neighbour", async () => {
    const tabs = setup();
    await tabs.open("a.md");
    await tabs.open("b.md");
    await tabs.open("c.md");
    tabs.activate("b.md");
    await tabs.close("b.md");
    expect(tabs.list()).toEqual(["a.md", "c.md"]);
    expect(tabs.active()).toBe("c.md");
    await tabs.close("c.md");
    expect(tabs.active()).toBe("a.md");
    await tabs.close("a.md");
    expect(tabs.active()).toBeNull();
    expect(tabs.list()).toEqual([]);
  });

  it("next_cycles_through_tabs", async () => {
    const tabs = setup();
    await tabs.open("a.md");
    await tabs.open("b.md");
    await tabs.open("c.md");
    tabs.next(1);
    expect(tabs.active()).toBe("a.md");
    tabs.next(-1);
    expect(tabs.active()).toBe("c.md");
  });

  it("switching_tab_flushes_pending_save", async () => {
    const tabs = setup();
    await tabs.open("a.md");
    await tabs.open("b.md");
    editors.get("b.md")!.type("B modifiée");
    tabs.activate("a.md");
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(io.writeNote).toHaveBeenCalledWith("b.md", "B modifiée");
  });

  it("renamed_updates_tab_path_and_saves_to_new_path", async () => {
    const tabs = setup();
    await tabs.open("Projets/MDnote.md");
    tabs.renamed("Projets/MDnote.md", "Projets/Notes.md");
    expect(tabs.list()).toEqual(["Projets/Notes.md"]);
    expect(tabs.active()).toBe("Projets/Notes.md");
    editors.get("Projets/MDnote.md")!.type("v2");
    await tabs.flushAll();
    expect(io.writeNote).toHaveBeenLastCalledWith("Projets/Notes.md", "v2");

    // Renommage d'un dossier : remappage par préfixe.
    tabs.renamed("Projets", "Archive");
    expect(tabs.list()).toEqual(["Archive/Notes.md"]);
    expect(tabs.active()).toBe("Archive/Notes.md");
    editors.get("Projets/MDnote.md")!.type("v3");
    await tabs.flushAll();
    expect(io.writeNote).toHaveBeenLastCalledWith("Archive/Notes.md", "v3");
  });

  it("deleted_closes_tabs_by_folder_prefix_without_saving", async () => {
    const tabs = setup();
    await tabs.open("a.md");
    await tabs.open("Projets/MDnote.md");
    editors.get("Projets/MDnote.md")!.type("unsaved");
    tabs.deleted("Projets");
    expect(tabs.list()).toEqual(["a.md"]);
    expect(tabs.active()).toBe("a.md");
    await tabs.flushAll();
    expect(io.writeNote).not.toHaveBeenCalled();
    expect(editors.get("Projets/MDnote.md")!.destroy).toHaveBeenCalled();
  });

  it("external_change_without_pending_reloads", async () => {
    const tabs = setup();
    await tabs.open("a.md");
    put("a.md", "changé dans VS Code");
    await tabs.externalChange(["a.md"]);
    expect(editors.get("a.md")!.setMarkdown).toHaveBeenCalledWith("changé dans VS Code");
    expect(io.writeNote).not.toHaveBeenCalled();
    expect(io.createNote).not.toHaveBeenCalled();
  });

  it("external_change_with_pending_creates_conflict_copy", async () => {
    const tabs = setup();
    await tabs.open("Projets/MDnote.md");
    editors.get("Projets/MDnote.md")!.type("version locale");
    put("Projets/MDnote.md", "version externe");
    await tabs.externalChange(["Projets/MDnote.md"]);
    expect(io.createNote).toHaveBeenCalledWith("Projets", "MDnote (conflit 2026-10-24 1830)");
    expect(io.writeNote.mock.calls).toEqual([
      ["Projets/MDnote (conflit 2026-10-24 1830).md", "version externe"],
      ["Projets/MDnote.md", "version locale"],
    ]);
    expect(editors.get("Projets/MDnote.md")!.setMarkdown).not.toHaveBeenCalled();
    expect(messages.some((m) => m.includes("MDnote (conflit 2026-10-24 1830)"))).toBe(true);
  });

  it("own_write_echo_is_ignored", async () => {
    const tabs = setup();
    await tabs.open("a.md");
    const ed = editors.get("a.md")!;
    ed.type("mon texte");
    await tabs.flushAll();
    // L'écho arrive avec un mtime différent (ex. horodatage retouché) mais le même contenu.
    disk.set("a.md", { content: "mon texte", mtime_ms: 999_999 });
    await tabs.externalChange(["a.md"]);

    // Écho reçu pendant que l'écriture est encore en cours.
    let release!: () => void;
    io.writeNote.mockImplementationOnce(async (rel: string, content: string) => {
      put(rel, content);
      await new Promise<void>((r) => (release = r));
      return disk.get(rel)!.mtime_ms;
    });
    ed.type("suite");
    const flushing = tabs.flushAll();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(disk.get("a.md")!.content).toBe("suite");
    await tabs.externalChange(["a.md"]);
    release();
    await flushing;

    expect(ed.setMarkdown).not.toHaveBeenCalled();
    expect(io.createNote).not.toHaveBeenCalled();
    expect(io.writeNote).toHaveBeenCalledTimes(2);
  });

  it("external_delete_keeps_tab_marked_missing", async () => {
    const tabs = setup();
    await tabs.open("a.md");
    disk.delete("a.md");
    await tabs.externalChange(["a.md"]);
    expect(tabs.list()).toEqual(["a.md"]);
    expect(tabs.isMissing("a.md")).toBe(true);
    expect(io.writeNote).not.toHaveBeenCalled();
    // Une modification recrée le fichier et lève la marque.
    editors.get("a.md")!.type("recréée");
    await tabs.flushAll();
    expect(disk.get("a.md")?.content).toBe("recréée");
    expect(tabs.isMissing("a.md")).toBe(false);
  });

  it("flushAll_waits_for_pending_saves", async () => {
    const tabs = setup();
    await tabs.open("a.md");
    await tabs.open("b.md");
    const releases: Array<() => void> = [];
    io.writeNote.mockImplementation(async (rel: string, content: string) => {
      await new Promise<void>((r) => releases.push(r));
      put(rel, content);
      return disk.get(rel)!.mtime_ms;
    });
    editors.get("a.md")!.type("A2");
    editors.get("b.md")!.type("B2");
    let done = false;
    const p = tabs.flushAll().then(() => (done = true));
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(done).toBe(false);
    expect(releases.length).toBe(2);
    releases.forEach((r) => r());
    await p;
    expect(done).toBe(true);
    expect(disk.get("a.md")!.content).toBe("A2");
    expect(disk.get("b.md")!.content).toBe("B2");
  });

  it("reload_then_edit_back_to_previous_saved_content_is_written", async () => {
    const tabs = setup();
    await tabs.open("a.md");
    const ed = editors.get("a.md")!;
    ed.type("A1");
    await tabs.flushAll();
    put("a.md", "A1\nB"); // VS Code ajoute une ligne
    await tabs.externalChange(["a.md"]);
    expect(ed.setMarkdown).toHaveBeenCalledWith("A1\nB");
    ed.type("A1"); // suppression de la ligne ajoutée
    await tabs.flushAll();
    expect(disk.get("a.md")!.content).toBe("A1");
  });

  it("conflict_copy_failure_never_overwrites_external_version", async () => {
    let failCreate = true;
    const create = io.createNote.getMockImplementation()!;
    io.createNote.mockImplementation(async (dir, base) => {
      if (failCreate) throw "Disque plein";
      return create(dir, base);
    });
    const tabs = setup();
    await tabs.open("Projets/MDnote.md");
    editors.get("Projets/MDnote.md")!.type("version locale");
    put("Projets/MDnote.md", "version externe");
    await tabs.externalChange(["Projets/MDnote.md"]);
    expect(disk.get("Projets/MDnote.md")!.content).toBe("version externe");
    expect(messages.some((m) => m.includes("Disque plein"))).toBe(true);
    await expect(tabs.flushAll()).rejects.toBeDefined();
    expect(await tabs.close("Projets/MDnote.md")).toBe(false);
    expect(disk.get("Projets/MDnote.md")!.content).toBe("version externe");
    expect(io.writeNote).not.toHaveBeenCalled();

    failCreate = false;
    await tabs.flushAll();
    expect(io.writeNote.mock.calls).toEqual([
      ["Projets/MDnote (conflit 2026-10-24 1830).md", "version externe"],
      ["Projets/MDnote.md", "version locale"],
    ]);
  });

  it("conflict_during_inflight_write_rewrites_local_version", async () => {
    const tabs = setup();
    await tabs.open("a.md");
    let release!: () => void;
    io.writeNote.mockImplementationOnce(async (rel: string, content: string) => {
      put(rel, content);
      await new Promise<void>((r) => (release = r));
      return disk.get(rel)!.mtime_ms;
    });
    editors.get("a.md")!.type("local");
    const flushing = tabs.flushAll();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    put("a.md", "externe"); // l'écriture externe arrive après la nôtre
    const checking = tabs.externalChange(["a.md"]);
    await new Promise((r) => setTimeout(r, 0)); // la vérification voit l'écriture encore en cours
    release();
    await flushing;
    await checking;
    expect(io.createNote).toHaveBeenCalledWith("", "a (conflit 2026-10-24 1830)");
    expect(disk.get("a (conflit 2026-10-24 1830).md")!.content).toBe("externe");
    expect(disk.get("a.md")!.content).toBe("local");
  });

  it("lockUnder_holds_writes_until_released_then_saves_to_new_path", async () => {
    const tabs = setup();
    await tabs.open("Projets/MDnote.md");
    editors.get("Projets/MDnote.md")!.type("pendant le renommage");
    const release = await tabs.lockUnder("Projets");
    let flushed = false;
    const flushing = tabs.flushAll().then(() => (flushed = true));
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(io.writeNote).not.toHaveBeenCalled();
    expect(flushed).toBe(false);
    tabs.renamed("Projets", "Archive");
    release();
    await flushing;
    expect(io.writeNote.mock.calls).toEqual([["Archive/MDnote.md", "pendant le renommage"]]);
  });

  it("lockUnder_waits_for_inflight_write_and_deleted_tab_never_writes", async () => {
    const tabs = setup();
    await tabs.open("a.md");
    let release!: () => void;
    io.writeNote.mockImplementationOnce(async (rel: string, content: string) => {
      await new Promise<void>((r) => (release = r));
      put(rel, content);
      return disk.get(rel)!.mtime_ms;
    });
    const ed = editors.get("a.md")!;
    ed.type("v1");
    void tabs.flushAll().catch(() => {});
    for (let i = 0; i < 5; i++) await Promise.resolve();
    let locked: (() => void) | null = null;
    const lockP = tabs.lockUnder("a.md").then((r) => (locked = r));
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(locked).toBeNull();
    release();
    await lockP;
    ed.type("v2");
    const flushing = tabs.flushAll();
    tabs.deleted("a.md");
    locked!();
    await flushing;
    expect(io.writeNote).toHaveBeenCalledTimes(1);
    expect(disk.get("a.md")!.content).toBe("v1");
  });

  it("restore_opens_active_first_and_skips_missing_files", async () => {
    const tabs = setup();
    const r = tabs.restore(["a.md", "gone.md", "b.md", "c.md"], "b.md");
    await r.active;
    expect(tabs.active()).toBe("b.md");
    expect(io.readNote.mock.calls[0][0]).toBe("b.md");
    await r.all;
    expect(tabs.list()).toEqual(["a.md", "b.md", "c.md"]);
    expect(tabs.active()).toBe("b.md");
  });
});

describe("conflictName", () => {
  it("formats the conflict copy name", () => {
    expect(conflictName("Projets/MDnote.md", new Date(2026, 0, 5, 7, 3))).toEqual({
      dir: "Projets",
      base: "MDnote (conflit 2026-01-05 0703)",
    });
    expect(conflictName("Courses.md", new Date(2026, 9, 24, 18, 30)).dir).toBe("");
  });
});
