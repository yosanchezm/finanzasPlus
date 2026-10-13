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
