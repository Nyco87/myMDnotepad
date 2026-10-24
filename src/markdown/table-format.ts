export type Align = "left" | "center" | "right";

// Small, dependency-free approximation of terminal/editor column widths.
const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{20000}-\u{3FFFD}]/u;
const EMOJI = /\p{Emoji_Presentation}/u;
const PICTO = /\p{Extended_Pictographic}/u;
const ZERO = /[\p{Mn}\p{Me}​-‏⁠︀-️\u{E0100}-\u{E01EF}]/u;
const MODIFIER = /\p{Emoji_Modifier}/u;
const REGIONAL = /[\u{1F1E6}-\u{1F1FF}]/u;
const ZWJ = "‍";
const VS16 = "️";

/**
 * Columns a string occupies in a monospace font: East Asian Wide and emoji
 * count 2, combining marks and variation selectors 0. Emoji sequences (ZWJ,
 * skin tones, flags, text pictograph + U+FE0F) count as one emoji.
 */
export function visualWidth(s: string): number {
  let width = 0;
  let prev = "";
  let prevWidth = 0;
  let regionalOpen = false;
  for (const ch of s) {
    let w: number;
    if (ch === VS16) w = PICTO.test(prev) && prevWidth === 1 ? 1 : 0; // "❤" + VS16 → 2 in total
    else if (ZERO.test(ch)) w = 0;
    else if (prev === ZWJ || (MODIFIER.test(ch) && PICTO.test(prev))) w = 0; // part of the previous emoji
    else if (REGIONAL.test(ch)) {
      w = regionalOpen ? 0 : 2; // a flag is a pair of regional indicators
      regionalOpen = !regionalOpen;
    } else if (EMOJI.test(ch) || WIDE.test(ch)) w = 2;
    else w = 1;
    if (!REGIONAL.test(ch)) regionalOpen = false;
    width += w;
    if (ch !== VS16) {
      prev = ch;
      prevWidth = w;
    }
  }
  return width;
}

function separator(align: Align | null, width: number): string {
  switch (align) {
    case "left":
      return ":" + "-".repeat(width - 1);
    case "center":
      return ":" + "-".repeat(width - 2) + ":";
    case "right":
      return "-".repeat(width - 1) + ":";
    default:
      return "-".repeat(width);
  }
}

function pad(text: string, align: Align | null, width: number): string {
  const space = width - visualWidth(text);
  if (align === "right") return " ".repeat(space) + text;
  if (align === "center") return " ".repeat(Math.floor(space / 2)) + text + " ".repeat(Math.ceil(space / 2));
  return text + " ".repeat(space);
}

/**
 * Writes a GFM table with aligned columns. `rows[0]` is the header row and
 * cells are already-serialized inline markdown. Column width is
 * max(3, widest cell); `|` in cells is escaped as `\|`. No trailing newline.
 */
export function formatTable(rows: string[][], align: (Align | null)[]): string {
  const cols = Math.max(align.length, ...rows.map((r) => r.length));
  const cells = rows.map((row) => Array.from({ length: cols }, (_, c) => (row[c] ?? "").replace(/\|/g, "\\|")));
  const widths = Array.from({ length: cols }, (_, c) => Math.max(3, ...cells.map((row) => visualWidth(row[c]))));
  const line = (parts: string[]) => "| " + parts.join(" | ") + " |";
  const out = cells.map((row) => line(row.map((cell, c) => pad(cell, align[c] ?? null, widths[c]))));
  out.splice(1, 0, line(widths.map((w, c) => separator(align[c] ?? null, w))));
  return out.join("\n");
}
