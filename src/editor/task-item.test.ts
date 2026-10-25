// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { makeEditor } from "./test-helpers";

describe("task_item node view", () => {
  it("toggles checked when the checkbox is clicked", () => {
    const ed = makeEditor("- [ ] one\n- [x] two\n");
    const boxes = ed.view.dom.querySelectorAll<HTMLInputElement>("input.task-box");
    expect(boxes.length).toBe(2);
    expect(boxes[0].checked).toBe(false);
    expect(boxes[1].checked).toBe(true);
    boxes[0].click();
    expect(ed.getMarkdown()).toBe("- [x] one\n- [x] two\n");
    expect(ed.view.dom.querySelectorAll<HTMLInputElement>("input.task-box")[0].checked).toBe(true);
    ed.view.dom.querySelectorAll<HTMLInputElement>("input.task-box")[1].click();
    expect(ed.getMarkdown()).toBe("- [x] one\n- [ ] two\n");
  });

  it("checkbox_is_themed_dark_with_an_accent_check_mark", () => {
    const css = readFileSync(resolve(__dirname, "../styles/theme.css"), "utf8");
    const box = /\.ProseMirror \.task-box \{[^}]*\}/.exec(css)![0];
    expect(box).toContain("appearance: none");
    expect(box).toContain("background: #2b2b2b");
    expect(box).toContain("1px solid #6b6b6b");
    expect(/\.task-box:checked::after \{[^}]*var\(--accent\)/.test(css)).toBe(true);
    expect(/\.task-box:hover \{[^}]*border-color/.test(css)).toBe(true);
  });
});
