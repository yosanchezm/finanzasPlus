import { compareIso, isIsoDate } from './calendar.js';
import { toEffectiveAnnual } from './rates.js';

// Legal notices are informational only: they carry the date they were computed
// for (`asOf`), never block creating or simulating a debt, and never throw.
// Notices are structured (`code` plus fields); `message` is English text that
// UIs may replace with their own copy keyed by `code`.

/**
 * Usury caps (tasa de usura) in % EA, maintained by hand.
 * Entry: { modality, validFrom, validTo, capEA, source, verified }.
 * Modality `consumer` covers consumo y ordinario credit.
 *
 * OA-5 (owner action): the owner has not supplied the official Superfinanciera
 * certificate yet. The single entry below comes from a secondary source, so it
 * is marked `verified: false`. Replace it, and add the following months, with
 * the official values.
 */
export const USURY_TABLE = Object.freeze([
  Object.freeze({
    modality: 'consumer',
    validFrom: '2026-10-01',
    validTo: '2026-10-31',
    capEA: 28.59,
    source: 'Secondary source: news report citing Superfinanciera (not the official certificate)',
    verified: false,
  }),
]);

/**
 * Monthly minimum wage (SMMLV) by year, maintained by hand.
 * Entry shape: { year, valueMinor, source, verified }.
 *
 * PLACEHOLDER (OA-5): intentionally empty until the owner supplies official
 * values. Nothing reads it yet; it is exported so the table has one home when
 * Ley 1555 scope checks need it.
 */
export const SMMLV_TABLE = Object.freeze([]);

/**
 * Warns when a rate's EA exceeds the usury cap in force on `asOf`.
 * Returns `null` (never throws) when there is no applicable cap, the rate is
 * not above it, or the input is invalid.
 * @param {object} rate A rate accepted by `normalizeRate`.
 * @param {string} modality For example `consumer`.
 * @param {string} asOf ISO date the cap is evaluated for.
 * @param {{ usuryTable?: readonly object[] }} [options] Inject a table for tests.
 * @returns {object | null}
 */
export function usuryNotice(rate, modality, asOf, options = {}) {
  if (!isIsoDate(asOf)) return null;
  const table = options.usuryTable === undefined ? USURY_TABLE : options.usuryTable;
  const entry = table.find(
    (candidate) =>
      candidate.modality === modality &&
      compareIso(candidate.validFrom, asOf) <= 0 &&
      compareIso(asOf, candidate.validTo) <= 0,
  );
  if (!entry) return null;
  let eaPercent;
  try {
    eaPercent = toEffectiveAnnual(rate);
  } catch {
    return null; // an invalid rate is reported by validation, not by this notice
  }
  if (!(eaPercent > entry.capEA)) return null;
  return {
    code: 'usury_above_cap',
    severity: 'warning',
    blocking: false,
    modality,
    eaPercent,
    capEA: entry.capEA,
    asOf,
    validFrom: entry.validFrom,
    validTo: entry.validTo,
    source: entry.source,
    verified: entry.verified === true,
    message:
      `The rate is ${eaPercent.toFixed(2)}% EA, above the ${entry.capEA}% EA usury cap for ${modality} credit ` +
      `as of ${asOf}${entry.verified === true ? '' : ' (cap not officially verified)'}. This is informational only.`,
  };
}

/**
 * Ley 1555 notice (free prepayment, choice of strategy). Raised for mortgages;
 * whether the law applies to the specific debt is not verified here.
 * @param {{ kind?: string } | undefined} debt
 * @param {string} asOf ISO date the notice is computed for.
 * @returns {object | null}
 */
export function ley1555Notice(debt, asOf) {
  if (!isIsoDate(asOf) || !debt || debt.kind !== 'mortgage') return null;
  return {
    code: 'ley1555_scope_unverified',
    severity: 'info',
    blocking: false,
    scopeVerified: false,
    asOf,
    message:
      `As of ${asOf}: Ley 1555 may let you prepay a mortgage without penalty and choose how the extra ` +
      'payment is applied. Its scope for this debt is unverified; check your contract. This does not change the simulation.',
  };
}
