import {
  CHARGE_PRESET_SPECS, CONVENTIONS, buildSchedule, compareIso, isIsoDate, lastStatementOn, ley1555Notice, normalizeRate, periodDates, presetCharges,
  project, rateLabel, summarizeSchedule, toEffectiveAnnual, usuryNotice, validateTerms,
} from '@finance-core';
import { defaultLateDraft, lateFromDraft, lateIssueOf } from '../lateModel';

// Pure state of the "Nueva deuda" wizard. Form values stay as the strings the inputs hold;
// `toTerms` converts them and lets the finance core be the judge of what is valid.

export const STEP_TITLES = { kind: 'Tipo de deuda', basics: 'Datos básicos', rate: 'Tasa de interés', plan: 'Plan de pagos', card: 'Tu tarjeta', charges: 'Seguros y cargos', review: 'Resumen' };

export const stepsFor = (kind) => {
  if (kind === 'informal') return ['kind', 'basics', 'review'];
  if (kind === 'card') return ['kind', 'basics', 'rate', 'card', 'review'];
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
  card: ['none'],
};
export const SYSTEM_LABELS = {
  french: 'Cuota fija (sistema francés)',
  german: 'Abono fijo a capital (sistema alemán)',
  interest_only: 'Intereses y un pago final',
  manual: 'Plan manual (fechas y valores a tu medida)',
  none: 'Sin plan de cuotas',
};

/** The inputs' own text per preset; kind, basis, label, cadence, link and default come from the core spec. */
const PRESET_UI = {
  life: { unit: '% del saldo, por cuota', placeholder: '0,05' },
  insurance: { unit: '$ por cuota', placeholder: '$ 0' },
  fee: { unit: '$ por cuota', placeholder: '$ 0' },
  iva: { unit: '%' },
  gmf: { unit: '%' },
};

/** Offered insurance, fee and tax lines. Evaluation order in the core: IVA after its fee, GMF last. */
export const CHARGE_PRESETS = Object.keys(CHARGE_PRESET_SPECS).map((key) => {
  const { defaultValue, ...spec } = CHARGE_PRESET_SPECS[key];
  return { key, ...spec, ...PRESET_UI[key], ...(defaultValue === undefined ? {} : { defaultValue: String(defaultValue) }) };
});

/** Minimum-payment rules a card can use (see the core's `minimumPayment`). */
export const MIN_RULES = [
  { value: 'interest_fees_plus_pct', label: 'Intereses, cuota de manejo, cuotas y un porcentaje del saldo' },
  { value: 'installments_due', label: 'Intereses, cuota de manejo y cuotas del mes' },
  { value: 'pct_balance', label: 'Un porcentaje del total del extracto' },
];
export const NEW_PURCHASE = { label: '', amount: '', n: '12', rate: '0' };
// `lastStatementOn` blank means "the latest statement day on or before today" (see `cardStatementOn`); `openingMinimum` is the
// minimum payment of that statement, optional.
const DEFAULT_CARD = {
  statementDay: '', dueDay: '', lastStatementOn: '', openingMinimum: '', minRule: 'interest_fees_plus_pct', minPct: '5', minFloor: '', fee: '', feeIva: true, feeIvaPct: '19', deferred: [],
};

export const PERIODICITY_ADJECTIVES = {
  weekly: 'semanal', biweekly: 'cada 14 días', monthly: 'mensual', bimonthly: 'bimestral', quarterly: 'trimestral', semiannual: 'semestral', annual: 'anual',
};
const NAMED_CONVENTIONS = ['EA', 'NAMV', 'MV', 'NATV', 'NATA', 'NAMA'];

const ZERO_RATE = { value: '0', basis: 'effective', periodicity: 'annual', timing: 'arrears' };
const BLANK_RATE = { ...ZERO_RATE, value: '' };
const isInterestFree = (kind) => kind === 'family' || kind === 'informal';

export const initialWizard = (today) => ({
  step: 'kind', kind: null, today, name: '', lender: '', ownerScope: 'shared', principal: '', openedOn: today,
  rate: BLANK_RATE, system: 'french', periodicity: 'monthly', n: '12', firstDueOn: '',
  grace: { periods: '0', type: 'total' }, balloon: '', manualPlan: [], charges: {}, card: DEFAULT_CARD, late: defaultLateDraft(null),
});

export function wizardReducer(state, action) {
  switch (action.type) {
    case 'set': return { ...state, ...action.patch };
    case 'rate': return { ...state, rate: { ...state.rate, ...action.patch } };
    case 'kind': return action.kind === state.kind ? state : { ...state, kind: action.kind, system: SYSTEMS_BY_KIND[action.kind][0], rate: isInterestFree(action.kind) ? ZERO_RATE : BLANK_RATE, charges: {}, balloon: '', card: DEFAULT_CARD, late: defaultLateDraft(action.kind) };
    case 'card': return { ...state, card: { ...state.card, ...action.patch } };
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
/** The numeric rate of a form rate (its value is the string the input holds). */
export const toRate = (rate) => ({ value: num(rate.value), basis: rate.basis, periodicity: rate.periodicity, timing: rate.timing });

/** Due date of the first installment: the explicit one, else one period after the opening date. */
export function firstDueOf(state) {
  try { return state.firstDueOn || periodDates(state.openedOn, state.periodicity, 2)[1]; } catch { return ''; }
}

const chargesOf = (selected) => CHARGE_PRESETS.filter((preset) => preset.key in selected).map((preset) => ({
  id: preset.key, kind: preset.kind, label: preset.label, basis: preset.basis, cadence: 'per_installment',
  value: preset.basis === 'fixed' ? pesos(selected[preset.key]) : num(selected[preset.key]),
  ...(preset.refId ? { refId: preset.refId } : {}),
}));

const blank = (text) => String(text).trim() === '';

/**
 * Date of the card's last statement, the one the user copies the balance from: the date they wrote, else the latest
 * statement day on or before today (clamped to short months). Blank while the statement day is not a valid day.
 */
export function cardStatementOn(state) {
  if (!blank(state.card.lastStatementOn)) return state.card.lastStatementOn;
  try { return lastStatementOn(num(state.card.statementDay), state.today ?? state.openedOn); } catch { return ''; }
}

// The management fee is an ordinary monthly charge; its IVA is a `pctOfCharge` link the user can edit or remove. The core builds both.
const cardCharges = ({ fee, feeIva, feeIvaPct }) => (blank(fee) ? [] : presetCharges({ fee: pesos(fee), ...(feeIva ? { iva: num(feeIvaPct) } : {}) }, { card: true }));

function cardTerms(state) {
  const { card } = state;
  return {
    kind: 'card',
    principalMinor: blank(state.principal) ? 0 : pesos(state.principal),
    // Registered from its last statement: the projector bills that statement as the opening one (no interest or fees of its own).
    openedOn: cardStatementOn(state) || (state.today ?? state.openedOn),
    rate: toRate(state.rate),
    system: 'none',
    periodicity: 'monthly',
    charges: cardCharges(card),
    ...(state.late.mode === 'none' ? {} : { late: lateFromDraft(state.late) }), // a card starts with the usury mora (see defaultLateDraft)
    card: {
      statementDay: num(card.statementDay),
      dueDay: num(card.dueDay),
      minPayment: { rule: card.minRule, pct: num(card.minPct), floorMinor: blank(card.minFloor) ? 0 : pesos(card.minFloor) },
      ...(blank(card.openingMinimum) ? {} : { openingMinimumMinor: pesos(card.openingMinimum) }),
      deferred: card.deferred.map((item, index) => ({
        id: `p${index + 1}`,
        label: item.label.trim() || `Compra ${index + 1}`,
        principalMinor: pesos(item.amount),
        n: num(item.n),
        rate: { convention: 'EA', value: blank(item.rate) ? 0 : num(item.rate) },
      })),
    },
  };
}

/** Validated DebtTerms for the current form. Throws the core's ValidationError when the data is not valid. */
export function toTerms(state) {
  if (state.kind === 'card') return validateTerms(cardTerms(state));
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
    if (state.late.mode !== 'none') terms.late = lateFromDraft(state.late);
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

/** Legal modality whose usury cap applies to a debt kind. */
export const usuryModality = (kind) => (kind === 'mortgage' ? 'mortgage' : 'consumer');

/**
 * Live echo of a rate entry: its label with the EA equivalent and the (informational) usury notice.
 * `legal` is the household's resolved tables (`{ usuryTable }`); without it the code tables apply.
 */
export function rateEcho(rate, modality, asOf, legal) {
  if (String(rate.value).trim() === '') return { ok: false };
  try {
    const normalized = normalizeRate(toRate(rate));
    return { ok: true, label: describeRate(normalized), eaPercent: toEffectiveAnnual(normalized), notice: usuryNotice(normalized, modality, asOf, { usuryTable: legal?.usuryTable }) };
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
  invalid_card: ['card', 'Revisa los días de corte y de pago, el porcentaje del pago mínimo y las compras a cuotas (mínimo 2 cuotas).'],
  terms_too_large: ['plan', 'El plan es demasiado largo para guardarlo. Reduce las cuotas.'],
};
const GENERIC_ISSUE = { step: 'plan', message: 'Revisa el número de cuotas y la periodicidad.' };

function missingFields(state) {
  const issues = [];
  if (!state.name.trim()) issues.push({ step: 'basics', message: 'Escribe un nombre para la deuda.', missing: true });
  if (state.kind !== 'card' && !String(state.principal).trim()) issues.push({ step: 'basics', message: 'Escribe el monto del préstamo.', missing: true });
  if (state.kind === 'card') {
    if (blank(state.card.statementDay)) issues.push({ step: 'card', message: 'Escribe el día de corte.', missing: true });
    if (blank(state.card.dueDay)) issues.push({ step: 'card', message: 'Escribe el día límite de pago.', missing: true });
  }
  if (String(state.rate.value).trim() === '') issues.push({ step: 'rate', message: 'Escribe la tasa de interés (0 si no cobra intereses).', missing: true });
  for (const preset of CHARGE_PRESETS) {
    if (preset.key in state.charges && !String(state.charges[preset.key]).trim()) {
      issues.push({ step: 'charges', message: `Escribe el valor de “${preset.label}” o quítalo.`, missing: true });
    }
  }
  return issues;
}

// The last statement must be a real statement date of the card, not after today, and its minimum cannot exceed its balance.
function cardIssues(state) {
  if (state.kind !== 'card') return [];
  const issues = [];
  const issue = (message) => issues.push({ step: 'card', message });
  const { lastStatementOn: written, openingMinimum, statementDay } = state.card;
  const today = state.today ?? state.openedOn;
  if (!blank(written)) {
    if (!isIsoDate(written)) issue('Escribe una fecha real para el último corte.');
    else if (compareIso(written, today) > 0) issue('La fecha del último corte no puede ser posterior a hoy.');
    else {
      let expected = '';
      try { expected = lastStatementOn(num(statementDay), written); } catch { /* the day itself is reported by the core */ }
      if (expected !== '' && expected !== written) issue(`La fecha del último corte debe caer en tu día de corte (el ${num(statementDay)} o el último día de un mes más corto).`);
    }
  }
  if (!blank(openingMinimum) && pesos(openingMinimum) > (blank(state.principal) ? 0 : pesos(state.principal))) {
    issue('El pago mínimo del extracto no puede ser mayor que el saldo del último extracto.');
  }
  return issues;
}

/** What the review shows for a card: its last statement, and the next payment with its minimum. */
function cardPreviewOf(terms, today) {
  const projection = project({ terms }, [], today);
  const due = projection.nextDue;
  return { lastStatementOn: terms.openedOn, nextDueOn: due ? due.dueOn : projection.card.nextDueOn, minimumMinor: due ? due.outstandingMinor : 0 };
}

/**
 * Checks the whole form against the core. `issues` lists `{ step, message }` in friendly Spanish;
 * when it is empty, `terms`, a `summary` of the schedule (first installment and totals) and the
 * legal `notices` (informational, never blocking) are ready for the review step.
 * `legal` is the household's resolved tables (`{ usuryTable, smmlvTable }`); without it the code tables apply.
 */
export function evaluate(state, legal) {
  const issues = [...missingFields(state), ...cardIssues(state)];
  const lateIssue = state.kind === 'card' || state.system === 'none' ? null : lateIssueOf(state.late);
  if (lateIssue) return { issues: [...issues, { step: 'plan', ...lateIssue }] };
  try {
    const terms = toTerms(state);
    if (issues.length) return { issues };
    const schedule = terms.system === 'none' ? [] : buildSchedule(terms);
    const summary = schedule.length ? { ...summarizeSchedule(schedule), firstDueOn: schedule[0].dueOn, firstDueMinor: schedule[0].totalDueMinor } : null;
    const notices = [
      usuryNotice(terms.rate, usuryModality(terms.kind), terms.openedOn, { usuryTable: legal?.usuryTable }),
      ley1555Notice(terms, terms.openedOn, { smmlvTable: legal?.smmlvTable }),
    ].filter(Boolean);
    if (terms.kind === 'card') return { issues: [], terms, summary, notices, cardPreview: cardPreviewOf(terms, state.today ?? state.openedOn) };
    return { issues: [], terms, summary, notices };
  } catch (error) {
    const [step, message] = CORE_ISSUES[error?.code] ?? [];
    const found = message ? { step: state.kind === 'card' && step === 'charges' ? 'card' : step, message } : GENERIC_ISSUE;
    // A field that is still empty explains its own step better than the core's complaint about it.
    return { issues: issues.some((issue) => issue.step === found.step) ? issues : [...issues, found] };
  }
}
