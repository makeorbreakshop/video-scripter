// Pure helpers for channel search. The SQL in channels.ts ranks on three views of
// the query — the text as typed, the "squashed" name (letters and digits only, so
// "I Like To Make Stuff", "iliketomakestuff" and "@Iliketomakestuff" all meet), and
// the handle when the user typed one. No network, no database.
import { parseChannelInput } from './channels-core';

/** Lowercase letters and digits only: what a name looks like typed as a handle. */
export function normalizeName(s: string | null | undefined): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** The handle a user typed (bare @x or a youtube.com/@x URL), lowercased, no '@'. */
export function handleFromInput(input: string): string | null {
  const ref = parseChannelInput(input);
  return ref.kind === 'handle' ? ref.value.slice(1).toLowerCase() : null;
}

export interface SearchTerms {
  /** what was typed, trimmed and lowercased, without a leading '@' */
  text: string;
  /** normalizeName(text) */
  norm: string;
  /** the handle if the input was one, else null */
  handle: string | null;
}

export const MIN_QUERY = 2;

/** Null when there is nothing worth searching for. */
export function searchTerms(input: string): SearchTerms | null {
  const handle = handleFromInput(input);
  const text = handle ?? (input || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (text.length < MIN_QUERY) return null;
  return { text, norm: normalizeName(text), handle };
}
