import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  customType,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { authTokenPurpose, locale, platformRole, userStatus } from './enums';

export const citext = customType<{ data: string }>({ dataType: () => 'citext' });
export const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    email: citext('email').notNull(),
    emailVerifiedAt: ts('email_verified_at'),
    phoneE164: text('phone_e164'),
    passwordHash: text('password_hash').notNull(),
    fullName: text('full_name').notNull(),
    locale: locale('locale').notNull().default('ar'),
    platformRole: platformRole('platform_role').notNull().default('none'),
    totpSecretEnc: bytea('totp_secret_enc'),
    totpEnabledAt: ts('totp_enabled_at'),
    // Last accepted 30-second TOTP step, so a code can't be replayed.
    totpLastStep: bigint('totp_last_step', { mode: 'number' }),
    status: userStatus('status').notNull().default('active'),
    disabledAt: ts('disabled_at'),
    lastLoginAt: ts('last_login_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('users_email_key').on(t.email),
    uniqueIndex('users_phone_key')
      .on(t.phoneE164)
      .where(sql`${t.phoneE164} IS NOT NULL`),
    check('users_full_name_len', sql`char_length(${t.fullName}) BETWEEN 1 AND 120`),
    check(
      'users_phone_format',
      sql`${t.phoneE164} IS NULL OR ${t.phoneE164} ~ '^\\+[1-9][0-9]{7,14}$'`,
    ),
    check(
      'users_disabled_consistent',
      sql`(${t.status} = 'disabled') = (${t.disabledAt} IS NOT NULL)`,
    ),
    check(
      'users_totp_enabled_needs_secret',
      sql`${t.totpEnabledAt} IS NULL OR ${t.totpSecretEnc} IS NOT NULL`,
    ),
  ],
);

export const userSessions = pgTable(
  'user_sessions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: bytea('token_hash').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    mfaVerifiedAt: ts('mfa_verified_at'),
    userAgent: text('user_agent'),
  },
  (t) => [
    uniqueIndex('user_sessions_token_hash_key').on(t.tokenHash),
    index('user_sessions_user_idx').on(t.userId),
  ],
);

export const authTokens = pgTable(
  'auth_tokens',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: authTokenPurpose('purpose').notNull(),
    tokenHash: bytea('token_hash').notNull(),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('auth_tokens_token_hash_key').on(t.tokenHash),
    index('auth_tokens_user_idx').on(t.userId, t.purpose),
  ],
);

export const authRateLimits = pgTable('auth_rate_limits', {
  bucket: text('bucket').primaryKey(),
  windowStart: ts('window_start').notNull(),
  count: integer('count').notNull(),
});
