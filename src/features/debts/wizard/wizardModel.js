import {
  CONVENTIONS, buildSchedule, ley1555Notice, normalizeRate, periodDates, rateLabel, summarizeSchedule,
  toEffectiveAnnual, usuryNotice, validateTerms,
} from '@finance-core';

// Pure state of the "Nueva deuda" wizard. Form values stay as the strings the inputs hold;
// `toTerms` converts them and lets the finance core be the judge of what is valid.

export const STEP_TITLES = { kind: 'Tipo de deuda', basics: 'Datos básicos', rate: 'Tasa de interés', plan: 'Plan de pagos', charges: 'Seguros y cargos', review: 'Resumen' };

export const stepsFor = (kind) => {
  if (kind === 'informal') return ['kind', 'basics', 'review'];
  if (kind === 'family') return ['kind', 'basics', 'rate', 'plan', 'review'];
  return ['kind', 'basics', 'rate', 'plan', 'charges', 'review'];
};

/** Payment systems each kind offers; the first one is the default. */
export const SYSTEMS_BY_KIND = {
  consumer: ['french', 'german'],
  vehicle: ['french', 'german'],
  libranza: ['french', 'german'],
  mortgage: ['french', 'german'],
  leasing: ['interest_only', 'french'],
  family: ['french', 'manual'],
  other: ['manual', 'french'],
  informal: ['none'],
};
export const SYSTEM_LABELS = {
  french: 'Cuota fija (sistema francés)',
  german: 'Abono fijo a capital (sistema alemán)',
  interest_only: 'Intereses y un pago final',
  manual: 'Plan manual (fechas y valores a tu medida)',
  none: 'Sin plan de cuotas',
};

/** Offered insurance, fee and tax lines. Evaluation order in the core: IVA after its fee, GMF last. */
export const CHARGE_PRESETS = [
  { key: 'life', kind: 'insurance', label: 'Seguro de vida', basis: 'pctOutstanding', unit: '% del saldo, por cuota', placeholder: '0,05' },
  { key: 'insurance', kind: 'insurance', label: 'Otro seguro', basis: 'fixed', unit: '$ por cuota', placeholder: '$ 0' },
  { key: 'fee', kind: 'fee', label: 'Comisión o cuota de manejo', basis: 'fixed', unit: '$ por cuota', placeholder: '$ 0' },
  { key: 'iva', kind: 'tax', label: 'IVA sobre la comisión', basis: 'pctOfCharge', refId: 'fee', requires: 'fee', unit: '%', defaultValue: '19' },
  { key: 'gmf', kind: 'tax', label: 'GMF (4 x 1000)', basis: 'pctOfSubtotal', unit: '%', defaultValue: '0.4' },
];

export const PERIODICITY_ADJECTIVES = {
  weekly: 'semanal', biweekly: 'cada 14 días', monthly: 'mensual', bimonthly: 'bimestral', quarterly: 'trimestral', semiannual: 'semestral', annual: 'anual',
};
const NAMED_CONVENTIONS = ['EA', 'NAMV', 'MV', 'NATV', 'NATA', 'NAMA'];

const ZERO_RATE = { value: '0', basis: 'effective', periodicity: 'annual', timing: 'arrears' };
const BLANK_RATE = { ...ZERO_RATE, value: '' };
const isInterestFree = (kind) => kind === 'family' || kind === 'informal';

export const initialWizard = (today) => ({
  step: 'kind', kind: null, name: '', lender: '', ownerScope: 'shared', principal: '', openedOn: today,
  rate: BLANK_RATE, system: 'french', periodicity: 'monthly', n: '12', firstDueOn: '',
  grace: { periods: '0', type: 'total' }, balloon: '', manualPlan: [], charges: {},
});

export function wizardReducer(state, action) {
  switch (action.type) {
    case 'set': return { ...state, ...action.patch };
    case 'rate': return { ...state, rate: { ...state.rate, ...action.patch } };
    case 'kind': return { ...state, kind: action.kind, system: SYSTEMS_BY_KIND[action.kind][0], rate: isInterestFree(action.kind) ? ZERO_RATE : BLANK_RATE, charges: {}, balloon: '' };
    case 'step': {
      const steps = stepsFor(state.kind);
      const at = steps.indexOf(state.step);
      const target = action.to === 'next' ? steps[Math.min(at + 1, steps.length - 1)] : action.to === 'back' ? steps[Math.max(at - 1, 0)] : action.to;
      return { ...state, step: target };
    }
    case 'charge': {
      const preset = CHARGE_PRESETS.find((item) => item.key === action.key);
      const charges = { ...state.charges };
      if (action.value === null) {
        delete charges[action.key];
        for (const dependent of CHARGE_PRESETS) if (dependent.requires === action.key) delete charges[dependent.key];
      } else if (!preset.requires || preset.requires in charges) charges[action.key] = action.value;
      return { ...state, charges };
    }
    default: return state;
  }
}

const num = (text) => (String(text).trim() === '' ? NaN : Number(text));
const pesos = (text) => Math.round(num(text));
const toRate = (rate) => ({ value: num(rate.value), basis: rate.basis, periodicity: rate.periodicity, timing: rate.timing });

/** Due date of the first installment: the explicit one, else one period after the opening date. */
export function firstDueOf(state) {
  try { return state.firstDueOn || periodDates(state.openedOn, state.periodicity, 2)[1]; } catch { return ''; }
}

const chargesOf = (selected) => CHARGE_PRESETS.filter((preset) => preset.key in selected).map((preset) => ({
  id: preset.key, kind: preset.kind, label: preset.label, basis: preset.basis, cadence: 'per_installment',
  value: preset.basis === 'fixed' ? pesos(selected[preset.key]) : num(selected[preset.key]),
  ...(preset.refId ? { refId: preset.refId } : {}),
}));

/** Validated DebtTerms for the current form. Throws the core's ValidationError when the data is not valid. */
export function toTerms(state) {
  const { system } = state;
  const terms = { kind: state.kind, principalMinor: pesos(state.principal), openedOn: state.openedOn, rate: toRate(state.rate), system };
  if (system !== 'none') {
    terms.periodicity = state.periodicity;
    terms.charges = chargesOf(state.charges);
    if (system === 'manual') terms.manualPlan = state.manualPlan.map((row) => [row.dueOn, pesos(row.amount)]);
    else {
      terms.n = num(state.n);
      terms.firstDueOn = firstDueOf(state);
    }
    if (['french', 'german'].includes(system) && num(state.grace.periods) > 0) terms.grace = { periods: num(state.grace.periods), type: state.grace.type };
    if (system === 'interest_only' && state.balloon !== '') terms.balloonMinor = pesos(state.balloon);
  }
  return validateTerms(terms);
}

const trimmed = (value) => String(Number(Number(value).toFixed(4)));

export function conventionOf(rate) {
  return NAMED_CONVENTIONS.find((name) => ['basis', 'periodicity', 'timing'].every((key) => CONVENTIONS[name][key] === rate[key])) ?? 'custom';
}

export function describeRate(rate) {
  if (conventionOf(rate) !== 'custom') return rateLabel(rate);
  const kind = rate.basis === 'nominal' ? 'nominal' : 'efectiva';
  return `${trimmed(rate.value)}% ${kind} ${PERIODICITY_ADJECTIVES[rate.periodicity]}${rate.timing === 'advance' ? ' anticipada' : ''} ≈ ${toEffectiveAnnual(rate).toFixed(2)}% EA`;
}

const usuryModality = (kind) => (kind === 'mortgage' ? 'mortgage' : 'consumer');

/** Live echo of a rate entry: its label with the EA equivalent and the (informational) usury notice. */
export function rateEcho(rate, modality, asOf) {
  if (String(rate.value).trim() === '') return { ok: false };
  try {
    const normalized = normalizeRate(toRate(rate));
    return { ok: true, label: describeRate(normalized), eaPercent: toEffectiveAnnual(normalized), notice: usuryNotice(normalized, modality, asOf) };
  } catch {
    return { ok: false };
  }
}

const CORE_ISSUES = {
  invalid_principal: ['basics', 'El monto del préstamo debe ser mayor que cero.'],
  invalid_minor: ['basics', 'Escribe el monto en pesos, sin decimales.'],
  invalid_date: ['basics', 'Revisa las fechas: deben ser fechas reales.'],
  invalid_rate: ['rate', 'La tasa debe ser un número desde 0; si es anticipada, menor que 100 % por periodo.'],
  invalid_grace: ['plan', 'El periodo de gracia debe ser menor que el número de cuotas.'],
  grace_unsupported: ['plan', 'El periodo de gracia solo aplica a planes de cuota fija o de abono fijo a capital.'],
  invalid_balloon: ['plan', 'El pago final debe ser mayor que cero y no superar el monto del préstamo.'],
  invalid_manual_plan: ['plan', 'Cada cuota necesita una fecha real y un valor mayor que cero, con las fechas en orden.'],
  manual_plan_below_interest: ['plan', 'Una cuota del plan no alcanza a cubrir los intereses de ese periodo. Súbela o revisa la tasa.'],
  installment_too_low: ['plan', 'La cuota no alcanza a pagar el crédito con esta tasa. Revisa el plan.'],
  invalid_charge: ['charges', 'Revisa los seguros y cargos: cada uno necesita un valor válido.'],
  terms_too_large: ['plan', 'El plan es demasiado largo para guardarlo. Reduce las cuotas.'],
};
const GENERIC_ISSUE = { step: 'plan', message: 'Revisa el número de cuotas y la periodicidad.' };

function missingFields(state) {
  const issues = [];
  if (!state.name.trim()) issues.push({ step: 'basics', message: 'Escribe un nombre para la deuda.', missing: true });
  if (!String(state.principal).trim()) issues.push({ step: 'basics', message: 'Escribe el monto del préstamo.', missing: true });
  if (String(state.rate.value).trim() === '') issues.push({ step: 'rate', message: 'Escribe la tasa de interés (0 si no cobra intereses).', missing: true });
  for (const preset of CHARGE_PRESETS) {
    if (preset.key in state.charges && !String(state.charges[preset.key]).trim()) {
      issues.push({ step: 'charges', message: `Escribe el valor de “${preset.label}” o quítalo.`, missing: true });
    }
  }
  return issues;
}

/**
 * Checks the whole form against the core. `issues` lists `{ step, message }` in friendly Spanish;
 * when it is empty, `terms`, a `summary` of the schedule (first installment and totals) and the
 * legal `notices` (informational, never blocking) are ready for the review step.
 */
export function evaluate(state) {
  const issues = missingFields(state);
  try {
    const terms = toTerms(state);
    if (issues.length) return { issues };
    const schedule = terms.system === 'none' ? [] : buildSchedule(terms);
    const summary = schedule.length ? { ...summarizeSchedule(schedule), firstDueOn: schedule[0].dueOn, firstDueMinor: schedule[0].totalDueMinor } : null;
    const notices = [usuryNotice(terms.rate, usuryModality(terms.kind), terms.openedOn), ley1555Notice(terms, terms.openedOn)].filter(Boolean);
    return { issues: [], terms, summary, notices };
  } catch (error) {
    const [step, message] = CORE_ISSUES[error?.code] ?? [];
    const found = message ? { step, message } : GENERIC_ISSUE;
    // A field that is still empty explains its own step better than the core's complaint about it.
    return { issues: issues.some((issue) => issue.step === found.step) ? issues : [...issues, found] };
  }
}
