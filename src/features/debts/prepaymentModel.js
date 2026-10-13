import { ValidationError, advise, compareStrategies } from '@finance-core';
import { formatMoney, formatPercent } from '../../shared/lib/format';
import { formatEa } from './debtLabels';
import { describeCoreError } from './paymentModel';

export const VERDICT_LABELS = {
  reduce_term: 'Reducir el plazo',
  reduce_installment: 'Reducir la cuota',
  avalanche: 'Pagar primero la deuda más cara',
  liquidity_only: 'Conservar liquidez',
};

const STRATEGY_TITLES = { reduce_term: 'Reducir plazo', reduce_installment: 'Reducir cuota', advance_installments: 'Adelantar cuotas' };

const REASONS = {
  default: () => 'No hay señales de aprieto ni deudas más caras: reducir el plazo es lo que más intereses ahorra.',
  zero_rate: () => 'Esta deuda no cobra intereses, así que abonar más no te ahorra dinero.',
  tight_margin: (reason) => `Tu margen mensual promedio es ${formatMoney(reason.marginMinor)} (${formatPercent(reason.marginRatio * 100)} de tus ingresos): conviene bajar la cuota para no quedarte corto.`,
  installment_ratio: (reason) => `La cuota ya pesa ${formatPercent(reason.installmentToIncome * 100)} de tus ingresos.`,
  higher_rate_debt: (reason) => `Tienes deudas con una tasa más alta: ${reason.debts.map((debt) => `${debt.name} (${formatEa(debt.eaPercent)})`).join(', ')}.`,
  cashflow_unknown: () => 'No hay suficientes movimientos de los últimos 3 meses para medir tu margen.',
};

/** Spanish sentences for the advice reasons (the core only returns codes and numbers). */
export const reasonTexts = (advice) => advice.reasons.filter((reason) => REASONS[reason.code]).map((reason) => REASONS[reason.code](reason));

/**
 * Pure simulation of an extra payment: the three strategies plus the deterministic advice. Nothing is written.
 * `cashflow` is `{ avgIncomeMinor, avgExpenseMinor }` or null (unknown); `otherDebts` is `[{ id, name, eaPercent }]`.
 * @returns {{ issue: (string | null), cards: object[], advice: (object | null) }} `cards`: `{ key, title, data, recommended }`
 */
export function runSimulation({ debt, events, amount, on, otherDebts, cashflow }) {
  const none = { issue: null, cards: [], advice: null };
  if (String(amount).trim() === '') return none;
  const amountMinor = Number(amount);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return { ...none, issue: 'Escribe un monto en pesos mayor a 0.' };
  try {
    const comparison = compareStrategies(debt, events, { amountMinor, on });
    const advice = advise(comparison, { ...(cashflow ?? {}), otherDebts });
    const recommended = comparison.identical && advice.verdict === 'reduce_installment' ? 'reduce_term' : advice.verdict;
    const entries = comparison.identical
      ? [['reduce_term', 'Reducir plazo o cuota', comparison.reduceTerm], ['advance_installments', STRATEGY_TITLES.advance_installments, comparison.advance]]
      : [['reduce_term', STRATEGY_TITLES.reduce_term, comparison.reduceTerm], ['reduce_installment', STRATEGY_TITLES.reduce_installment, comparison.reduceInstallment], ['advance_installments', STRATEGY_TITLES.advance_installments, comparison.advance]];
    return { ...none, advice, cards: entries.map(([key, title, data]) => ({ key, title, data, recommended: key === recommended })) };
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return { ...none, issue: describeCoreError(error) };
  }
}
