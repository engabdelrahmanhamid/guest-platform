/** Query keys of the guests page. Anything else in the URL is dropped when building links. */
const KEYS = [
  'q',
  'status',
  'group',
  'source',
  'sort',
  'page',
  'pageSize',
  'guest',
  'panel',
  'log',
] as const;
export type GuestsParams = Partial<Record<(typeof KEYS)[number] | 'done' | 'n', string>>;

/** Defaults are left out of the URL so links stay short. */
const DEFAULTS: Record<string, string> = {
  status: 'all',
  group: 'all',
  source: 'all',
  sort: 'recent',
  page: '1',
  pageSize: '50',
};

/** Builds a guests-page link from the current params plus changes (null removes a key). */
export function guestsHref(
  base: string,
  current: GuestsParams,
  changes: GuestsParams | Record<string, string | null> = {},
): string {
  const url = new URLSearchParams();
  const merged: Record<string, string | null | undefined> = { ...current, ...changes };
  for (const k of KEYS) {
    const v = merged[k];
    if (v !== undefined && v !== null && v !== '' && DEFAULTS[k] !== v) url.set(k, v);
  }
  const qs = url.toString();
  return qs ? `${base}?${qs}` : base;
}

export function pickParams(sp: Record<string, string | string[] | undefined>): GuestsParams {
  const out: GuestsParams = {};
  for (const k of [...KEYS, 'done', 'n'] as const) {
    const v = sp[k];
    if (typeof v === 'string') out[k] = v.slice(0, 200);
  }
  return out;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
