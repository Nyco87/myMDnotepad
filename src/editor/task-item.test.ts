// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
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
});
