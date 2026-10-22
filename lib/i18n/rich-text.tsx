import type { ReactNode } from "react";
import type { TranslationParams } from "./types";

/** Translator shape handed out by the i18n provider. */
export type Translator = (key: string, params?: TranslationParams) => string;

const PLACEHOLDER_ONLY = /^\{([\w.-]+)\}$/;

/**
 * Render a translated sentence with selected placeholders wrapped in `<code>`.
 *
 * The `code` values are deliberately not passed to the translator: leaving
 * `{name}` in the message keeps the placeholder visible after interpolation, so
 * a value can be swapped for an element at the exact position the translation
 * put it. Localized word order therefore keeps the monospace styling that the
 * English-only source used to hard-code with `<code>` elements.
 *
 * @param t translator from the i18n provider
 * @param key message key
 * @param params non-styled interpolation values
 * @param code placeholder name → value to render as inline code
 * @returns an array of text and `<code>` nodes ready to place in JSX
 */
export function translateWithCode(
  t: Translator,
  key: string,
  params: TranslationParams,
  code: Record<string, string | number>,
): ReactNode[] {
  const names = Object.keys(code);
  const text = t(key, params);
  if (names.length === 0) return [text];

  const pattern = new RegExp(`(${names.map((name) => `\\{${name}\\}`).join("|")})`);
  return text.split(pattern).filter((part) => part !== "").map((part, index) => {
    const match = PLACEHOLDER_ONLY.exec(part);
    if (match && code[match[1]] !== undefined) {
      return <code key={`${match[1]}-${index}`}>{String(code[match[1]])}</code>;
    }
    return part;
  });
}
