// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { EMOJI_GROUPS } from "./emoji-data";
import { openEmojiPalette, pushRecent } from "./emoji-palette";

describe("emoji data", () => {
  it("emoji_groups_match_spec", () => {
    expect(EMOJI_GROUPS.map((g) => g.label)).toEqual([
      "Validation",
      "Alerte & info",
      "Avancement",
      "Ronds",
      "Carrés",
      "Flèches",
      "Repères",
    ]);
    expect(EMOJI_GROUPS[3].emojis).toEqual(["🔴", "🟠", "🟡", "🟢", "🔵", "🟣", "🟤", "⚫", "⚪"]);
    expect(EMOJI_GROUPS[0].emojis).toEqual(["✅", "✔️", "❌", "✖️", "☑️", "👍", "👎"]);
    expect(EMOJI_GROUPS[1].emojis).toEqual(["⚠️", "⛔", "🚫", "❗", "❓", "ℹ️", "💡", "🔥"]);
    expect(EMOJI_GROUPS[2].emojis).toEqual(["⏳", "🚧", "⏸️", "🔄", "🚀", "🐛", "🔒"]);
    expect(EMOJI_GROUPS[4].emojis).toEqual(["🟥", "🟧", "🟨", "🟩", "🟦", "🟪", "🟫", "⬛", "⬜"]);
    expect(EMOJI_GROUPS[5].emojis).toEqual(["⬅️", "➡️", "⬆️", "⬇️", "↗️", "↘️", "↔️", "↕️", "↩️"]);
    expect(EMOJI_GROUPS[6].emojis).toEqual(["⭐", "📌", "📅", "⏰", "📎", "🔗", "📝", "❤️"]);
  });
});

describe("emoji code points", () => {
  const cps = (e: string) => [...e].map((c) => c.codePointAt(0)!.toString(16));
  it("keeps the variation selectors", () => {
    expect(cps(EMOJI_GROUPS[0].emojis[1])).toEqual(["2714", "fe0f"]);
    expect(cps(EMOJI_GROUPS[1].emojis[0])).toEqual(["26a0", "fe0f"]);
    expect(cps(EMOJI_GROUPS[6].emojis[7])).toEqual(["2764", "fe0f"]);
    expect(cps(EMOJI_GROUPS[5].emojis[8])).toEqual(["21a9", "fe0f"]);
  });
});

describe("pushRecent", () => {
  it("moves an existing emoji to the front without duplicates", () => {
    expect(pushRecent(["✅", "❌"], "❌")).toEqual(["❌", "✅"]);
  });
  it("is limited to 8 entries", () => {
    const list = ["1", "2", "3", "4", "5", "6", "7", "8"];
    expect(pushRecent(list, "9")).toEqual(["9", "1", "2", "3", "4", "5", "6", "7"]);
    expect(pushRecent(list, "9", 3)).toEqual(["9", "1", "2"]);
  });
  it("does not mutate its input", () => {
    const list = ["✅"];
    pushRecent(list, "❌");
    expect(list).toEqual(["✅"]);
  });
});

describe("openEmojiPalette", () => {
  it("shows Récents first only when non-empty, picks and closes", () => {
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    const onPick = vi.fn();
    openEmojiPalette(anchor, [], onPick);
    expect([...document.querySelectorAll(".emoji-label")].map((e) => e.textContent)[0]).toBe("Validation");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".emoji-palette")).toBeNull();

    openEmojiPalette(anchor, ["🚀"], onPick);
    expect([...document.querySelectorAll(".emoji-label")].map((e) => e.textContent)[0]).toBe("Récents");
    (document.querySelector(".emoji-btn") as HTMLElement).click();
    expect(onPick).toHaveBeenCalledWith("🚀");
    expect(document.querySelector(".emoji-palette")).toBeNull();
  });

  it("closes on outside mousedown", () => {
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    openEmojiPalette(anchor, [], () => {});
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(document.querySelector(".emoji-palette")).toBeNull();
  });
});
