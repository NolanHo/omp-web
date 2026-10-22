import type { TranslationParams } from "./types";

/** Translator shape handed out by the i18n provider. */
type Translator = (key: string, params?: TranslationParams) => string;

/**
 * omp's built-in model role ids, in the order the agent reports them.
 *
 * `modelRoles` in the agent config can add custom roles; those have no bundled
 * translation and keep whatever label the agent sends.
 */
export const BUILTIN_ROLE_IDS = [
  "default",
  "smol",
  "slow",
  "vision",
  "plan",
  "commit",
  "tiny",
  "memory",
  "task",
  "advisor",
  "image",
  "web",
  "speech",
  "dictation",
  "judge",
] as const;

/**
 * Message key that localizes a built-in role's display name.
 * @param roleId omp role id, e.g. `smol`
 * @returns the catalog key, or undefined for roles defined in config
 */
export function roleNameKey(roleId: string): string | undefined {
  return (BUILTIN_ROLE_IDS as readonly string[]).includes(roleId) ? `roles.name.${roleId}` : undefined;
}

/**
 * Localize a model role's display name, falling back to the label omp sent.
 *
 * The role chip keeps the raw id (`SMOL`, `PLAN`, …) so it still maps back to
 * `modelRoles` in the config; only the human-readable name is translated.
 * @param roleId omp role id
 * @param fallbackName label supplied by the agent
 * @param t translator from the i18n provider
 * @returns localized name, or the agent label when no translation exists
 */
export function translateRoleName(roleId: string, fallbackName: string, t: Translator): string {
  const key = roleNameKey(roleId);
  if (!key) return fallbackName;
  const translated = t(key);
  return translated === key ? fallbackName : translated;
}
