import { isoDateIn } from './format.js';

// Cash-flow figures for the advice (NDA-5, DPA-2): the same rule as the web (`averageCashflow`),
// the average income and expense of the last 3 FULL months, the current month excluded. The core
// turns these raw figures into margin, ratios and signals; nothing is decided here.
// Pure and Node 16 safe.

const MONTHS = 3;
const DAY_MS = 86400000;
const THRESHOLD_KEYS = ['tightMarginRatio', 'maxInstallmentToIncome', 'higherRateGapPct'];

function addMonths(key, amount) {
  const index = Number(key.slice(0, 4)) * 12 + (Number(key.slice(5, 7)) - 1) + amount;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

const monthsBefore = (today) => Array.from({ length: MONTHS }, (_, step) => addMonths(today.slice(0, 7), step - MONTHS));

/**
 * The query range for the transactions of the last 3 full months, widened by one day on each side
 * so every time zone offset is covered; `averageCashflow` then keeps only the exact months.
 * @param {string} today `YYYY-MM-DD` in the household time zone.
 * @returns {{ from: string, to: string }} ISO timestamps, `to` exclusive.
 */
export function cashflowWindow(today) {
  const first = (key) => Date.parse(`${key}-01T00:00:00.000Z`);
  return {
    from: new Date(first(addMonths(today.slice(0, 7), -MONTHS)) - DAY_MS).toISOString(),
    to: new Date(first(today.slice(0, 7)) + DAY_MS).toISOString(),
  };
}

/** Rows seen by a debt: a shared debt sees every row, a personal one its owner's and the shared rows. */
export const inScopeFor = (ownerScope) => (item) => ownerScope === 'shared' || item.ownerScope === ownerScope || item.ownerScope === 'shared';

/**
 * Average monthly income and expense over the last 3 full months, in the household time zone.
 * Unknown (`null`) when no income was recorded, so the advice says so instead of guessing.
 * @param {{ type: string, amountMinor: number, occurredAt: string, ownerScope?: string }[]} rows
 * @param {string} today `YYYY-MM-DD`.
 * @param {{ timezone: string, inScope?: (row: object) => boolean }} options
 * @returns {({ avgIncomeMinor: number, avgExpenseMinor: number } | null)}
 */
export function averageCashflow(rows, today, { timezone, inScope = () => true }) {
  const months = monthsBefore(today);
  const counted = rows.filter((row) => {
    const at = new Date(row.occurredAt);
    return !Number.isNaN(at.getTime()) && months.includes(isoDateIn(at, timezone).slice(0, 7)) && inScope(row);
  });
  const total = (type) => counted.filter((row) => row.type === type).reduce((sum, row) => sum + Number(row.amountMinor || 0), 0);
  const income = total('income');
  if (income === 0) return null;
  return { avgIncomeMinor: Math.round(income / MONTHS), avgExpenseMinor: Math.round(total('expense') / MONTHS) };
}

/**
 * The raw `signals` argument of the core's `advise`.
 * @param {{ rows: object[], today: string, timezone: string, inScope?: Function, installmentMinor?: number,
 *   otherDebts?: { id: string, name: string, eaPercent: number }[] }} input
 */
export function cashflowSignals({ rows, today, timezone, inScope, installmentMinor, otherDebts = [] }) {
  return {
    ...(averageCashflow(rows, today, { timezone, inScope }) || {}),
    ...(Number.isFinite(installmentMinor) ? { installmentMinor } : {}),
    otherDebts,
  };
}

/**
 * Threshold overrides from the `DEBT_ADVICE_THRESHOLDS` env JSON. Anything that is not a known,
 * finite number >= 0 is dropped, so a bad value falls back to the core default instead of failing.
 * @param {(string | undefined)} json
 * @returns {Partial<Record<'tightMarginRatio' | 'maxInstallmentToIncome' | 'higherRateGapPct', number>>}
 */
export function parseThresholds(json) {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return Object.fromEntries(THRESHOLD_KEYS.filter((key) => typeof parsed[key] === 'number' && Number.isFinite(parsed[key]) && parsed[key] >= 0).map((key) => [key, parsed[key]]));
}
