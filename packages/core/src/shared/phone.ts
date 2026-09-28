import { parsePhoneNumberFromString } from 'libphonenumber-js';

/**
 * Normalizes a phone number to E.164, with Saudi Arabia as the default region
 * (0551234567, 551234567, 00966551234567 and +966551234567 all become +966551234567).
 * Returns null when the number is not valid.
 */
export function normalizePhone(input: string): string | null {
  const cleaned = input.trim().replace(/^00/, '+');
  const parsed = parsePhoneNumberFromString(cleaned, 'SA');
  return parsed?.isValid() ? parsed.number : null;
}
