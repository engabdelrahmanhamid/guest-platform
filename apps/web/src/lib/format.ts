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
  { value: 'Asia/Riyadh', label: 'السعودية (توقيت الرياض)' },
  { value: 'Asia/Dubai', label: 'الإمارات (توقيت دبي)' },
  { value: 'Asia/Kuwait', label: 'الكويت' },
  { value: 'Asia/Qatar', label: 'قطر' },
  { value: 'Asia/Bahrain', label: 'البحرين' },
  { value: 'Asia/Muscat', label: 'عُمان' },
  { value: 'Asia/Amman', label: 'الأردن' },
  { value: 'Africa/Cairo', label: 'مصر' },
  { value: 'Europe/London', label: 'المملكة المتحدة' },
];

export function timezoneLabel(tz: string): string {
  return TIMEZONES.find((z) => z.value === tz)?.label ?? tz;
}

export function formatDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: 'full', timeZone }).format(date);
}

export function formatTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, { timeStyle: 'short', timeZone }).format(date);
}

/** Month name and day number for the calendar tile on event cards. */
export function dateTile(date: Date, timeZone: string): { month: string; day: string } {
  return {
    month: new Intl.DateTimeFormat(LOCALE, { month: 'short', timeZone }).format(date),
    day: new Intl.DateTimeFormat(LOCALE, { day: 'numeric', timeZone }).format(date),
  };
}

/** "3 ساعات" style durations for lifecycle offsets. */
/** Arabic count agreement: one, two, 3–10 (plural) and 11+ (singular accusative). */
function arabicCount(n: number, [one, two, few, many]: [string, string, string, string]): string {
  if (n === 1) return one;
  if (n === 2) return two;
  const mod = n % 100;
  if (mod >= 3 && mod <= 10) return `${n} ${few}`;
  return `${n} ${many}`;
}

export function formatMinutes(minutes: number): string {
  const abs = Math.abs(minutes);
  if (abs % 1440 === 0 && abs >= 1440) {
    return arabicCount(abs / 1440, ['يوم واحد', 'يومان', 'أيام', 'يوماً']);
  }
  if (abs % 60 === 0 && abs >= 60) {
    return arabicCount(abs / 60, ['ساعة واحدة', 'ساعتان', 'ساعات', 'ساعة']);
  }
  return arabicCount(abs, ['دقيقة واحدة', 'دقيقتان', 'دقائق', 'دقيقة']);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '');
}

/** Weekday, day and month without the year, e.g. for headlines. */
export function formatDayMonth(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone,
  }).format(date);
}

/** A compact date for lists: "٢٨ سبتمبر". */
export function formatShortDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', timeZone }).format(date);
}

export function formatCount(n: number): string {
  return new Intl.NumberFormat(LOCALE).format(n);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${formatCount(n)} B`;
  if (n < 1024 * 1024) return `${formatCount(Math.round(n / 1024))} KB`;
  return `${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 }).format(n / 1024 / 1024)} MB`;
}
