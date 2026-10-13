import { ValidationError, isIsoDate, planCommit, project } from '@finance-core';

// Pure previews of the two card forms. Like `previewPayment`, they run the same `planCommit` the save will run,
// so the figures shown ("Vista previa") are the ones that get stored.

const PREVIEW = 'preview';
const NONE = { draft: null, issue: null, preview: null };
const DEFAULT_LABELS = { revolving: 'Compra', deferred: 'Compra a cuotas', advance: 'Avance en efectivo' };

const blank = (text) => String(text).trim() === '';
const wholePesos = (text) => (Number.isSafeInteger(Number(text)) && !blank(text) ? Number(text) : null);

function withPlan(input, draft, preview) {
  const { debt, events, actorId, today } = input;
  try {
    const plan = planCommit(debt, events, draft, { eventId: PREVIEW, dedupeKey: PREVIEW, actorId, source: 'web', asOf: today });
    return { draft, issue: null, preview: preview(plan, project(debt, events, draft.effectiveOn).balanceMinor) };
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return { ...NONE, issue: 'No se pudo calcular con esos datos. Revisa los valores y la fecha.' };
  }
}

/**
 * Preview of a statement: the stated balance is written as an `adjustment` that reconciles the projection.
 * @param {{ debt: object, events: object[], actorId: string, today: string, effectiveOn: string, balance: string, minimum: string }} input
 * @returns {{ draft: (object | null), issue: (string | null), preview: ({ computedMinor: number, driftMinor: number, balanceAfterMinor: number } | null) }}
 */
export function previewStatement(input) {
  const { effectiveOn, balance, minimum } = input;
  if (blank(balance)) return NONE;
  const balanceMinor = wholePesos(balance);
  if (balanceMinor === null || balanceMinor < 0) return { ...NONE, issue: 'Escribe el saldo total del extracto en pesos, sin decimales.' };
  if (!isIsoDate(effectiveOn)) return { ...NONE, issue: 'Elige una fecha válida.' };
  const draft = { kind: 'adjustment', effectiveOn, balanceMinor, note: 'Extracto' };
  if (!blank(minimum)) {
    const minimumDueMinor = wholePesos(minimum);
    if (minimumDueMinor === null || minimumDueMinor < 0) return { ...NONE, issue: 'Escribe el pago mínimo en pesos, sin decimales.' };
    draft.minimumDueMinor = minimumDueMinor;
  }
  return withPlan(input, draft, (plan, before) => ({ computedMinor: before, driftMinor: plan.projection.balanceMinor - before, balanceAfterMinor: plan.projection.balanceMinor }));
}

/**
 * Preview of a card purchase: a purchase of the month (`revolving`), an installment purchase (`deferred`, 2+ installments,
 * its own rate; blank uses the card's) or a cash advance (`advance`).
 * @param {{ debt: object, events: object[], actorId: string, today: string, effectiveOn: string, type: string,
 *   label: string, amount: string, n: string, rate: string }} input
 * @returns {{ draft: (object | null), issue: (string | null), preview: ({ balanceAfterMinor: number } | null) }}
 */
export function previewCharge(input) {
  const { effectiveOn, type, label, amount, n, rate } = input;
  if (blank(amount)) return NONE;
  const amountMinor = wholePesos(amount);
  if (amountMinor === null || amountMinor <= 0) return { ...NONE, issue: 'Escribe el valor en pesos, mayor a 0.' };
  if (!isIsoDate(effectiveOn)) return { ...NONE, issue: 'Elige una fecha válida.' };
  const draft = { kind: 'charge', effectiveOn, amountMinor, trancheType: type, label: label.trim() || DEFAULT_LABELS[type] };
  if (type === 'deferred') {
    const count = Number(n);
    if (blank(n) || !Number.isInteger(count) || count < 2) return { ...NONE, issue: 'Una compra a cuotas necesita al menos 2 cuotas; si es una sola, regístrala como compra del mes.' };
    draft.n = count;
  }
  if (type !== 'revolving' && !blank(rate)) {
    const value = Number(rate);
    if (!Number.isFinite(value) || value < 0) return { ...NONE, issue: 'La tasa debe ser un número desde 0.' };
    draft.rate = { convention: 'EA', value };
  }
  return withPlan(input, draft, (plan) => ({ balanceAfterMinor: plan.projection.balanceMinor }));
}
