/** Gregorian calendar, Arabic text, Latin digits; shown in the event's own time zone. */
export const DISPLAY_LOCALE = 'ar-SA-u-ca-gregory-nu-latn';

export function formatEventDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(DISPLAY_LOCALE, { dateStyle: 'full', timeZone }).format(date);
}

export function formatEventTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(DISPLAY_LOCALE, { timeStyle: 'short', timeZone }).format(date);
}
