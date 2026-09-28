import { parsePhoneNumberFromString } from 'libphonenumber-js';

/** Arabic-Indic (٠-٩) and Extended Arabic-Indic (۰-۹) digits to ASCII. */
export function toAsciiDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (d) => {
    const code = d.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

export type PhoneProblem = 'missing_phone' | 'invalid_phone' | 'unsupported_phone';
export type PhoneResult = { ok: true; e164: string } | { ok: false; problem: PhoneProblem };

/** Characters that may appear in a single phone number as people type it. */
const ALLOWED = /^\+?[0-9\s\-().‎‏‪-‮]+$/;

/**
 * Parses one phone number to E.164, Saudi Arabia being the default region:
 * 0551234567, 551234567, +966551234567 and 00966551234567 all become +966551234567.
 * Valid international numbers are accepted. Nothing is guessed: anything that isn't clearly
 * one number (letters, two numbers in one cell, an extension, Excel's 9.66E+11 form) is
 * `unsupported_phone`; a number that parses but can't exist is `invalid_phone`.
 */
export function parsePhone(input: string | null | undefined): PhoneResult {
  const text = toAsciiDigits(input ?? '').trim();
  if (text === '') return { ok: false, problem: 'missing_phone' };
  if (!ALLOWED.test(text) || text.indexOf('+', 1) !== -1) {
    return { ok: false, problem: 'unsupported_phone' };
  }
  let digits = text.replace(/[^0-9+]/g, '');
  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`;
  // "966551234567" is the international form without its plus sign.
  if (/^966[0-9]{9}$/.test(digits)) digits = `+${digits}`;
  const count = digits.replace('+', '').length;
  if (count < 7 || count > 15) return { ok: false, problem: 'invalid_phone' };
  const parsed = parsePhoneNumberFromString(digits, 'SA');
  if (!parsed?.isValid()) return { ok: false, problem: 'invalid_phone' };
  return { ok: true, e164: parsed.number };
}

/** E.164 for a valid number, otherwise null. */
export function normalizePhone(input: string): string | null {
  const result = parsePhone(input);
  return result.ok ? result.e164 : null;
}

/**
 * The digits to look for in stored E.164 numbers when someone searches by phone. A leading
 * 00 or local trunk 0 is dropped, so "0551" finds +966551…. Returns null for fewer than three
 * digits or text that isn't a number.
 */
export function phoneSearchDigits(query: string): string | null {
  const text = toAsciiDigits(query).trim();
  if (!/^\+?[0-9\s\-()]+$/.test(text)) return null;
  let digits = text.replace(/[^0-9]/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = digits.slice(1);
  return digits.length >= 3 ? digits : null;
}

/** A stored E.164 number for display: "+966 55 123 4567". */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  const parsed = parsePhoneNumberFromString(e164);
  return parsed ? parsed.formatInternational() : e164;
}
