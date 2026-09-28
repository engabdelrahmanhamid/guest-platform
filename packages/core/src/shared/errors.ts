/**
 * Every rule violation surfaces as a DomainError with a stable machine code. The web layer
 * maps codes to Arabic/English messages; nothing else relies on the English `message`.
 */
export type DomainErrorCode =
  | 'validation_failed'
  | 'not_found'
  | 'forbidden'
  | 'unauthenticated'
  | 'mfa_required'
  | 'rate_limited'
  | 'email_taken'
  | 'invalid_credentials'
  | 'user_disabled'
  | 'invalid_token'
  | 'invalid_totp_code'
  | 'email_not_verified'
  | 'event_disabled'
  | 'event_not_editable'
  | 'invalid_transition'
  | 'stale_status'
  | 'reopen_window_passed'
  | 'cannot_remove_owner'
  | 'membership_not_staff'
  | 'membership_removed'
  | 'cannot_disable_self'
  | 'unknown_setting'
  | 'group_name_taken'
  | 'too_many_groups'
  | 'guest_delete_not_allowed'
  | 'too_many_selected'
  | 'file_too_large'
  | 'file_empty'
  | 'file_unsupported'
  | 'file_macro'
  | 'file_legacy_xls'
  | 'file_unreadable'
  | 'missing_headers'
  | 'too_many_rows'
  | 'import_not_ready'
  | 'import_decisions_missing'
  | 'import_changed'
  | 'invalid_decision'
  | 'event_not_published'
  | 'rsvp_closed'
  | 'guest_not_active'
  | 'companions_over_allowance'
  | 'allowance_below_response'
  | 'no_active_pass'
  | 'image_unsupported'
  | 'image_too_large'
  | 'image_too_small';

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: DomainErrorCode, message?: string, details: Record<string, unknown> = {}) {
    super(message ?? code);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}

export function isDomainError(err: unknown, code?: DomainErrorCode): err is DomainError {
  return err instanceof DomainError && (code === undefined || err.code === code);
}
