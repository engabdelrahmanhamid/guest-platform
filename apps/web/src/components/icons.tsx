import type { ReactNode } from 'react';

/** Small stroke icon set (24px grid, 1.8 stroke). Decorative unless given a label. */
const PATHS: Record<string, ReactNode> = {
  logo: (
    <>
      <path d="M5 20V9l7-5 7 5v11" />
      <path d="M9 20v-6h6v6" />
      <path d="M12 4v2" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
      <circle cx="12" cy="10" r="2.3" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17.5 19a5.5 5.5 0 0 0-2.3-4.5" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.5 5 6v5.5c0 4.3 3 7.8 7 9 4-1.2 7-4.7 7-9V6l-7-2.5Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  logout: (
    <>
      <path d="M14 4h3.5A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5H14" />
      <path d="M10 8 6 12l4 4M6 12h9" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  checkCircle: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.5 12.2 2.4 2.4 4.6-4.8" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v5.5M12 16.2v.3" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.8v.3" />
    </>
  ),
  mail: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
      <path d="m4.5 7 7.5 6 7.5-6" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" />
      <path d="m13.5 6.5 4 4" />
    </>
  ),
  play: <path d="M8 5.5v13l10.5-6.5L8 5.5Z" />,
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="2" />,
  rocket: (
    <>
      <path d="M12 15.5 8.5 12c1.5-4.5 4.5-7.5 10-8.5-1 5.5-4 8.5-6.5 12Z" />
      <path d="M8.5 12H5l2.5-3.5h3.5M12 15.5V19l3.5-2.5V13" />
    </>
  ),
  archive: (
    <>
      <rect x="3.5" y="4.5" width="17" height="4" rx="1.2" />
      <path d="M5 8.5v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9M10 12.5h4" />
    </>
  ),
  x: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  ban: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m6 6 12 12" />
    </>
  ),
  refresh: (
    <>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
      <path d="M19.5 4.5v4h-4" />
    </>
  ),
  chevron: <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />,
  chevronBack: <path d="m9.5 6 6 6-6 6" />,
  star: <path d="m12 4 2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6L12 4Z" />,
  heart: (
    <path d="M12 19.5s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 2.5c0 5.6-7.5 10-7.5 10Z" />
  ),
  ring: (
    <>
      <circle cx="12" cy="14.5" r="5.5" />
      <path d="m9.5 4 2.5 3.5L14.5 4" />
    </>
  ),
  cap: (
    <>
      <path d="m3 9.5 9-4.5 9 4.5-9 4.5-9-4.5Z" />
      <path d="M7 11.5V16c1.5 1.5 3 2 5 2s3.5-.5 5-2v-4.5M21 9.5V14" />
    </>
  ),
  cake: (
    <>
      <path d="M4.5 20v-7a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v7M3 20h18" />
      <path d="M4.5 15c1.5 1 3 1 4.5 0s3-1 4.5 0 3 1 4.5 0M12 11V8M12 5.5v.3" />
    </>
  ),
  dinner: (
    <>
      <path d="M7 3.5v7M5 3.5v4.5a2 2 0 0 0 4 0V3.5M7 10.5V20" />
      <path d="M17 20V3.5c-2 1-3 3.5-3 6.5h3" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3.5" width="6" height="10" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V20.5" />
    </>
  ),
  briefcase: (
    <>
      <rect x="3.5" y="7.5" width="17" height="12" rx="2.5" />
      <path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5M3.5 12.5h17" />
    </>
  ),
  sparkle: (
    <path d="M12 3.5c.6 4.2 2.3 5.9 6.5 6.5-4.2.6-5.9 2.3-6.5 6.5-.6-4.2-2.3-5.9-6.5-6.5 4.2-.6 5.9-2.3 6.5-6.5ZM18.5 16c.3 1.5.9 2.2 2 2.5-1.1.3-1.7 1-2 2.5-.3-1.5-.9-2.2-2-2.5 1.1-.3 1.7-1 2-2.5Z" />
  ),
  door: (
    <>
      <path d="M5.5 20.5h13M7 20.5V4.5h10v16" />
      <path d="M14 12.5v.3" />
    </>
  ),
  award: (
    <>
      <circle cx="12" cy="9.5" r="5.5" />
      <path d="m8.8 14 -1.3 6.5 4.5-2.5 4.5 2.5-1.3-6.5" />
    </>
  ),
  frame: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="m3.5 16 5-5 4 4 2.5-2.5 5.5 5" />
      <circle cx="15.5" cy="9" r="1.5" />
    </>
  ),
  dots: (
    <>
      <circle cx="6" cy="12" r="1.3" />
      <circle cx="12" cy="12" r="1.3" />
      <circle cx="18" cy="12" r="1.3" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4 6 18M18 18l-1.6-1.6M7.6 7.6 6 6" />
    </>
  ),
  list: <path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.3M4.5 12h.3M4.5 17.5h.3" />,
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 8.5-8.5M16.5 6.5l2 2M14.5 8.5l1.5 1.5" />
    </>
  ),
  map: (
    <>
      <path d="m9 5-5 2v12.5l5-2 6 2 5-2V5l-5 2-6-2Z" />
      <path d="M9 5v12.5M15 7v12.5" />
    </>
  ),
  phone: (
    <path d="M6.5 3.5h3l1.5 4-2 1.5a11 11 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2 2A16 16 0 0 1 4.5 5.5a2 2 0 0 1 2-2Z" />
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </>
  ),
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, label }: { name: IconName | string; label?: string }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      {PATHS[name] ?? PATHS.dots}
    </svg>
  );
}

/** Icon per event type, used on the type picker and event cards. */
export const EVENT_TYPE_ICONS: Record<string, IconName> = {
  wedding: 'ring',
  malka: 'heart',
  engagement: 'heart',
  graduation: 'cap',
  birthday: 'cake',
  private_dinner: 'dinner',
  conference: 'mic',
  corporate: 'briefcase',
  product_launch: 'rocket',
  opening: 'door',
  ceremony: 'award',
  exhibition: 'frame',
  other: 'sparkle',
};
