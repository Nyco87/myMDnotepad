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
let stickyMessages: string[];

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

let confirmDiscard: Mock<(message: string, okLabel: string) => Promise<boolean>>;

function setup(extra: { delay?: number } = {}): TabsController {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return createTabs({
    host,
    io,
    makeEditor: fakeEditor,
    autosaveDelayMs: extra.delay ?? 10_000,
    now: () => new Date(2026, 9, 24, 18, 30),
    confirmDiscard,
    notify: (m, opts) => {
      messages.push(m);
      if (opts?.sticky) stickyMessages.push(m);
    },
  });
}

beforeEach(() => {
  confirmDiscard = vi.fn(async () => true);
  disk = new Map();
  clock = 1000;
  editors = new Map();
  messages = [];
  stickyMessages = [];
  io = {
    readNote: vi.fn(async (rel: string) => {
      const f = disk.get(rel);
      if (!f) throw "NOT_FOUND";
      return { ...f };
    }),
    // Comme le backend : compare-and-swap sur le mtime quand `expected` est fourni et que le fichier existe.
    writeNote: vi.fn(async (rel: string, content: string, expected?: number) => {
      const f = disk.get(rel);
      if (expected !== undefined && f && f.mtime_ms !== expected) throw "CONFLICT";
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
    expect(io.writeNote).toHaveBeenCalledWith("b.md", "B modifiée", expect.any(Number));
  });

  it("renamed_updates_tab_path_and_saves_to_new_path", async () => {
    const tabs = setup();
    await tabs.open("Projets/MDnote.md");
    tabs.renamed("Projets/MDnote.md", "Projets/Notes.md");
    expect(tabs.list()).toEqual(["Projets/Notes.md"]);
    expect(tabs.active()).toBe("Projets/Notes.md");
    editors.get("Projets/MDnote.md")!.type("v2");
    await tabs.flushAll();
    expect(io.writeNote).toHaveBeenLastCalledWith("Projets/Notes.md", "v2", expect.any(Number));

    // Renommage d'un dossier : remappage par préfixe.
    tabs.renamed("Projets", "Archive");
    expect(tabs.list()).toEqual(["Archive/Notes.md"]);
    expect(tabs.active()).toBe("Archive/Notes.md");
    editors.get("Projets/MDnote.md")!.type("v3");
    await tabs.flushAll();
    expect(io.writeNote).toHaveBeenLastCalledWith("Archive/Notes.md", "v3", expect.any(Number));
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
      ["Projets/MDnote.md", "version locale", expect.any(Number)],
    ]);
    expect(editors.get("Projets/MDnote.md")!.setMarkdown).not.toHaveBeenCalled();
    expect(messages.some((m) => m.includes("MDnote (conflit 2026-10-24 1830)"))).toBe(true);
    // L'avis de conflit reste affiché jusqu'au clic (revue finale #7).
    expect(stickyMessages.some((m) => m.includes("MDnote (conflit 2026-10-24 1830)"))).toBe(true);
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

  const NOT_UTF8 = "Cette note n'est pas encodée en UTF-8 : ouverture refusée pour ne pas l'abîmer.";

  it("unreadable_file_suspends_saves_and_never_overwrites", async () => {
    const tabs = setup();
    await tabs.open("a.md");
    const real = io.readNote.getMockImplementation()!;
    io.readNote.mockImplementation(async () => {
      throw NOT_UTF8;
    });
    await tabs.externalChange(["a.md"]);
    expect(tabs.isUnreadable("a.md")).toBe(true);
    editors.get("a.md")!.type("local");
    confirmDiscard.mockResolvedValue(false); // l'utilisateur garde ses modifications
    await tabs.flushAll().catch(() => {});
    expect(io.writeNote).not.toHaveBeenCalled();
    const banner = document.querySelector(".note-banner") as HTMLElement;
    expect(banner.hidden).toBe(false);
    expect(banner.textContent).toContain("Réessayer");
    // Le fichier redevient lisible mais son contenu est différent : copie de conflit, puis écriture CAS.
    io.readNote.mockImplementation(real);
    put("a.md", "externe");
    const mtime = disk.get("a.md")!.mtime_ms;
    (banner.querySelector("button") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(disk.get("a.md")!.content).toBe("local"));
    expect(tabs.isUnreadable("a.md")).toBe(false);
    expect(banner.hidden).toBe(true);
    expect([...disk.keys()].some((k) => k.includes("(conflit"))).toBe(true);
    expect(io.writeNote).toHaveBeenCalledWith("a.md", "local", mtime);
  });

  async function unreadableWithEdits(): Promise<TabsController> {
    const tabs = setup();
    put("a.md", "x");
    await tabs.open("a.md");
    io.readNote.mockImplementation(async () => {
      throw NOT_UTF8;
    });
    await tabs.externalChange(["a.md"]);
    editors.get("a.md")!.type("local");
    return tabs;
  }

  it("unreadable_tab_close_asks_then_discards", async () => {
    const tabs = await unreadableWithEdits();
    expect(await tabs.close("a.md")).toBe(true);
    expect(confirmDiscard).toHaveBeenCalledTimes(1);
    expect(confirmDiscard.mock.calls[0][0]).toContain("ne peut pas être lue sur le disque");
    expect(tabs.list()).toEqual([]);
    expect(io.writeNote).not.toHaveBeenCalled();
    expect(messages.join()).not.toContain("UNREADABLE");
  });

  it("unreadable_tab_close_cancelled_keeps_tab", async () => {
    const tabs = await unreadableWithEdits();
    confirmDiscard.mockResolvedValue(false);
    expect(await tabs.close("a.md")).toBe(false);
    expect(tabs.list()).toEqual(["a.md"]);
  });

  it("unreadable_flushAll_and_lockUnder_use_french_message_and_confirm", async () => {
    const tabs = await unreadableWithEdits();
    confirmDiscard.mockResolvedValue(false);
    await expect(tabs.flushAll()).rejects.toThrow(/ne peut pas être lue sur le disque/);
    await expect(tabs.lockUnder("a.md")).rejects.toThrow(/ne peut pas être lue sur le disque/);
    confirmDiscard.mockResolvedValue(true);
    await expect(tabs.flushAll()).resolves.toBeUndefined();
    editors.get("a.md")!.type("again");
    const unlock = await tabs.lockUnder("a.md");
    unlock();
    expect(io.writeNote).not.toHaveBeenCalled();
  });

  it("flushAll_asks_all_confirms_before_discarding_any", async () => {
    const tabs = setup();
    put("a.md", "x");
    put("b.md", "y");
    await tabs.open("a.md");
    await tabs.open("b.md");
    const real = io.readNote.getMockImplementation()!;
    io.readNote.mockImplementation(async () => {
      throw NOT_UTF8;
    });
    await tabs.externalChange(["a.md", "b.md"]);
    editors.get("a.md")!.type("local-a");
    editors.get("b.md")!.type("local-b");
    confirmDiscard.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(tabs.flushAll()).rejects.toThrow(/ne peut pas être lue sur le disque/);
    expect(confirmDiscard).toHaveBeenCalledTimes(2);
    // L'onglet a.md n'a rien perdu : une fois la lecture rétablie, ses modifications sont enregistrées.
    io.readNote.mockImplementation(real);
    await tabs.retryRead("a.md");
    await vi.waitFor(() => expect(disk.get("a.md")!.content).toBe("local-a"));
  });

  it("unreadable_note_is_retried_on_each_fs_change", async () => {
    const tabs = setup();
    await tabs.open("a.md");
    const real = io.readNote.getMockImplementation()!;
    io.readNote.mockImplementation(async () => {
      throw NOT_UTF8;
    });
    await tabs.externalChange(["a.md"]);
    expect(tabs.isUnreadable("a.md")).toBe(true);
    io.readNote.mockImplementation(real);
    await tabs.externalChange(["a.md"]);
    expect(tabs.isUnreadable("a.md")).toBe(false);
  });

  it("missing_only_on_NOT_FOUND", async () => {
    const tabs = setup();
    await tabs.open("a.md");
    await tabs.open("b.md");
    const real = io.readNote.getMockImplementation()!;
    io.readNote.mockImplementation(async (rel: string) => {
      if (rel === "a.md") throw "NOT_FOUND";
      throw NOT_UTF8;
    });
    await tabs.externalChange(["a.md", "b.md"]);
    expect(tabs.isMissing("a.md")).toBe(true);
    expect(tabs.isUnreadable("a.md")).toBe(false);
    expect(tabs.isMissing("b.md")).toBe(false);
    expect(tabs.isUnreadable("b.md")).toBe(true);
    io.readNote.mockImplementation(real);
  });

  it("writes_always_pass_last_known_mtime", async () => {
    const tabs = setup();
    await tabs.open("a.md");
    const mtime = disk.get("a.md")!.mtime_ms;
    disk.delete("a.md");
    await tabs.externalChange(["a.md"]);
    expect(tabs.isMissing("a.md")).toBe(true);
    editors.get("a.md")!.type("recréée");
    await tabs.flushAll();
    expect(io.writeNote).toHaveBeenCalledWith("a.md", "recréée", mtime);
  });

  it("final_conflict_failure_message_is_french", async () => {
    const tabs = setup({ delay: 5 });
    await tabs.open("a.md");
    io.writeNote.mockImplementation(async () => {
      throw "CONFLICT";
    });
    editors.get("a.md")!.type("x");
    await vi.waitFor(() => expect(messages.length).toBeGreaterThan(0));
    expect(messages[0]).toBe("La note « a » est modifiée ailleurs en ce moment ; nouvel essai au prochain changement.");
    expect(messages.join("")).not.toContain("CONFLICT");
    expect(io.writeNote).toHaveBeenCalledTimes(6);
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
    expect(stickyMessages.some((m) => m.includes("Disque plein"))).toBe(true);
    await expect(tabs.flushAll()).rejects.toBeDefined();
    expect(await tabs.close("Projets/MDnote.md")).toBe(false);
    expect(disk.get("Projets/MDnote.md")!.content).toBe("version externe");
    expect(io.writeNote).not.toHaveBeenCalled();

    failCreate = false;
    await tabs.flushAll();
    expect(io.writeNote.mock.calls).toEqual([
      ["Projets/MDnote (conflit 2026-10-24 1830).md", "version externe"],
      ["Projets/MDnote.md", "version locale", expect.any(Number)],
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
    // lockUnder enregistre d'abord les frappes en file (revue finale #3) : on tape donc pendant le verrou.
    const release = await tabs.lockUnder("Projets");
    editors.get("Projets/MDnote.md")!.type("pendant le renommage");
    let flushed = false;
    const flushing = tabs.flushAll().then(() => (flushed = true));
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(io.writeNote).not.toHaveBeenCalled();
    expect(flushed).toBe(false);
    tabs.renamed("Projets", "Archive");
    release();
    await flushing;
    expect(io.writeNote.mock.calls).toEqual([["Archive/MDnote.md", "pendant le renommage", expect.any(Number)]]);
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

  it("external_edit_landing_before_watcher_event_is_not_overwritten", async () => {
    // Régression (revue finale #1) : OneDrive/VS Code écrit le fichier, l'autosave part avant l'événement du watcher.
    const tabs = setup();
    await tabs.open("a.md");
    editors.get("a.md")!.type("A locale");
    put("a.md", "A externe (OneDrive)"); // le debounce du watcher (250 ms) n'a pas encore tiré
    await tabs.flushAll(); // le minuteur d'autosave tire d'abord
    await tabs.externalChange(["a.md"]); // puis l'événement du watcher arrive
    expect(disk.get("a.md")!.content).toBe("A locale");
    expect(disk.get("a (conflit 2026-10-24 1830).md")?.content).toBe("A externe (OneDrive)");
    expect(messages.some((m) => m.includes("a (conflit 2026-10-24 1830)"))).toBe(true);
    expect(editors.get("a.md")!.setMarkdown).not.toHaveBeenCalled();
  });

  it("mtime_only_change_retries_without_conflict_copy", async () => {
    const tabs = setup();
    await tabs.open("a.md");
    editors.get("a.md")!.type("A locale");
    put("a.md", "A"); // horodatage retouché (synchro), même contenu
    await tabs.flushAll();
    expect(disk.get("a.md")!.content).toBe("A locale");
    expect(io.createNote).not.toHaveBeenCalled();
  });

  it("non_utf8_note_is_not_opened_and_error_is_shown", async () => {
    const tabs = setup();
    const msg = "Cette note n'est pas encodée en UTF-8 : ouverture refusée pour ne pas l'abîmer.";
    io.readNote.mockRejectedValueOnce(msg);
    expect(await tabs.open("a.md")).toBe(false);
    expect(tabs.list()).toEqual([]);
    expect(messages.some((m) => m.includes(msg))).toBe(true);
    expect(io.writeNote).not.toHaveBeenCalled();
  });

  it("rename_with_queued_edit_keeps_backend_rewritten_image_links", async () => {
    // Régression (revue finale #3) : une frappe en file pendant un renommage réécrivait les anciens liens d'images.
    put("n.md", "![](images/n-1.png)\n");
    const tabs = setup();
    await tabs.open("n.md");
    editors.get("n.md")!.type("![](images/n-1.png)\nhello\n"); // en file (debounce pas encore tiré)
    const release = await tabs.lockUnder("n.md"); // sidebar.mutate
    // Backend rename_entry + follow_note : renomme et réécrit les liens des images possédées.
    const before = disk.get("n.md")!.content;
    disk.delete("n.md");
    put("m.md", before.replace("images/n-1.png", "images/m-1.png"));
    await tabs.renamed("n.md", "m.md");
    release();
    await tabs.flushAll();
    await tabs.externalChange(["m.md"]); // écho du watcher
    expect(disk.get("m.md")!.content).toBe("![](images/m-1.png)\nhello\n");
    expect(editors.get("n.md")!.getMarkdown()).toBe("![](images/m-1.png)\nhello\n");
    expect(disk.has("n.md")).toBe(false);
    expect(io.createNote).not.toHaveBeenCalled();
  });

  it("edit_typed_during_rename_keeps_both_versions", async () => {
    put("n.md", "![](images/n-1.png)\n");
    const tabs = setup();
    await tabs.open("n.md");
    const release = await tabs.lockUnder("n.md");
    editors.get("n.md")!.type("![](images/n-1.png)\npendant\n"); // frappe pendant l'opération backend
    disk.delete("n.md");
    put("m.md", "![](images/m-1.png)\n");
    await tabs.renamed("n.md", "m.md");
    release();
    await tabs.flushAll();
    expect(disk.get("m.md")!.content).toBe("![](images/n-1.png)\npendant\n");
    expect(disk.get("m (conflit 2026-10-24 1830).md")!.content).toBe("![](images/m-1.png)\n");
  });

  it("folder_rename_reloads_open_notes_inside", async () => {
    const tabs = setup();
    await tabs.open("Projets/MDnote.md");
    const release = await tabs.lockUnder("Projets");
    disk.delete("Projets/MDnote.md");
    put("Archive/MDnote.md", "# MDnote\n![](../images/x.png)"); // lien réécrit par le backend
    await tabs.renamed("Projets", "Archive");
    release();
    expect(editors.get("Projets/MDnote.md")!.setMarkdown).toHaveBeenCalledWith("# MDnote\n![](../images/x.png)");
    editors.get("Projets/MDnote.md")!.type("# MDnote\n![](../images/x.png)\nsuite");
    await tabs.flushAll();
    expect(disk.get("Archive/MDnote.md")!.content).toBe("# MDnote\n![](../images/x.png)\nsuite");
    expect(io.createNote).not.toHaveBeenCalled();
  });

  it("lockUnder_rejects_when_pending_edit_cannot_be_saved", async () => {
    const tabs = setup();
    await tabs.open("a.md");
    io.writeNote.mockRejectedValue("Disque plein");
    editors.get("a.md")!.type("A2");
    await expect(tabs.lockUnder("a.md")).rejects.toThrow(/Disque plein/);
    // Pas de verrou laissé en place : une écriture réussie passe ensuite.
    io.writeNote.mockReset();
    io.writeNote.mockImplementation(async (rel: string, content: string) => {
      put(rel, content);
      return disk.get(rel)!.mtime_ms;
    });
    await tabs.flushAll();
    expect(disk.get("a.md")!.content).toBe("A2");
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
