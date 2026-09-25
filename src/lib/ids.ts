import { customAlphabet } from 'nanoid';

// Lowercase + digits, no look-alikes (0/o/1/l/i) — slugs get read aloud and
// typed by hand in standups.
const SLUG_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

const nanoSlug = customAlphabet(SLUG_ALPHABET, 8);
const nanoToken = customAlphabet(TOKEN_ALPHABET, 32);

export const newSlug = () => nanoSlug();
export const newAdminToken = () => nanoToken();

/** Turn "Platform Squad #2" into "platform-squad-2", for a friendlier URL. */
export function slugifyName(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/g, '');
  return base.length >= 3 ? base : '';
}
