// Structured facts for an advice result (DPA-3). `numbers` holds every figure a
// reply may show as a raw value and `text` the same figure pre-formatted, so a
// paraphrase can be validated number by number. Money uses `.` for thousands.

const STRATEGIES = [
  ['reduceTerm', 'Reduce term'],
  ['reduceInstallment', 'Reduce installment'],
  ['advance', 'Advance installments'],
];

const money = (value) => `${value < 0 ? '-' : ''}${String(Math.abs(value)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
const percent = (value) => `${Number(value.toFixed(2))}%`;
const FORMAT = { money, count: String, percent, share: (value) => percent(value * 100) };

function figures(advice) {
  const { comparison, signals, thresholds } = advice;
  const { reduceTerm } = comparison;
  const list = [];
  const add = (key, value, kind) => {
    if (value !== null && value !== undefined) list.push([key, value, kind]);
  };
  add('amount', comparison.amountMinor, 'money');
  add('ea', comparison.eaPercent, 'percent');
  add('balance', reduceTerm.before.balanceMinor, 'money');
  add('periods', reduceTerm.before.remainingPeriods, 'count');
  add('installment', reduceTerm.before.installmentMinor, 'money');
  for (const [key] of STRATEGIES) {
    const { after, savings } = comparison[key];
    add(`${key}.periods`, after.remainingPeriods, 'count');
    add(`${key}.installment`, after.installmentMinor, 'money');
    add(`${key}.interestSaved`, savings.interestMinor, 'money');
    add(`${key}.chargesSaved`, savings.chargesMinor, 'money');
  }
  add('applied', reduceTerm.appliedMinor, 'money');
  add('surplus', reduceTerm.surplusMinor, 'money');
  add('penaltyPct', reduceTerm.penaltyPct, 'percent');
  add('penalty', reduceTerm.penaltyMinor, 'money');
  add('income', signals.avgIncomeMinor, 'money');
  add('expense', signals.avgExpenseMinor, 'money');
  add('margin', signals.marginMinor, 'money');
  add('marginShare', signals.marginRatio, 'share');
  add('installmentShare', signals.installmentToIncome, 'share');
  add('marginThreshold', thresholds.tightMarginRatio, 'share');
  add('installmentThreshold', thresholds.maxInstallmentToIncome, 'share');
  add('gap', thresholds.higherRateGapPct, 'percent');
  add('higherRate.ea', signals.higherRateDebts[0]?.eaPercent, 'percent');
  return list;
}

/**
 * Builds the facts of an advice result.
 * @param {object} advice The result of `advise` (the `facts` field itself is not needed).
 * @returns {object} `{ asOf, verdict, claimsSavings, identical, paidOff, reasonCodes, targetDebt, higherRateDebt,
 *   numbers, text, notices }`
 */
export function buildFacts(advice) {
  const { comparison, signals } = advice;
  const numbers = {};
  const text = {};
  for (const [key, value, kind] of figures(advice)) {
    numbers[key] = value;
    text[key] = FORMAT[kind](value);
  }
  for (const [key] of STRATEGIES) text[`${key}.lastDueOn`] = comparison[key].after.lastDueOn;
  const named = (debt) => (debt ? { id: debt.id, name: debt.name } : null);
  return {
    asOf: comparison.on,
    verdict: advice.verdict,
    claimsSavings: advice.claimsSavings,
    identical: comparison.identical,
    paidOff: comparison.reduceTerm.paidOff,
    reasonCodes: advice.reasons.map((reason) => reason.code),
    targetDebt: named(advice.targetDebt),
    higherRateDebt: named(signals.higherRateDebts[0]),
    numbers,
    text,
    notices: advice.notices.map(({ code, asOf, message }) => ({ code, asOf, message })),
  };
}

const VERDICTS = {
  reduce_term: 'Recommended: reduce the term.',
  reduce_installment: 'Recommended: reduce the installment.',
  liquidity_only: 'This debt has a 0% rate, so prepaying does not lower its cost: the choice is about liquidity only.',
};

function reasonLine(code, facts) {
  const { text } = facts;
  switch (code) {
    case 'tight_margin':
      return `Cash margin ${text.margin} (${text.marginShare} of income, minimum ${text.marginThreshold}).`;
    case 'installment_ratio':
      return `The installment is ${text.installmentShare} of income (maximum ${text.installmentThreshold}).`;
    case 'higher_rate_debt':
      return facts.verdict === 'avalanche' ? null : `${facts.higherRateDebt.name} costs ${text['higherRate.ea']} EA, above ${text.ea} EA here.`;
    case 'cashflow_unknown':
      return 'Cash flow is unknown, so the margin was not checked.';
    default:
      return null;
  }
}

function strategyLines(facts) {
  const { text } = facts;
  if (facts.paidOff) return [`The debt would be paid off in full: applied ${text.applied}, left over ${text.surplus}.`];
  const keys = facts.identical ? ['reduceTerm', 'advance'] : STRATEGIES.map(([key]) => key);
  return keys.map((key) => {
    const label = facts.identical && key === 'reduceTerm' ? 'Reduce term or installment (same result)' : STRATEGIES.find(([name]) => name === key)[1];
    const saved = facts.claimsSavings ? `, interest saved ${text[`${key}.interestSaved`]}` : '';
    return `${label}: ${text[`${key}.periods`]} installments left of ${text[`${key}.installment`]}${saved}.`;
  });
}

/**
 * Deterministic English summary built only from `facts` values, so every number
 * it shows is in `facts`. UIs may localise it with the same values.
 * @param {object} facts The result of `buildFacts`.
 * @returns {string}
 */
export function renderSummary(facts) {
  const { text } = facts;
  const verdict = facts.verdict === 'avalanche' ? `Recommended: pay ${facts.targetDebt.name} first (${text['higherRate.ea']} EA against ${text.ea} EA here).` : VERDICTS[facts.verdict];
  const lines = [`Extra payment of ${text.amount} on ${facts.asOf}.`, verdict, ...strategyLines(facts)];
  for (const code of facts.reasonCodes) lines.push(reasonLine(code, facts));
  if (facts.numbers.penaltyPct > 0) lines.push(`Prepayment penalty ${text.penaltyPct} (${text.penalty}), informational only.`);
  return lines.filter(Boolean).join(' ');
}
