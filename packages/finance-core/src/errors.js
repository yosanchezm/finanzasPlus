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
