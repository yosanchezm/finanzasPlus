import { isIsoDate } from './calendar.js';
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
    // Usury = 1.5 x the certified bancario corriente rate (IBC 19.06% EA, Superfinanciera Resolución 1472 de 2026).
    source: 'Superfinanciera Resolución 1472 de 2026: IBC consumo y ordinario 19.06% EA x 1.5',
    verified: true,
  }),
]);

/**
 * Monthly minimum wage (SMMLV) by year, maintained by hand.
 * Entry shape: { year, valueMinor, source, verified }.
 *
 * Read through `smmlvFor` (Ley 1555 scope checks use it for the 880 SMMLV threshold).
 */
export const SMMLV_TABLE = Object.freeze([
  Object.freeze({
    year: 2026,
    valueMinor: 1750905,
    source: 'Decreto 1469 de 2025 (value kept by Decreto 0159 de 2026)',
    verified: true,
  }),
]);

/** Known legal modalities. `mortgage` is manual: its usury cap is never derived from an IBC row. */
export const LEGAL_MODALITIES = Object.freeze([
  'consumer',
  'low_amount',
  'productive',
  'productive_rural',
  'productive_urban',
  'popular_rural',
  'popular_urban',
  'mortgage',
]);

// Accepted values of a stored row: basis points for `ibc`/`usury`, whole pesos for `smmlv` (AD3).
const BASIS_POINTS_RANGE = Object.freeze({ min: 500, max: 10000 });
const SMMLV_RANGE = Object.freeze({ min: 100000, max: 100000000 });
// Ley 1555 scope threshold assumed by the notice, in monthly minimum wages (owner Q1: still unverified).
const LEY1555_SMMLV_THRESHOLD = 880;

// ISO dates sort as plain strings, and this keeps every lookup below from throwing on a bad table entry.
const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const inRange = (value, { min, max }) => Number.isSafeInteger(value) && value >= min && value <= max;
const isObject = (value) => value !== null && typeof value === 'object';

/**
 * Usury cap in basis points from an IBC in basis points: 1.5 x IBC, rounded half up.
 * @param {number} ibcBp For example 1949 (19.49% EA).
 * @returns {number} For example 2924 (29.24% EA).
 */
export function usuryFromIbcBp(ibcBp) {
  return Math.floor((ibcBp * 3 + 1) / 2);
}

const rowKey = (modality, validFrom) => `${modality}|${validFrom}`;
const sourceOf = (row) => (typeof row.source === 'string' ? row.source : '');

// Returns the row when it is a recognised, in-range household row; otherwise null (rows are never trusted).
function recognised(row) {
  if (!isObject(row) || !isIsoDate(row.validFrom) || !isIsoDate(row.validTo) || row.validFrom > row.validTo) return null;
  if (row.kind === 'smmlv') return inRange(row.value, SMMLV_RANGE) ? row : null;
  if (row.kind !== 'ibc' && row.kind !== 'usury') return null;
  return LEGAL_MODALITIES.includes(row.modality) && inRange(row.value, BASIS_POINTS_RANGE) ? row : null;
}

function usuryEntries(rows, defaults) {
  const explicit = new Map();
  const indexed = new Map();
  for (const row of rows) {
    if (row.kind === 'usury') explicit.set(rowKey(row.modality, row.validFrom), row);
    // A mortgage IBC row is stored and listed, but never derives a cap (AD4).
    else if (row.kind === 'ibc' && row.modality !== 'mortgage') indexed.set(rowKey(row.modality, row.validFrom), row);
  }
  const entries = new Map();
  for (const entry of defaults) entries.set(rowKey(entry.modality, entry.validFrom), { ...entry, origin: 'default' });
  const entryOf = (row, usuryBp, origin, ibcRow) => {
    const entry = { modality: row.modality, validFrom: row.validFrom, validTo: row.validTo, capEA: usuryBp / 100, source: sourceOf(row), verified: row.verified === true, origin };
    if (ibcRow) entry.ibcEA = ibcRow.value / 100;
    return entry;
  };
  for (const [key, row] of indexed) entries.set(key, entryOf(row, usuryFromIbcBp(row.value), 'ibc', row));
  for (const [key, row] of explicit) entries.set(key, entryOf(row, row.value, 'override', indexed.get(key)));
  const order = (modality) => {
    const index = LEGAL_MODALITIES.indexOf(modality);
    return index < 0 ? LEGAL_MODALITIES.length : index;
  };
  return [...entries.values()].sort((a, b) => order(a.modality) - order(b.modality) || compareText(a.modality, b.modality) || compareText(a.validFrom, b.validFrom));
}

function smmlvEntries(rows, defaults) {
  const entries = new Map();
  for (const entry of defaults) entries.set(entry.year, { ...entry, origin: 'default' });
  for (const row of rows) {
    if (row.kind !== 'smmlv') continue;
    const year = Number(row.validFrom.slice(0, 4));
    entries.set(year, { year, valueMinor: row.value, source: sourceOf(row), verified: row.verified === true, origin: 'override' });
  }
  return [...entries.values()].sort((a, b) => a.year - b.year);
}

const freezeTables = (resolved) => {
  for (const entry of resolved.usuryTable) Object.freeze(entry);
  for (const entry of resolved.smmlvTable) Object.freeze(entry);
  Object.freeze(resolved.usuryTable);
  Object.freeze(resolved.smmlvTable);
  return Object.freeze(resolved);
};

/**
 * Merges household `legal_rates` rows over the code tables (LR2 to LR4).
 * Per modality and month, the order is: explicit `usury` row, then `ibc` x 1.5, then the code default.
 * `mortgage` is manual: an `ibc` row for it never derives a cap. SMMLV rows win per year.
 * Rows of an unknown kind or modality, with bad dates, or out of range are ignored, never thrown on.
 * @param {object[]} [rows] `legal_rates` rows: `{ kind, modality, validFrom, validTo, value, source?, verified? }`
 *   (basis points for `ibc`/`usury`, pesos for `smmlv`).
 * @param {{ usuryTable?: readonly object[], smmlvTable?: readonly object[] }} [defaults] The fallback tables.
 * @returns {{ usuryTable: object[], smmlvTable: object[], status: 'table' | 'defaults' }} Entries carry `origin`
 *   (`override`, `ibc` or `default`); derived ones add `ibcEA`.
 */
export function resolveLegal(rows, defaults = {}) {
  const { usuryTable = USURY_TABLE, smmlvTable = SMMLV_TABLE } = defaults;
  const valid = (Array.isArray(rows) ? rows : []).map(recognised).filter(Boolean);
  return freezeTables({
    usuryTable: usuryEntries(valid, usuryTable),
    smmlvTable: smmlvEntries(valid, smmlvTable),
    status: valid.length > 0 ? 'table' : 'defaults',
  });
}

/**
 * The fallback loaders use when `legal_rates` cannot be read: the defaults with status `unavailable`.
 * @param {{ usuryTable?: readonly object[], smmlvTable?: readonly object[] }} [defaults]
 * @returns {{ usuryTable: object[], smmlvTable: object[], status: 'unavailable' }}
 */
resolveLegal.unavailable = (defaults) => freezeTables({ ...resolveLegal([], defaults), status: 'unavailable' });

/** The code tables, resolved with no household rows. */
export const DEFAULT_LEGAL = resolveLegal([]);

/**
 * The legal tables to use: `opts.legal`, then `debt.legal`, then the code tables (AD6).
 * @param {{ legal?: object } | undefined} debt
 * @param {{ legal?: object } | undefined} [opts]
 * @returns {{ usuryTable: object[], smmlvTable: object[], status: string }}
 */
export function legalOf(debt, opts) {
  return opts?.legal ?? debt?.legal ?? DEFAULT_LEGAL;
}

/**
 * The usury cap covering `date`. With no covering entry, the latest cap that starts on or before the date
 * is carried forward with `stale: true`. With none at all, or on bad input, returns `null`. Never throws.
 * @param {readonly object[]} usuryTable
 * @param {string} modality
 * @param {string} date ISO date.
 * @returns {{ capEA: number, stale: false, entry: object } | { capEA: number, stale: true, lastValidTo: string, entry: object } | null}
 */
export function capOn(usuryTable, modality, date) {
  if (!Array.isArray(usuryTable) || !isIsoDate(date)) return null;
  let covering = null;
  let carried = null;
  for (const entry of usuryTable) {
    if (!isObject(entry) || entry.modality !== modality || compareText(entry.validFrom, date) > 0) continue;
    const covers = compareText(date, entry.validTo) <= 0;
    const slot = covers ? covering : carried;
    if (slot !== null && compareText(entry.validFrom, slot.validFrom) <= 0) continue; // keep the latest start
    if (covers) covering = entry;
    else carried = entry;
  }
  if (covering) return { capEA: covering.capEA, stale: false, entry: covering };
  if (carried) return { capEA: carried.capEA, stale: true, lastValidTo: carried.validTo, entry: carried };
  return null;
}

/**
 * The monthly minimum wage for a year, carrying the latest earlier year forward with `stale: true`.
 * @param {readonly object[]} smmlvTable
 * @param {number} year
 * @returns {{ valueMinor: number, stale: boolean } | null} `null` before the first known year or on bad input.
 */
export function smmlvFor(smmlvTable, year) {
  if (!Array.isArray(smmlvTable) || !Number.isInteger(year)) return null;
  let found = null;
  for (const entry of smmlvTable) {
    if (isObject(entry) && Number.isInteger(entry.year) && entry.year <= year && (found === null || entry.year > found.year)) found = entry;
  }
  return found === null ? null : { valueMinor: found.valueMinor, stale: found.year !== year };
}

/**
 * Warns when a rate's EA exceeds the usury cap in force on `asOf`. The cap comes from `capOn`, so a cap
 * carried forward still warns, with `stale: true` and `lastValidTo`.
 * Returns `null` (never throws) when there is no applicable cap, the rate is
 * not above it, or the input is invalid.
 * @param {object} rate A rate accepted by `normalizeRate`.
 * @param {string} modality For example `consumer`.
 * @param {string} asOf ISO date the cap is evaluated for.
 * @param {{ usuryTable?: readonly object[] }} [options] Inject a resolved table (default: the code table).
 * @returns {object | null}
 */
export function usuryNotice(rate, modality, asOf, options = {}) {
  if (!isIsoDate(asOf)) return null;
  const table = options.usuryTable === undefined ? USURY_TABLE : options.usuryTable;
  const cap = capOn(table, modality, asOf);
  if (!cap) return null;
  const { entry } = cap;
  let eaPercent;
  try {
    eaPercent = toEffectiveAnnual(rate);
  } catch {
    return null; // an invalid rate is reported by validation, not by this notice
  }
  if (!(eaPercent > entry.capEA)) return null;
  const notice = {
    code: 'usury_above_cap',
    severity: 'warning',
    blocking: false,
    modality,
    eaPercent,
    capEA: entry.capEA,
    asOf,
    validFrom: entry.validFrom,
    validTo: entry.validTo,
    stale: cap.stale,
    source: entry.source,
    verified: entry.verified === true,
  };
  if (cap.stale) notice.lastValidTo = cap.lastValidTo;
  const carried = cap.stale ? `, the latest known cap (valid until ${cap.lastValidTo})` : '';
  notice.message =
    `The rate is ${eaPercent.toFixed(2)}% EA, above the ${entry.capEA}% EA usury cap for ${modality} credit ` +
    `as of ${asOf}${carried}${entry.verified === true ? '' : ' (cap not officially verified)'}. This is informational only.`;
  return notice;
}

/**
 * Ley 1555 notice (free prepayment, choice of strategy). Raised for mortgages;
 * whether the law applies to the specific debt is not verified here. When an SMMLV is known for the `asOf`
 * year it also states the assumed scope threshold (880 SMMLV) and whether `principalMinor` is within it.
 * @param {{ kind?: string, principalMinor?: number } | undefined} debt
 * @param {string} asOf ISO date the notice is computed for.
 * @param {{ smmlvTable?: readonly object[] }} [options] Inject a resolved table (default: the code table).
 * @returns {object | null}
 */
export function ley1555Notice(debt, asOf, options = {}) {
  if (!isIsoDate(asOf) || !debt || debt.kind !== 'mortgage') return null;
  const smmlv = smmlvFor(options.smmlvTable === undefined ? SMMLV_TABLE : options.smmlvTable, Number(asOf.slice(0, 4)));
  const thresholdMinor = smmlv === null ? null : LEY1555_SMMLV_THRESHOLD * smmlv.valueMinor;
  const aboveThreshold = thresholdMinor === null || !Number.isSafeInteger(debt.principalMinor) ? null : debt.principalMinor > thresholdMinor;
  const scope =
    thresholdMinor === null
      ? ''
      : ` The assumed scope threshold is ${LEY1555_SMMLV_THRESHOLD} SMMLV = ${thresholdMinor} COP${smmlv.stale ? ' (latest SMMLV known)' : ''}` +
        `${aboveThreshold === null ? '.' : aboveThreshold ? '; the principal exceeds it, so the scope may not apply.' : '; the principal is within it.'}`;
  return {
    code: 'ley1555_scope_unverified',
    severity: 'info',
    blocking: false,
    scopeVerified: false,
    asOf,
    smmlvMinor: smmlv === null ? null : smmlv.valueMinor,
    smmlvStale: smmlv === null ? null : smmlv.stale,
    thresholdMinor,
    aboveThreshold,
    message:
      `As of ${asOf}: Ley 1555 may let you prepay a mortgage without penalty and choose how the extra ` +
      `payment is applied. Its scope for this debt is unverified; check your contract.${scope} This does not change the simulation.`,
  };
}
