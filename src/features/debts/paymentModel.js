import { ValidationError, isIsoDate, planCommit } from '@finance-core';

const OPEN_STATUSES = ['pastDue', 'partial', 'due'];
const PREVIEW_EVENT = 'preview';

const MESSAGES = {
  installment_too_low: 'Con ese abono la cuota no alcanza a cubrir los intereses del saldo. Prueba con otro monto o con otra opción.',
  manual_plan_below_interest: 'Una cuota del plan manual queda por debajo de los intereses del periodo. Ajusta el monto o el plan.',
  invalid_amount: 'Escribe un monto en pesos mayor a 0.',
};
const FALLBACK = 'No se pudo calcular con esos datos. Revisa el monto y la fecha.';

/** Friendly Spanish for a core `ValidationError` code (the core's own messages are for developers). */
export const describeCoreError = (error) => MESSAGES[error?.code] ?? FALLBACK;

/** What the borrower owes right now: every overdue or partly paid installment plus the next one. */
export const dueNow = (projection) => projection.plan
  .filter((row) => OPEN_STATUSES.includes(row.status))
  .reduce((sum, row) => sum + row.outstandingMinor, 0);

/**
 * Pure preview of a payment form. Nothing is written: the split comes from `planCommit` (the same
 * plan the save will run), so what the dialog shows is what gets stored.
 * An amount above `dueMinor` on a debt with a plan is an extra payment and needs a strategy;
 * on a card (`projection.card`) any amount is a plain payment: `dueMinor` is the minimum and the rest pays down the balance.
 * @param {{ debt: object, events: object[], projection: object, actorId: string, today: string,
 *   amount: string, effectiveOn: string, strategy: (string | null) }} input
 * @returns {{ dueMinor: number, requiresStrategy: boolean, issue: (string | null), draft: (object | null),
 *   plan: (object | null), preview: (object | null) }}
 */
export function previewPayment({ debt, events, projection, actorId, today, amount, effectiveOn, strategy }) {
  const dueMinor = dueNow(projection);
  const amountMinor = Number(amount);
  const none = { dueMinor, requiresStrategy: false, issue: null, draft: null, plan: null, preview: null };
  if (String(amount).trim() === '') return none;
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return { ...none, issue: MESSAGES.invalid_amount };
  if (!isIsoDate(effectiveOn)) return { ...none, issue: 'Elige una fecha válida.' };

  const requiresStrategy = !projection.card && projection.plan.length > 0 && amountMinor > dueMinor;
  if (requiresStrategy && !strategy) return { ...none, requiresStrategy, issue: 'Elige cómo aplicar el abono extra.' };
  const draft = requiresStrategy
    ? { kind: 'extra_payment', effectiveOn, amountMinor, strategy }
    : { kind: 'payment', effectiveOn, amountMinor };
  try {
    const plan = planCommit(debt, events, draft, { eventId: PREVIEW_EVENT, dedupeKey: PREVIEW_EVENT, actorId, source: 'web', asOf: today });
    const { allocation, costMinor } = plan;
    return {
      ...none,
      requiresStrategy,
      draft,
      plan,
      preview: {
        amountMinor,
        principalMinor: allocation.principal, // for an extra payment it already includes what goes beyond the installment
        interestMinor: allocation.interest,
        feesMinor: allocation.charges + allocation.taxes + allocation.lateInterest,
        costMinor,
        surplusMinor: allocation.surplus,
        balanceAfterMinor: plan.projection.balanceMinor,
      },
    };
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return { ...none, requiresStrategy, issue: describeCoreError(error) };
  }
}
