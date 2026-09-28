import {
  addGuest,
  addStaff,
  cancelGuest,
  commitImport,
  type CoreContext,
  createEvent,
  createGroup,
  createImportBatch,
  createLogger,
  grantPlatformAdmin,
  isDomainError,
  loadConfig,
  MemoryMailer,
  signUp,
  transitionEvent,
  type TransitionAction,
  utcToLocal,
  verifyEmail,
  writeXlsx,
} from '@gp/core';
import { createDatabase, createPool } from '@gp/db';

// Review data for local and staging demos: pnpm demo:seed
// Creates a demo owner with one event in each lifecycle state (two of them with guests), and a
// demo admin. Everything goes
// through the domain functions (with the clock moved back where an event needs a history), so
// the activity log and invariants are the same as for real use. Refuses to run in production.
const log = createLogger({ name: 'seed-demo' });
const config = loadConfig();
if (config.NODE_ENV === 'production') {
  log.error('demo data is never seeded in production');
  process.exit(2);
}

const DEMO_PASSWORD = 'demo-review-2026';
const OWNER = { email: 'owner@demo.test', fullName: 'نورة العتيبي' };
const ADMIN = { email: 'admin@demo.test', fullName: 'فريق إدارة المنصة' };

const pool = createPool(config.DATABASE_URL, 2);
const mailer = new MemoryMailer();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const realNow = Date.now();
/** A context whose clock reads `offsetMs` from now. */
const at = (offsetMs: number): CoreContext => ({
  db: createDatabase(pool),
  mailer,
  encryptionKey: config.APP_ENCRYPTION_KEY,
  appBaseUrl: config.APP_BASE_URL,
  now: () => new Date(realNow + offsetMs),
});
/** Wall-clock time in Riyadh, rounded to the half hour, as the event form sends it. */
const riyadh = (offsetMs: number) => {
  const d = new Date(realNow + offsetMs);
  d.setUTCMinutes(d.getUTCMinutes() < 30 ? 0 : 30, 0, 0);
  return utcToLocal(d, 'Asia/Riyadh');
};

async function createAccount(who: { email: string; fullName: string }) {
  const ctx = at(-20 * DAY);
  const { userId } = await signUp(ctx, { ...who, password: DEMO_PASSWORD });
  const link = mailer.lastLink('email_verification', who.email);
  const token = link && new URL(link).searchParams.get('token');
  if (token) await verifyEmail(ctx, token);
  return userId;
}

interface DemoEvent {
  createdAgo: number;
  /** Guests added by hand (in these groups) and/or imported from a generated spreadsheet. */
  guests?: { groups: string[]; manual: number; cancelled?: number; imported?: number };
  input: Record<string, unknown>;
  staff?: { displayName: string; phone?: string; isSupervisor?: boolean }[];
  /** Transitions and how long ago each happened. */
  history?: [TransitionAction, number, string?][];
}

const EVENTS: DemoEvent[] = [
  {
    createdAgo: 6 * DAY,
    input: {
      category: 'private',
      type: 'wedding',
      name: 'زواج سارة وعبدالله',
      startsAt: riyadh(12 * DAY + 4 * HOUR),
      endsAt: riyadh(12 * DAY + 9 * HOUR),
      venueName: 'قاعة الفيصلية',
      city: 'الرياض',
      address: 'طريق الملك فهد، حي العليا',
      mapsUrl: 'https://maps.app.goo.gl/demo',
      description: 'قسم النساء في القاعة الكبرى، والرجال في القاعة الغربية.',
      defaultAllowedCompanions: 2,
    },
    staff: [
      { displayName: 'منيرة السبيعي', phone: '0550000101', isSupervisor: true },
      { displayName: 'ريم القحطاني', phone: '0550000102' },
      { displayName: 'هيا الدوسري' },
    ],
    guests: {
      groups: ['عائلة العروس', 'عائلة العريس', 'صديقات العروس', 'زميلات العمل'],
      manual: 46,
      cancelled: 3,
    },
    history: [['activate', 5 * DAY]],
  },
  {
    createdAgo: 14 * DAY,
    input: {
      category: 'business',
      type: 'conference',
      name: 'ملتقى التقنية المالية ٢٠٢٦',
      startsAt: riyadh(-1 * HOUR),
      endsAt: riyadh(7 * HOUR),
      venueName: 'مركز الرياض الدولي للمؤتمرات',
      city: 'الرياض',
      defaultAllowedCompanions: 0,
    },
    staff: [
      { displayName: 'خالد الشهري', phone: '0550000201', isSupervisor: true },
      { displayName: 'فهد المطيري', phone: '0550000202' },
    ],
    guests: { groups: ['المتحدثون', 'الرعاة'], manual: 8, imported: 180 },
    history: [
      ['activate', 13 * DAY],
      ['start', 2 * HOUR],
    ],
  },
  {
    createdAgo: 2 * HOUR,
    input: {
      category: 'private',
      type: 'graduation',
      name: 'حفل تخرج ليان',
      startsAt: riyadh(30 * DAY + 3 * HOUR),
      venueName: 'استراحة الورود',
      city: 'جدة',
      defaultAllowedCompanions: 1,
    },
  },
  {
    createdAgo: 9 * DAY,
    input: {
      category: 'private',
      type: 'private_dinner',
      name: 'عشاء العائلة السنوي',
      startsAt: riyadh(-6 * HOUR),
      endsAt: riyadh(-3 * HOUR),
      venueName: 'مطعم نجد',
      city: 'الرياض',
      defaultAllowedCompanions: 3,
    },
    staff: [{ displayName: 'سلطان الحربي' }],
    history: [
      ['activate', 8 * DAY],
      ['start', 7 * HOUR],
      ['complete', 2 * HOUR],
    ],
  },
  {
    createdAgo: 10 * DAY,
    input: {
      category: 'business',
      type: 'opening',
      name: 'افتتاح فرع الخبر',
      startsAt: riyadh(20 * DAY),
      venueName: 'مجمع الراشد',
      city: 'الخبر',
    },
    history: [
      ['activate', 9 * DAY],
      ['cancel', 1 * DAY, 'تأجل الافتتاح إلى الربع القادم بسبب أعمال التشطيب.'],
    ],
  },
  {
    createdAgo: 60 * DAY,
    input: {
      category: 'business',
      type: 'exhibition',
      name: 'معرض الفنون التشكيلية',
      startsAt: riyadh(-40 * DAY),
      endsAt: riyadh(-40 * DAY + 6 * HOUR),
      venueName: 'حي جاكس',
      city: 'الدرعية',
      defaultAllowedCompanions: 1,
    },
    history: [
      ['activate', 55 * DAY],
      ['start', 40 * DAY + 1 * HOUR],
      ['complete', 40 * DAY - 7 * HOUR],
      ['archive', 5 * DAY],
    ],
  },
];

const FIRST = [
  'محمد',
  'عبدالله',
  'فهد',
  'سلطان',
  'خالد',
  'نورة',
  'سارة',
  'ريم',
  'لمى',
  'هيفاء',
  'عبدالعزيز',
  'منيرة',
  'بدر',
  'غادة',
  'تركي',
  'أمل',
  'ماجد',
  'جود',
  'يوسف',
  'دانة',
  'Sarah',
  'Omar',
];
const FAMILY = [
  'العتيبي',
  'القحطاني',
  'الدوسري',
  'الشمري',
  'الحربي',
  'المطيري',
  'الزهراني',
  'الغامدي',
  'السبيعي',
  'العنزي',
  'الشهري',
  'Al-Harbi',
];
const guestName = (i: number) => `${FIRST[i % FIRST.length]} ${FAMILY[(i * 7) % FAMILY.length]}`;
let phoneSeq = 0;
const nextPhone = () => `05${String(51_000_000 + phoneSeq++ * 37).padStart(8, '0')}`;

async function seedGuests(
  ctx: CoreContext,
  ownerId: string,
  eventId: string,
  spec: NonNullable<DemoEvent['guests']>,
) {
  const groupIds: string[] = [];
  for (const name of spec.groups)
    groupIds.push((await createGroup(ctx, ownerId, eventId, { name })).groupId);
  const ids: string[] = [];
  for (let i = 0; i < spec.manual; i++) {
    const r = await addGuest(ctx, ownerId, eventId, {
      fullName: guestName(i),
      phone: i % 9 === 4 ? `+97150${String(1_000_000 + i).slice(-7)}` : nextPhone(),
      groupId: i % 5 === 4 ? '' : groupIds[i % groupIds.length],
      allowedCompanions: String(i % 4),
      notes: i % 11 === 0 ? 'يحتاج مكانًا قريبًا من المدخل' : '',
    });
    if (r.status === 'saved') ids.push(r.guestId);
  }
  for (const id of ids.slice(0, spec.cancelled ?? 0)) {
    await cancelGuest(ctx, ownerId, eventId, id, { reason: 'اعتذر عن الحضور' });
  }
  if (spec.imported) {
    const rows = Array.from({ length: spec.imported }, (_, i) => [
      guestName(i + 100),
      nextPhone(),
      '',
      i % 6 === 0 ? spec.groups[1]! : i % 4 === 0 ? 'الإعلام' : '',
      '',
      '',
    ]);
    const bytes = writeXlsx(
      'Guests',
      [
        'الاسم',
        'رقم الجوال',
        'البريد الإلكتروني',
        'المجموعة',
        'عدد المرافقين المسموح',
        'ملاحظات',
      ].map((header) => ({ header, width: 20 })),
      rows,
    );
    const { batchId } = await createImportBatch(ctx, ownerId, eventId, {
      name: 'قائمة الحضور.xlsx',
      bytes,
    });
    await commitImport(ctx, ownerId, eventId, batchId);
  }
}

try {
  const ownerId = await createAccount(OWNER);
  const adminId = await createAccount(ADMIN);
  await grantPlatformAdmin(createDatabase(pool), ADMIN.email);

  for (const e of EVENTS) {
    const { eventId } = await createEvent(at(-e.createdAgo), ownerId, e.input);
    for (const s of e.staff ?? []) {
      await addStaff(at(-e.createdAgo + HOUR), ownerId, eventId, s);
    }
    if (e.guests) await seedGuests(at(-e.createdAgo + 2 * HOUR), ownerId, eventId, e.guests);
    for (const [action, ago, reason] of e.history ?? []) {
      await transitionEvent(at(-ago), ownerId, eventId, action, reason ? { reason } : {});
    }
  }
  log.info({ ownerId, adminId, events: EVENTS.length }, 'demo data seeded');
} catch (err) {
  if (isDomainError(err, 'email_taken')) {
    log.info('demo accounts already exist; nothing to do');
  } else {
    log.error({ err }, 'seeding failed');
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
