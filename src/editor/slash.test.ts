// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { createEditor, type EditorHandle } from "./editor";
import { filterCommands, normalizeForSearch, slashQuery } from "./slash";
import { buildSlashCommands, type SlashActions } from "./slash-commands";
import { parseMarkdown } from "../markdown/parse";
import { schema } from "../markdown/schema";
import { pressKey, setCursor, typeInto, cursorAtEnd } from "./test-helpers";

const actions = (): SlashActions & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    table: () => calls.push("table"),
    link: () => calls.push("link"),
    image: () => calls.push("image"),
    symbols: () => calls.push("symbols"),
    diagram: () => calls.push("diagram"),
  };
};
const ALL = buildSlashCommands(actions());
const labels = (cmds: { label: string }[]): string[] => cmds.map((c) => c.label);

/** State with the cursor at the end of the first textblock of `md`. */
function stateAtEnd(md: string): EditorState {
  const doc = parseMarkdown(md);
  let state = EditorState.create({ schema, doc });
  let pos = -1;
  doc.descendants((node, p) => {
    if (node.isTextblock && pos < 0) pos = p + 1 + node.content.size;
  });
  state = state.apply(state.tr.setSelection(TextSelection.create(doc, pos)));
  return state;
}

describe("slashQuery", () => {
  it("opens at the start of a paragraph", () => expect(slashQuery(stateAtEnd("/\n"))?.query).toBe(""));
  it("opens after a space", () => {
    const q = slashQuery(stateAtEnd("texte /tab\n"));
    expect(q?.query).toBe("tab");
    expect(q?.from).toBe(1 + "texte ".length);
  });
  it.each(["https://a/b", "24/10", "et/ou", "C:/x"])("does not open inside %s", (t) => {
    expect(slashQuery(stateAtEnd(t + "\n"))).toBeNull();
  });
  it("does not open in a code block", () => expect(slashQuery(stateAtEnd("```\n/ti\n```\n"))).toBeNull());
  it("does not open in inline code", () => expect(slashQuery(stateAtEnd("`/ti`\n"))).toBeNull());
  it("closes after a space following an unmatched query", () => {
    const doc = schema.node("doc", null, [schema.node("paragraph", null, [schema.text("/zzz ")])]);
    const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, 6) });
    expect(slashQuery(state)).toBeNull();
  });
  it("does not open with a range selection", () => {
    const state = stateAtEnd("/ti\n");
    const ranged = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 3)));
    expect(slashQuery(ranged)).toBeNull();
  });
});

describe("filterCommands", () => {
  it("normalizes accents and case", () => expect(normalizeForSearch("Tâches É")).toBe("taches e"));
  it("tab -> Tableau first", () => expect(filterCommands(ALL, "tab", false)[0].label).toBe("Tableau"));
  it("att -> Alerte — Attention", () => expect(labels(filterCommands(ALL, "att", false))).toEqual(["Alerte — Attention"]));
  it("todo -> Tâches", () => expect(labels(filterCommands(ALL, "todo", false))).toEqual(["Tâches"]));
  it("titre -> Titre 1, 2, 3", () => expect(labels(filterCommands(ALL, "titre", false))).toEqual(["Titre 1", "Titre 2", "Titre 3"]));
  it("ecart -> nothing", () => expect(filterCommands(ALL, "ecart", false)).toEqual([]));
  it("is case and accent insensitive", () => {
    expect(labels(filterCommands(ALL, "paragraphe", false))).toEqual(labels(filterCommands(ALL, "Paragraphe", false)));
    expect(labels(filterCommands(ALL, "taches", false))).toEqual(["Tâches"]);
  });
  it("keywords from the spec", () => {
    expect(labels(filterCommands(ALL, "checkbox", false))).toEqual(["Tâches"]);
    expect(labels(filterCommands(ALL, "hr", false))[0]).toBe("Séparateur");
    expect(labels(filterCommands(ALL, "mermaid", false))).toEqual(["Schéma"]);
    expect(labels(filterCommands(ALL, "emoji", false))).toEqual(["Symboles"]);
    expect(labels(filterCommands(ALL, "code", false))[0]).toBe("Bloc de code");
  });
  it("exact list of labels", () => {
    expect(labels(ALL).sort()).toEqual(
      [
        "Titre 1", "Titre 2", "Titre 3", "Paragraphe", "Liste à puces", "Liste numérotée", "Tâches", "Citation",
        "Bloc de code", "Tableau", "Lien", "Image", "Séparateur", "Symboles", "Schéma",
        "Alerte — Note", "Alerte — Astuce", "Alerte — Important", "Alerte — Attention", "Alerte — Danger",
      ].sort(),
    );
  });
  it("Schéma is not listed without a diagram action", () => {
    const { diagram: _unused, ...rest } = actions();
    expect(labels(buildSlashCommands(rest))).not.toContain("Schéma");
  });
  it("in a table cell only Symboles, Lien and Image remain", () => {
    expect(labels(filterCommands(ALL, "", true)).sort()).toEqual(["Image", "Lien", "Symboles"]);
    expect(filterCommands(ALL, "titre", true)).toEqual([]);
  });
  it("empty query lists everything grouped", () => {
    const groups = filterCommands(ALL, "", false).map((c) => c.group);
    expect(groups).toEqual([...groups].sort((a, b) => ["Blocs", "Alertes", "Insérer"].indexOf(a) - ["Blocs", "Alertes", "Insérer"].indexOf(b)));
  });
});

describe("slash menu plugin", () => {
  let made: EditorHandle[] = [];
  let acts = actions();
  function mk(md: string): EditorHandle {
    acts = actions();
    const commands = buildSlashCommands(acts);
    const ed = createEditor(document.createElement("div"), {
      markdown: md,
      onChange: () => {},
      noteRel: "a.md",
      slashCommands: () => commands,
    });
    made.push(ed);
    return ed;
  }
  const menu = (): HTMLElement | null => document.querySelector(".slash-menu");
  const shown = (): string[] => [...document.querySelectorAll(".slash-item .slash-label")].map((e) => e.textContent!);
  afterEach(() => {
    made.forEach((e) => e.destroy());
    made = [];
    document.body.innerHTML = "";
  });

  it("typing /ti shows the filtered entries", () => {
    const ed = mk("\n");
    typeInto(ed.view, "/ti");
    expect(menu()).not.toBeNull();
    expect(shown().slice(0, 3)).toEqual(["Titre 1", "Titre 2", "Titre 3"]);
  });

  it("no menu in ordinary text", () => {
    const ed = mk("\n");
    typeInto(ed.view, "https://a/b");
    expect(menu()).toBeNull();
  });

  it("ArrowDown then Enter runs Titre 2 and removes the /ti text", () => {
    const ed = mk("\n");
    typeInto(ed.view, "/ti");
    expect(pressKey(ed.view, "ArrowDown")).toBe(true);
    expect(pressKey(ed.view, "Enter")).toBe(true);
    const first = ed.view.state.doc.firstChild!;
    expect(first.type.name).toBe("heading");
    expect(first.attrs.level).toBe(2);
    expect(first.textContent).toBe("");
    expect(menu()).toBeNull();
  });

  it("Escape closes the menu and keeps the text", () => {
    const ed = mk("\n");
    typeInto(ed.view, "/ti");
    expect(pressKey(ed.view, "Escape")).toBe(true);
    expect(menu()).toBeNull();
    expect(ed.view.state.doc.firstChild!.textContent).toBe("/ti");
    // Stays closed while the same slash is being edited, Enter is no longer captured.
    typeInto(ed.view, "t");
    expect(menu()).toBeNull();
  });

  it("clicking an entry runs it", () => {
    const ed = mk("\n");
    typeInto(ed.view, "/cit");
    (document.querySelector(".slash-item") as HTMLElement).click();
    expect(ed.view.state.doc.firstChild!.type.name).toBe("blockquote");
  });

  it("/note then Enter creates a note alert", () => {
    const ed = mk("\n");
    typeInto(ed.view, "/note");
    pressKey(ed.view, "Enter");
    const alert = ed.view.state.doc.firstChild!;
    expect(alert.type.name).toBe("alert");
    expect(alert.attrs.kind).toBe("note");
    expect(alert.textContent).toBe("");
  });

  it("typed inside a warning alert, /danger turns it into a caution alert", () => {
    const ed = mk("> [!WARNING]\n> x\n");
    cursorAtEnd(ed.view, "first");
    typeInto(ed.view, " /danger");
    pressKey(ed.view, "Enter");
    expect(ed.view.state.doc.childCount).toBe(1);
    expect(ed.view.state.doc.firstChild!.attrs.kind).toBe("caution");
    expect(ed.view.state.doc.firstChild!.textContent.trim()).toBe("x");
  });

  it("commands that open a window call the provided action", () => {
    const ed = mk("\n");
    typeInto(ed.view, "/tabl");
    pressKey(ed.view, "Enter");
    expect(acts.calls).toEqual(["table"]);
  });

  it("the menu is closed when the cursor leaves the slash text", () => {
    const ed = mk("a\n\n");
    typeInto(ed.view, "/ti");
    expect(menu()).not.toBeNull();
    setCursor(ed.view, 1);
    expect(menu()).toBeNull();
  });

  it("does nothing without commands", () => {
    const ed = createEditor(document.createElement("div"), { markdown: "\n", onChange: () => {}, noteRel: "a.md" });
    made.push(ed);
    typeInto(ed.view, "/ti");
    expect(menu()).toBeNull();
  });

  it("is not triggered by non-menu keys", () => {
    const ed = mk("\n");
    typeInto(ed.view, "/ti");
    expect(pressKey(ed.view, "a")).toBe(false);
  });
});
