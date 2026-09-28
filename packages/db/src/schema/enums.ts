import { pgEnum } from 'drizzle-orm/pg-core';

export const locale = pgEnum('locale', ['ar', 'en']);
export const platformRole = pgEnum('platform_role', ['none', 'admin']);
export const userStatus = pgEnum('user_status', ['active', 'disabled']);
export const authTokenPurpose = pgEnum('auth_token_purpose', [
  'email_verification',
  'password_reset',
]);
export const workspaceKind = pgEnum('workspace_kind', ['personal', 'organization']);
export const workspaceRole = pgEnum('workspace_role', ['owner']);
export const eventStatus = pgEnum('event_status', [
  'draft',
  'active',
  'live',
  'completed',
  'cancelled',
  'archived',
]);
export const eventCategory = pgEnum('event_category', ['private', 'business']);
export const eventType = pgEnum('event_type', [
  'wedding',
  'malka',
  'engagement',
  'graduation',
  'birthday',
  'private_dinner',
  'conference',
  'corporate',
  'product_launch',
  'opening',
  'ceremony',
  'exhibition',
  'other',
]);
export const eventRole = pgEnum('event_role', ['owner', 'staff']);
export const membershipStatus = pgEnum('membership_status', ['invited', 'active', 'removed']);
export const actorType = pgEnum('actor_type', [
  'guest',
  'member',
  'user',
  'system',
  'provider',
  'admin',
]);
export const guestStatus = pgEnum('guest_status', ['active', 'cancelled']);
/** `walk_in` (phase 4) and `api` are reserved; phase 2 creates `manual` and `excel_import`. */
export const guestSource = pgEnum('guest_source', ['manual', 'excel_import', 'walk_in', 'api']);
export const importStatus = pgEnum('import_status', [
  'uploaded',
  'parsed',
  'committing',
  'committed',
  'failed',
  'discarded',
]);
export const importRowState = pgEnum('import_row_state', ['ready', 'needs_review', 'invalid']);
export const importDecision = pgEnum('import_decision', ['import', 'skip', 'add_anyway']);
