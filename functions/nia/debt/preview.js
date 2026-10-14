import {
  ValidationError,
  buildSchedule,
  defaultLateFor,
  ley1555Notice,
  normalizeRate,
  periodDates,
  planCommit,
  project,
  rateLabel,
  summarizeSchedule,
  usuryNotice,
  validateTerms,
} from '../../../packages/finance-core/index.js';
import { pesos } from './format.js';

// Previews (NDA-1, NDA-2): what a payment or a new debt would do, computed by the
// shared core and rendered as Spanish text. Nothing here writes. Pure and Node 16 safe.

const OPEN_STATUSES = ['pastDue', 'partial', 'due'];
const KIND_LABELS = { consumer: 'consumo', vehicle: 'vehículo', libranza: 'libranza', mortgage: 'hipoteca', leasing: 'leasing', family: 'familiar', informal: 'informal', other: 'otra' };
export const SYSTEM_LABELS = { french: 'cuota fija (francés)', german: 'abono fijo a capital (alemán)', bullet: 'pago único al final', interest_only: 'solo intereses', none: 'solo saldo' };
export const PERIOD_LABELS = { weekly: 'semanales', biweekly: 'quincenales', monthly: 'mensuales', bimonthly: 'bimestrales', quarterly: 'trimestrales', semiannual: 'semestrales', annual: 'anuales' };
const STRATEGY_LABELS = { reduce_term: 'reducir plazo', reduce_installment: 'reducir cuota', advance_installments: 'adelantar cuotas' };

const CORE_MESSAGES = {
  invalid_principal: 'El monto del préstamo debe ser mayor que cero.',
  invalid_rate: 'La tasa debe ser un número desde 0; si es anticipada, menor que 100 % por periodo.',
  invalid_date: 'Revisa las fechas: deben ser fechas reales.',
  invalid_amount: 'Escribe un monto en pesos mayor a 0.',
  installment_too_low: 'Con ese abono la cuota no alcanza a cubrir los intereses del saldo. Prueba con otro monto o con otra opción.',
  manual_plan_below_interest: 'Una cuota del plan manual queda por debajo de los intereses del periodo.',
  terms_too_large: 'El plan es demasiado largo para guardarlo. Reduce las cuotas.',
  invalid_terms_json: 'No pude leer los términos de esta deuda.',
  invalid_debt: 'No pude leer los términos de esta deuda.',
  unsupported_schema_version: 'No pude leer los términos de esta deuda.',
};
const FALLBACK_MESSAGE = 'No pude calcular con esos datos. Revisa los valores e inténtalo de nuevo.';

export const describeCoreError = (error) => CORE_MESSAGES[error && error.code] || FALLBACK_MESSAGE;

function guard(run) {
  try {
    return run();
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return { ok: false, issue: describeCoreError(error) };
  }
}

/** What the borrower owes right now: overdue or partly paid installments plus the next one. */
export const dueNow = (projection) => projection.plan
  .filter((row) => OPEN_STATUSES.includes(row.status))
  .reduce((sum, row) => sum + row.outstandingMinor, 0);

function payText(debt, plan, before, request, requiresStrategy) {
  const { allocation, costMinor, projection: after } = plan;
  const lines = ['💳 Abono a ' + debt.name, `Monto: ${pesos(request.amountMinor)} el ${request.paidOn}`];
  if (requiresStrategy) lines.push(`Estrategia: ${STRATEGY_LABELS[request.strategy]}`);
  lines.push(`Intereses: ${pesos(allocation.interest)}`);
  const fees = allocation.charges + allocation.taxes + allocation.lateInterest;
  if (fees > 0) lines.push(`Cargos e impuestos: ${pesos(fees)}`);
  lines.push(`Capital: ${pesos(allocation.principal)}`);
  if (allocation.surplus > 0) lines.push(`Sobrante sin aplicar: ${pesos(allocation.surplus)}`);
  lines.push(`Saldo: ${pesos(before.balanceMinor)} → ${pesos(after.balanceMinor)}`);
  if (before.remainingPeriods !== undefined && after.remainingPeriods !== undefined) lines.push(`Cuotas restantes: ${before.remainingPeriods} → ${after.remainingPeriods}`);
  if (after.nextDue) lines.push(`Próxima cuota: ${pesos(after.nextDue.outstandingMinor)} el ${after.nextDue.dueOn}`);
  if (costMinor > 0) lines.push('', `Se registrará un gasto de ${pesos(costMinor)} en «Costos financieros» (intereses y cargos; el capital no es un gasto).`);
  lines.push('', 'Vista previa: no se guarda hasta que confirmes.');
  return lines.join('\n');
}

/**
 * @param {{ debt: object, events: object[], request: { amountMinor: number, paidOn: string, strategy?: (string | null) },
 *   today: string, ctx: { eventId: string, dedupeKey: string, actorId: string, source: string } }} input
 * @returns {{ ok: true, requiresStrategy: boolean, plan: (object | null), summary: (object | null), text: (string | null) } | { ok: false, issue: string }}
 *   `requiresStrategy` with no `strategy` yet: the caller asks for it before any preview.
 */
export function previewPay({ debt, events, request, today, ctx }) {
  return guard(() => {
    const before = project(debt, events, today);
    const requiresStrategy = !before.card && before.plan.length > 0 && request.amountMinor > dueNow(before);
    if (requiresStrategy && !request.strategy) return { ok: true, requiresStrategy, plan: null, summary: null, text: null };
    const draft = requiresStrategy
      ? { kind: 'extra_payment', effectiveOn: request.paidOn, amountMinor: request.amountMinor, strategy: request.strategy }
      : { kind: 'payment', effectiveOn: request.paidOn, amountMinor: request.amountMinor };
    const plan = planCommit(debt, events, draft, { ...ctx, asOf: today });
    const { allocation } = plan;
    return {
      ok: true,
      requiresStrategy,
      plan,
      summary: { interest: allocation.interest, charges: allocation.charges + allocation.taxes + allocation.lateInterest, principal: allocation.principal, balanceAfter: plan.projection.balanceMinor },
      text: payText(debt, plan, before, request, requiresStrategy),
    };
  });
}

/** DebtTerms (not yet validated) from an extracted create request. */
export function buildTerms(create) {
  const terms = { kind: create.kind, principalMinor: create.principalMinor, openedOn: create.openedOn, rate: create.rate, system: create.system };
  if (create.system !== 'none') {
    terms.periodicity = create.periodicity;
    terms.n = create.n;
    terms.firstDueOn = create.firstDueOn || periodDates(create.openedOn, create.periodicity, 2)[1];
    terms.charges = create.charges;
    // Same rule as the web wizard: a kind with a default mora writes it, a kind without one writes nothing.
    const late = defaultLateFor(create.kind);
    if (late.mode !== 'none') terms.late = late;
  }
  return validateTerms(terms);
}

/** Asks which convention a stated rate follows (shown with the `nia:conv:` buttons). */
export const conventionQuestion = (rateValue) => `Dijiste una tasa de ${rateValue}%, pero no me queda claro de qué tipo es. Elige la convención de tasa de tu contrato:`;

/** Applies a rate convention picked with the `nia:conv:` buttons to the value the user stated. */
export const withConvention = (create, convention) => ({ ...create, rate: normalizeRate({ convention, value: create.rateValue }) });

const LEGAL_UNAVAILABLE_LINE = 'ℹ️ No pude leer las tasas legales del hogar; usé los valores de la app.';

// `legal` is the household's resolved tables (the code tables when absent). A preview that cites a cap while the tables
// could not be read says so in one extra line (legal_rates_unavailable); nothing else changes and nothing blocks.
/** The usury notice of a rate on a date (empty when the rate is not above the cap), plus the unavailable-tables line when it cites a cap. */
export function usuryLines(rate, kind, on, legal) {
  const usury = usuryNotice(rate, kind === 'mortgage' ? 'mortgage' : 'consumer', on, { usuryTable: legal && legal.usuryTable });
  if (!usury) return [];
  const lines = [`⚠️ La tasa (${usury.eaPercent.toFixed(2)}% E.A.) supera el tope de usura de ${usury.capEA}% E.A. vigente al ${usury.asOf}${usury.verified ? '' : ' (tope no verificado oficialmente)'}. Es solo informativo: no bloquea el registro.`];
  if (legal && legal.status === 'unavailable') lines.push(LEGAL_UNAVAILABLE_LINE);
  return lines;
}

function noticeLines(terms, legal) {
  const lines = usuryLines(terms.rate, terms.kind, terms.openedOn, legal);
  if (ley1555Notice(terms, terms.openedOn, { smmlvTable: legal && legal.smmlvTable })) {
    lines.push('ℹ️ Ley 1555: podrías prepagar una hipoteca sin penalización y elegir cómo aplicar el abono. Su alcance para esta deuda no está verificado; revisa tu contrato.');
  }
  return lines;
}

function createText(create, terms, legal) {
  const lines = ['🆕 Nueva deuda', `Nombre: ${create.name} (${KIND_LABELS[terms.kind]})${create.lender ? ` · ${create.lender}` : ''}`, `Monto: ${pesos(terms.principalMinor)}`, `Tasa: ${rateLabel(terms.rate)}`];
  if (terms.system === 'none') {
    lines.push('Plan: solo se lleva el saldo, sin cuotas');
  } else {
    const rows = buildSchedule(terms);
    const totals = summarizeSchedule(rows);
    lines.push(`Plan: ${terms.n} cuotas ${PERIOD_LABELS[terms.periodicity]} · ${SYSTEM_LABELS[terms.system]}`);
    lines.push(`Primera cuota: ${pesos(rows[0].totalDueMinor)} el ${rows[0].dueOn}`);
    lines.push(`Intereses y cargos totales: ${pesos(totals.costMinor)}`);
  }
  if (terms.late && terms.late.mode === 'usury') lines.push('Mora: si una cuota se vence, cobra la tasa de usura vigente. Puedes cambiarla después escribiéndome, por ejemplo: “quita la mora”.');
  return [...lines, ...noticeLines(terms, legal), '', '¿Quieres registrarla así? Aún no se guarda.'].join('\n');
}

/**
 * Preview of a new debt. A rate with no clear convention yields `needsConvention`
 * (the caller shows the `nia:conv:` buttons) before any preview exists.
 * @param {object} create `normaliseDebtExtraction(...).create`
 * @param {{ legal?: object }} [options] `legal`: the household's resolved legal tables (the handler's `loadLegal`).
 */
export function previewCreate(create, options = {}) {
  if (create.rate === null) {
    return { ok: false, needsConvention: true, text: conventionQuestion(create.rateValue) };
  }
  return guard(() => {
    const terms = buildTerms(create);
    return { ok: true, terms, text: createText(create, terms, options.legal) };
  });
}
