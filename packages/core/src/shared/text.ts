import { toAsciiDigits } from './phone';

/**
 * Search form of a name: Arabic letter variants unified (أ إ آ ٱ → ا, ى → ي, ة → ه,
 * ؤ → و, ئ → ي), tashkeel and tatweel removed, Latin lowercased without accents, digits in
 * ASCII, spaces collapsed. Only for matching; the name people typed is stored unchanged.
 */
export function searchForm(input: string): string {
  return toAsciiDigits(input)
    .normalize('NFKC')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ـ/g, '')
    .replace(/[ٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .toLowerCase()
    .replace(/[\s‌-‏‪-‮]+/g, ' ')
    .trim()
    .normalize('NFC');
}

/** Trims and collapses inner whitespace, keeping the visible spelling. */
export function cleanText(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

/** Escapes LIKE wildcards so user text matches literally. */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}
