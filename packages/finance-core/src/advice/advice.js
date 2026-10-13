import { ValidationError } from '../errors.js';
import { ley1555Notice } from '../legal.js';

// Deterministic prepayment verdict (DPA-2). No model is involved: the same
// comparison, cash-flow figures and thresholds always give the same answer.

/** Default thresholds; every one can be overridden per call. */
export const ADVICE_DEFAULTS = Object.freeze({
  tightMarginRatio: 0.1, // margin below this share of the average income is tight
  maxInstallmentToIncome: 0.3, // an installment above this share of the average income is tight
  higherRateGapPct: 0, // another debt counts when its EA exceeds this one's by MORE than the gap (0 = strictly higher)
});

function resolveThresholds(overrides) {
  const thresholds = { ...ADVICE_DEFAULTS, ...overrides };
  for (const key of Object.keys(ADVICE_DEFAULTS)) {
    if (!Number.isFinite(thresholds[key]) || thresholds[key] < 0) {
      throw new ValidationError('invalid_thresholds', `${key} must be a number >= 0, got ${String(thresholds[key])}`);
    }
  }
  return thresholds;
}

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * Turns raw cash-flow figures and the other debts into the two boolean signals.
 * `tightMargin` is `null` when the averages are unknown.
 * @param {{ eaPercent: number, reduceTerm: { before: { installmentMinor: number } } }} comparison
 * @param {{ avgIncomeMinor?: number, avgExpenseMinor?: number, installmentMinor?: number, otherDebts?: { id: string, name: string, eaPercent: number }[] }} signals
 * @param {object} thresholds Already resolved thresholds.
 */
function evaluateSignals(comparison, signals, thresholds) {
  const { avgIncomeMinor, avgExpenseMinor } = signals;
  const installmentMinor = isNumber(signals.installmentMinor) ? signals.installmentMinor : comparison.reduceTerm.before.installmentMinor;
  const known = isNumber(avgIncomeMinor) && isNumber(avgExpenseMinor);
  const marginMinor = known ? avgIncomeMinor - avgExpenseMinor : null;
  const marginRatio = known && avgIncomeMinor > 0 ? marginMinor / avgIncomeMinor : null;
  const installmentToIncome = known && avgIncomeMinor > 0 ? installmentMinor / avgIncomeMinor : null;
  const marginBelow = known && marginMinor < thresholds.tightMarginRatio * avgIncomeMinor;
  const installmentAbove = known && (avgIncomeMinor > 0 ? installmentToIncome > thresholds.maxInstallmentToIncome : installmentMinor > 0);
  const higherRateDebts = (signals.otherDebts ?? [])
    .filter((other) => other.eaPercent > comparison.eaPercent + thresholds.higherRateGapPct)
    .sort((a, b) => b.eaPercent - a.eaPercent);
  return {
    avgIncomeMinor: known ? avgIncomeMinor : null,
    avgExpenseMinor: known ? avgExpenseMinor : null,
    installmentMinor,
    marginMinor,
    marginRatio,
    installmentToIncome,
    marginBelow,
    installmentAbove,
    tightMargin: known ? marginBelow || installmentAbove : null,
    higherRateDebt: higherRateDebts.length > 0,
    higherRateDebts,
  };
}

// One reason per signal that holds, in a fixed order: margin, installment ratio, higher-rate debt.
function signalReasons(signals, thresholds) {
  const reasons = [];
  if (signals.marginBelow) {
    reasons.push({ code: 'tight_margin', marginMinor: signals.marginMinor, marginRatio: signals.marginRatio, thresholdRatio: thresholds.tightMarginRatio });
  }
  if (signals.installmentAbove) {
    reasons.push({ code: 'installment_ratio', installmentToIncome: signals.installmentToIncome, threshold: thresholds.maxInstallmentToIncome });
  }
  if (signals.higherRateDebt) reasons.push({ code: 'higher_rate_debt', debts: signals.higherRateDebts });
  return reasons;
}

function decide(zeroRate, signals, reasons) {
  if (zeroRate) return { verdict: 'liquidity_only', reasons: [{ code: 'zero_rate' }, ...reasons] };
  if (signals.tightMargin) return { verdict: 'reduce_installment', reasons };
  if (signals.higherRateDebt) return { verdict: 'avalanche', reasons };
  return { verdict: 'reduce_term', reasons: [{ code: 'default' }] };
}

/**
 * Decides how to apply an extra payment. Rules, first match wins:
 * 1. the debt is at 0% -> `liquidity_only` (no interest savings are claimed);
 * 2. tight margin (3-month margin or installment ratio) -> `reduce_installment`;
 * 3. another debt has a higher EA -> `avalanche` (names that debt);
 * 4. otherwise -> `reduce_term`.
 * Liquidity beats avalanche, but a higher-rate debt stays listed in `reasons`.
 * @param {object} comparison Result of `compareStrategies`.
 * @param {{ avgIncomeMinor?: number, avgExpenseMinor?: number, installmentMinor?: number,
 *   otherDebts?: { id: string, name: string, eaPercent: number }[] }} [signals] 3-month averages and the other active debts.
 * @param {Partial<typeof ADVICE_DEFAULTS>} [thresholdOverrides]
 * @returns {object} `{ verdict, claimsSavings, targetDebt, reasons, signals, thresholds, notices, comparison }`
 * @throws {ValidationError}
 */
export function advise(comparison, signals = {}, thresholdOverrides = {}) {
  const thresholds = resolveThresholds(thresholdOverrides);
  const evaluated = evaluateSignals(comparison, signals, thresholds);
  const zeroRate = comparison.eaPercent === 0;
  const decision = decide(zeroRate, evaluated, signalReasons(evaluated, thresholds));
  const reasons = [...decision.reasons];
  if (evaluated.tightMargin === null) reasons.push({ code: 'cashflow_unknown' });
  for (const note of comparison.notes) reasons.push({ code: note.code, system: note.system, paidOff: note.paidOff });
  const notice = ley1555Notice({ kind: comparison.kind }, comparison.on);
  return {
    verdict: decision.verdict,
    claimsSavings: !zeroRate,
    targetDebt: decision.verdict === 'avalanche' ? evaluated.higherRateDebts[0] : null,
    reasons,
    signals: evaluated,
    thresholds,
    notices: notice ? [notice] : [],
    comparison,
  };
}
