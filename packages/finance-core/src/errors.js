/**
 * Typed validation error shared by every finance-core module. Callers branch on
 * `code` (stable, machine-readable); `message` is for developers and logs.
 */
export class ValidationError extends Error {
  /**
   * @param {string} code Stable identifier such as `invalid_minor`.
   * @param {string} message Human-readable detail.
   */
  constructor(code, message) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
  }
}

/** Serialized terms would not fit the 8000-character `termsJson` column. */
export class TermsTooLarge extends ValidationError {
  /** @param {string} message Human-readable detail. */
  constructor(message) {
    super('terms_too_large', message);
    this.name = 'TermsTooLarge';
  }
}

/**
 * A multi-step write stopped half way (for example the event was saved but its
 * cost row was not). Treat it as a failed save: running the same plan again
 * completes the missing steps without duplicating the finished ones.
 */
export class CommitError extends Error {
  /**
   * @param {string} code Stable identifier such as `cost_row_failed`.
   * @param {string} message Human-readable detail.
   * @param {{ eventId?: string, cause?: unknown }} [details]
   */
  constructor(code, message, { eventId, cause } = {}) {
    super(message);
    this.name = 'CommitError';
    this.code = code;
    this.partial = true;
    this.eventId = eventId;
    this.cause = cause;
  }
}
