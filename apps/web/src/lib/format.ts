/** Gregorian calendar, Arabic text; shown in the event's own time zone. */
const LOCALE = 'ar-SA-u-ca-gregory-nu-latn';

export function formatDateTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone,
  }).format(date);
}

export function formatShortDateTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(date);
}

export const TIMEZONES = [
  'Asia/Riyadh',
  'Asia/Dubai',
  'Asia/Kuwait',
  'Asia/Qatar',
  'Asia/Bahrain',
  'Asia/Muscat',
  'Asia/Amman',
  'Africa/Cairo',
  'Europe/London',
];
