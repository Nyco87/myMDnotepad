// Test helper only (never imported by the app): reads theme.css as text, since vitest empties `?raw` CSS imports.
// @ts-expect-error type error without @types/node package
import { readFileSync } from "node:fs";
// @ts-expect-error type error without @types/node package
import process from "node:process";

export function themeCss(): string {
  return readFileSync(`${process.cwd()}/src/styles/theme.css`, "utf8");
}
