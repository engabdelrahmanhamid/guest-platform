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
/** Only `not_sent` and `shared` occur in the pilot; the rest belong to a future automated channel. */
export const invitationDelivery = pgEnum('invitation_delivery', [
  'not_sent',
  'queued',
  'shared',
  'sent',
  'delivered',
  'failed',
]);
export const rsvpStatus = pgEnum('rsvp_status', ['pending', 'confirmed', 'declined']);
/** Stored pass states. Expiry is derived from the event, never stored. */
export const passStatus = pgEnum('pass_status', ['active', 'revoked']);
export const passRevokeReason = pgEnum('pass_revoke_reason', [
  'declined',
  'guest_cancelled',
  'replaced',
]);
export const invitationTemplate = pgEnum('invitation_template', [
  'elegant',
  'minimal',
  'formal',
  'celebration',
]);
export const messageType = pgEnum('message_type', ['invitation', 'reminder']);
export const checkInAction = pgEnum('check_in_action', ['check_in', 'correction', 'walk_in']);
export const checkInMethod = pgEnum('check_in_method', ['qr', 'search', 'walk_in', 'dashboard']);
export const staffSessionEndReason = pgEnum('staff_session_end_reason', [
  'revoked',
  'resent',
  'member_removed',
  'signed_out',
]);
