import { ValidationError, buildCorrection, modalityOf, previewChange, versionTermsAt } from '@finance-core';
import { formatMoney } from '../../shared/lib/format';
import { formatDecimal, formatDueDate, formatStatedRate } from './debtLabels';
import { impactedFor } from './rateChangeModel';
import { rateEcho, toRate } from './wizard/wizardModel';

// Pure model of the "Corregir datos" dialog (WM1). The form holds strings, like the inputs. The values it starts from are
// those of the terms version in force (`versionTermsAt`), not the rate that a later change put in force: a correction is
// for data that was wrong from the start. The draft comes from `buildCorrection` and the preview from `previewChange`, so
// what the dialog shows equals the projection once the event is saved.

export const RETROACTIVE_NOTE = 'Esta corrección aplica desde el inicio de la deuda (o de su última reestructuración), no desde hoy. Si la condición cambió en la vida real, usa «Cambiar tasa».';
export const NO_CHANGE = 'Los datos son iguales a los guardados. Cambia al menos uno para guardar.';

const RATE_ISSUE = 'Escribe la tasa.';
const BAD_RATE = 'La tasa debe ser un número desde 0; si es anticipada, menor que 100 % por periodo.';
const STATEMENT_ISSUE = 'Escribe el día de corte.';
const DUE_ISSUE = 'Escribe el día límite de pago.';
const DAY_ISSUE = 'Los días de corte y de pago van del 1 al 31.';
const PCT_ISSUE = 'El porcentaje del pago mínimo va de 0 a 100.';
const FLOOR_ISSUE = 'El piso del pago mínimo debe ser un valor en pesos, sin decimales.';
const LAST_STATEMENT_ISSUE = 'Escribe la fecha del último corte.';
const OPENING_MIN_PESOS = 'El pago mínimo del extracto debe ser un valor en pesos, sin decimales.';
const OPENING_MIN_ABOVE = 'El pago mínimo del extracto no puede ser mayor que el saldo de la tarjeta.';
const CANNOT_PREVIEW = 'No se pudo calcular la corrección con esos datos. Revisa los valores.';

/** Legal modalities by their name for the user (they set the usury cap that applies). */
export const MODALITY_LABELS = {
  consumer: 'Consumo',
  low_amount: 'Bajo monto',
  productive: 'Productivo',
  productive_rural: 'Productivo rural',
  productive_urban: 'Productivo urbano',
  popular_rural: 'Popular rural',
  popular_urban: 'Popular urbano',
  mortgage: 'Hipotecario',
};
const RULE_LABELS = {
  interest_fees_plus_pct: 'Intereses y cuotas más un porcentaje',
  installments_due: 'Cuotas del mes',
  pct_balance: 'Un porcentaje del extracto',
};

const blank = (text) => String(text).trim() === '';
const number = (text) => (blank(text) ? NaN : Number(text));
const asText = (value) => String(value);
const percentText = (value) => `${formatDecimal(value)} %`;

/** The form a fresh dialog starts with: the stored values of the terms version in force on `today`. */
export function initialCorrectionForm(debt, events, today) {
  const { terms } = versionTermsAt(debt, events, today);
  const { value, basis, periodicity, timing } = terms.rate;
  const { card } = terms;
  return {
    rate: { value: asText(value), basis, periodicity, timing },
    modality: modalityOf(terms),
    card: card ? {
      statementDay: asText(card.statementDay),
      dueDay: asText(card.dueDay),
      // The statement the card was registered from (its opening date) and that statement's minimum, blank when not stated.
      lastStatementOn: terms.openedOn,
      openingMinimum: card.openingMinimumMinor === undefined ? '' : asText(card.openingMinimumMinor),
      minRule: card.minPayment.rule,
      minPct: asText(card.minPayment.pct),
      minFloor: asText(card.minPayment.floorMinor),
    } : null,
  };
}

// [key, label, text of the value] for each correctable field, in the order they are listed.
const FIELD_LINES = [
  ['rate', 'Tasa', (fields) => (fields.rate ? formatStatedRate(fields.rate) : null)],
  ['modality', 'Modalidad', (fields) => (fields.modality ? MODALITY_LABELS[fields.modality] ?? fields.modality : null)],
  ['statementDay', 'Día de corte', (fields) => (fields.card?.statementDay === undefined ? null : asText(fields.card.statementDay))],
  ['dueDay', 'Día de pago', (fields) => (fields.card?.dueDay === undefined ? null : asText(fields.card.dueDay))],
  ['lastStatementOn', 'Fecha del último corte', (fields) => (fields.card?.lastStatementOn === undefined ? null : formatDueDate(fields.card.lastStatementOn))],
  ['openingMinimum', 'Pago mínimo del extracto', (fields) => (fields.card?.openingMinimumMinor === undefined ? null : formatMoney(fields.card.openingMinimumMinor))],
  ['minRule', 'Cálculo del pago mínimo', (fields) => (fields.card?.minPayment?.rule ? RULE_LABELS[fields.card.minPayment.rule] : null)],
  ['minPct', 'Pago mínimo', (fields) => (fields.card?.minPayment?.pct === undefined ? null : percentText(fields.card.minPayment.pct))],
  ['minFloor', 'Piso del pago mínimo', (fields) => (fields.card?.minPayment?.floorMinor === undefined ? null : formatMoney(fields.card.minPayment.floorMinor))],
];

/**
 * The corrected fields as display lines `{ key, label, before, after }`, in a fixed order; `before` is null when the
 * previous value was not recorded. Used by the dialog's preview and by the history summary.
 * @param {object} fields The corrected values (a `terms_correction` payload's `fields`).
 * @param {object} [previous] The values they replaced.
 */
export function describeCorrection(fields, previous = {}) {
  return FIELD_LINES.filter(([, , read]) => read(fields) !== null).map(([key, label, read]) => ({ key, label, before: read(previous), after: read(fields) }));
}

function cardFieldsOf(card, balanceMinor) {
  const days = [['statementDay', card.statementDay, STATEMENT_ISSUE], ['dueDay', card.dueDay, DUE_ISSUE]];
  const fields = {};
  for (const [key, text, missing] of days) {
    if (blank(text)) return { issue: missing };
    const day = number(text);
    if (!Number.isSafeInteger(day) || day < 1 || day > 31) return { issue: DAY_ISSUE };
    fields[key] = day;
  }
  // The core checks that the date is a statement date of the card and not after today (see CODE_ISSUES).
  if (blank(card.lastStatementOn)) return { issue: LAST_STATEMENT_ISSUE };
  fields.lastStatementOn = card.lastStatementOn;
  if (!blank(card.openingMinimum)) {
    const minimum = number(card.openingMinimum);
    if (!Number.isSafeInteger(minimum) || minimum < 0) return { issue: OPENING_MIN_PESOS };
    if (minimum > balanceMinor) return { issue: OPENING_MIN_ABOVE };
    fields.openingMinimumMinor = minimum;
  }
  const minPayment = { rule: card.minRule };
  if (card.minRule !== 'installments_due') {
    const pct = number(card.minPct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return { issue: PCT_ISSUE };
    minPayment.pct = pct;
  }
  const floor = blank(card.minFloor) ? 0 : number(card.minFloor);
  if (!Number.isSafeInteger(floor) || floor < 0) return { issue: FLOOR_ISSUE };
  minPayment.floorMinor = floor;
  return { fields: { ...fields, minPayment } };
}

const CODE_ISSUES = {
  invalid_rate: BAD_RATE,
  invalid_card: DAY_ISSUE,
  invalid_date: 'Escribe una fecha real para el último corte.',
  not_a_statement_date: 'La fecha del último corte debe caer en tu día de corte (o en el último día de un mes más corto).',
  last_statement_in_future: 'La fecha del último corte no puede ser posterior a hoy.',
};

function figureRows(before, after, isCard) {
  const rows = [];
  const dueText = (snapshot) => (snapshot.nextDueOn ? formatDueDate(snapshot.nextDueOn) : 'Sin pago pendiente');
  if (!isCard) rows.push({ label: 'Próxima cuota', before: formatMoney(before.installmentMinor), after: formatMoney(after.installmentMinor) });
  if (isCard && before.nextDueOn !== after.nextDueOn) rows.push({ label: 'Próximo pago', before: dueText(before), after: dueText(after) });
  if (isCard && (before.nextTotalMinor > 0 || after.nextTotalMinor > 0)) rows.push({ label: 'Próximo pago mínimo', before: formatMoney(before.nextTotalMinor), after: formatMoney(after.nextTotalMinor) });
  rows.push({ label: 'Intereses por pagar', before: formatMoney(before.remainingInterestMinor), after: formatMoney(after.remainingInterestMinor) });
  return rows;
}

function statementsWarning(draft, recorded) {
  const cycle = draft.fields.card;
  if (!cycle || (cycle.statementDay === undefined && cycle.dueDay === undefined && cycle.lastStatementOn === undefined) || recorded === 0) return null;
  return recorded === 1 ? 'Tienes 1 extracto registrado; revisa que coincida.' : `Tienes ${recorded} extractos registrados; revisa que coincidan.`;
}

/**
 * Preview of a correction form: `form` is `{ rate, modality, card }` (strings, as `initialCorrectionForm` returns).
 * Returns the EA `echo` of the rate, an `issue` (a message for an empty, invalid or unchanged form), `noChange`, and once
 * the form is valid and different from the stored values: the `draft` to save (`buildCorrection`), the display `rows` (the
 * corrected fields, then the figures), the `before` and `after` snapshots, the past payments `impacted` and a `warning`
 * about the card statements already recorded.
 */
export function previewCorrection({ debt, events, form, today }) {
  const { terms } = versionTermsAt(debt, events, today);
  const isCard = terms.kind === 'card' && Boolean(form.card);
  const echo = rateEcho(form.rate, form.modality, today, debt.legal);
  const none = { isCard, echo, issue: null, noChange: false, draft: null, rows: [], before: null, after: null, impacted: [], warning: null };
  if (blank(form.rate.value)) return { ...none, issue: RATE_ISSUE };

  const fields = { rate: toRate(form.rate), modality: form.modality };
  if (isCard) {
    const card = cardFieldsOf(form.card, terms.principalMinor);
    if (card.issue) return { ...none, issue: card.issue };
    fields.card = card.fields;
  }

  let draft;
  try {
    draft = buildCorrection(debt, events, fields, { on: today });
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    if (error.code === 'no_change') return { ...none, noChange: true, issue: NO_CHANGE };
    return { ...none, issue: CODE_ISSUES[error.code] ?? CANNOT_PREVIEW };
  }

  try {
    const { before, after, impacted, corrected, statements } = previewChange(debt, events, draft, { on: today });
    const rows = describeCorrection(corrected.after, corrected.before).map(({ label, before: was, after: now }) => ({ label, before: was, after: now }));
    return {
      ...none, draft, before, after, rows: [...rows, ...figureRows(before, after, isCard)],
      impacted: impactedFor(impacted), warning: statementsWarning(draft, statements.recorded),
    };
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return { ...none, issue: CANNOT_PREVIEW };
  }
}
