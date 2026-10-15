import type { Assignee } from '../../../core/types.ts';

/** localStorage key for the identity picked in the UI. */
export const AUTHOR_STORAGE_KEY = 'gitrac-author';

/** One choice in the "acting as" picker; `value: ''` = server default. */
export interface IdentityOption {
  value: string;
  label: string;
}

/**
 * Picker choices: the server's default (git) identity first, then each
 * configured assignee by display name, skipping duplicates of the default.
 */
export function identityOptions(
  defaultName: string | null,
  assignees: Assignee[],
): IdentityOption[] {
  const options: IdentityOption[] = [
    { value: '', label: defaultName ? `${defaultName} (git)` : 'Git identity' },
  ];
  const seen = new Set<string>(defaultName ? [defaultName] : []);
  for (const a of assignees) {
    const name = a.name.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    options.push({ value: name, label: name });
  }
  return options;
}

/**
 * The `author` to send with a write: the stored choice if it is still one of
 * the configured assignees (and not the default), else undefined so the
 * server attributes it to its git identity.
 */
export function effectiveAuthor(
  stored: string,
  defaultName: string | null,
  assignees: Assignee[],
): string | undefined {
  if (!stored || stored === defaultName) return undefined;
  return assignees.some((a) => a.name.trim() === stored) ? stored : undefined;
}
