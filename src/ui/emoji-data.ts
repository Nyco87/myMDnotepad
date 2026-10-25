import { t } from "../i18n";

/** Emoji palette content and order, validated in the spec (section 6.9). */
export const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  { get label() { return t("emoji.validation"); }, emojis: ["✅", "✔️", "❌", "✖️", "☑️", "👍", "👎"] },
  { get label() { return t("emoji.alert"); }, emojis: ["⚠️", "⛔", "🚫", "❗", "❓", "ℹ️", "💡", "🔥"] },
  { get label() { return t("emoji.progress"); }, emojis: ["⏳", "🚧", "⏸️", "🔄", "🚀", "🐛", "🔒"] },
  { get label() { return t("emoji.circles"); }, emojis: ["🔴", "🟠", "🟡", "🟢", "🔵", "🟣", "🟤", "⚫", "⚪"] },
  { get label() { return t("emoji.squares"); }, emojis: ["🟥", "🟧", "🟨", "🟩", "🟦", "🟪", "🟫", "⬛", "⬜"] },
  { get label() { return t("emoji.arrows"); }, emojis: ["⬅️", "➡️", "⬆️", "⬇️", "↗️", "↘️", "↔️", "↕️", "↩️"] },
  { get label() { return t("emoji.marks"); }, emojis: ["⭐", "📌", "📅", "⏰", "📎", "🔗", "📝", "❤️"] },
];
