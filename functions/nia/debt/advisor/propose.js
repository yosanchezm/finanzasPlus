import { ValidationError, addMonthsClamped, buildSchedule, compareIso, cycleDates, evaluateCharges, rateLabel, toEffectiveAnnual } from '../../../../packages/finance-core/index.js';
import { MENTIONS, MIN_RULES } from '../extract.js';
import { pesos } from '../format.js';
import { CONVENTION_BUTTONS } from '../pending.js';
import { PERIOD_LABELS, SYSTEM_LABELS, conventionQuestion, describeCoreError, usuryLines } from '../preview.js';
import { proposeAdjust } from './adjust.js';
import { AMOUNT_ASK, DEFAULT_IVA_PCT, buildSetupTerms, lateFor, setupCharges } from './cardTerms.js';

// proposeSetup (design G13): turns a described case into a draft, the assumptions Nia made, the questions it still has and a preview computed
// by the core. It never writes and does no I/O. A draft is only offered when nothing blocks the creation. Pure and Node 16 safe.

const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isDay = (value) => Number.isInteger(value) && value >= 1 && value <= 31;
const NOT_YET = 'no soportado aún';

const MIN_OPTIONS = [...MIN_RULES, 'unknown'];
const ASK = {
  name: '¿Cómo quieres llamar esta deuda? Por ejemplo: “Tarjeta Bancolombia”.',
  rate: '¿Cuál es la tasa de interés? Dime el valor y de qué tipo es, por ejemplo: 2,1 % mensual vencida.',
  principal: '¿De cuánto es el préstamo? Escríbelo en pesos.',
  term: '¿A cuántas cuotas es?',
  statementDay: '¿Qué día del mes es el corte de tu tarjeta (el cierre del extracto)?',
  dueDay: '¿Qué día del mes es la fecha límite de pago?',
  minRule: '¿Cómo calcula el banco tu pago mínimo? Elige una opción:',
};
const STUCK = {
  statementDay: 'No puedo crear la tarjeta sin el día de corte, y no voy a suponerlo. Lo encuentras en tu extracto o en la app del banco. Cuando lo tengas, escríbemelo y sigo; por ahora no guardé nada.',
  dueDay: 'No puedo crear la tarjeta sin el día límite de pago, y no voy a suponerlo. Lo encuentras en tu extracto o en la app del banco. Cuando lo tengas, escríbemelo y sigo; por ahora no guardé nada.',
  minRule: 'No puedo crear la tarjeta sin saber cómo se calcula el pago mínimo, y no voy a suponerlo. Lo encuentras en tu extracto o en el contrato. Cuando lo tengas, escríbemelo y sigo; por ahora no guardé nada.',
};
const UNSUPPORTED = {
  card_limit: `El cupo de la tarjeta: ${NOT_YET}. Creo la tarjeta sin cupo; no lo guardo ni finjo que quedó guardado.`,
  advance_rate: `La tasa de los avances en efectivo: ${NOT_YET}. No la guardo.`,
  prepayment_penalty: `La penalización por abonos anticipados: ${NOT_YET}. No la guardo.`,
  allocation_order: `El orden en que se aplican los pagos: ${NOT_YET}. Uso el orden que ya maneja la app.`,
  mora_base: `Cobrar la mora sobre toda la cuota: ${NOT_YET}. La mora se calcula sobre el capital vencido.`,
  mora_fixed: `Una tasa de mora propia al crear la deuda: ${NOT_YET}. Uso la tasa de usura por defecto; después puedes pedirme “configura la mora” para cambiarla.`,
};
const INVALID = {
  charge_ref_unknown: 'Un cargo dice que se calcula sobre otro cargo que no está en esta deuda. Dime sobre cuál va (por ejemplo, la cuota de manejo) o corrígelo; no guardé nada.',
  charge_ref_ambiguous: 'Hay más de un cargo con ese nombre o más de una cuota de manejo. Dime con cuál va el cargo; no guardé nada.',
  preset_requires_fee: 'El IVA va sobre una cuota de manejo o comisión y no me diste ninguna. Dime el valor de la cuota o quita el IVA; no guardé nada.',
  preset_exists: 'Ese cargo aparece dos veces. Revisa la lista y dime cuál dejar; no guardé nada.',
  invalid_charge: 'Uno de los cargos no es válido (un monto debe ser en pesos enteros y un porcentaje no puede ser negativo). Corrígelo; no guardé nada.',
  invalid_card: 'Revisa los días del corte y del pago: deben ser días del mes entre 1 y 31. Escríbelos de nuevo; no guardé nada.',
};

const MINIMUM_TEXT = {
  interest_fees_plus_pct: (pct) => `Pago mínimo: intereses, cuota de manejo, cuotas y ${pct} % del saldo`,
  installments_due: () => 'Pago mínimo: intereses, cuota de manejo y cuotas del mes',
  pct_balance: (pct) => `Pago mínimo: ${pct} % del total del extracto`,
};
const PCT_RULES = ['interest_fees_plus_pct', 'pct_balance'];

function nextStatement(card, today) {
  const month = today.slice(0, 7);
  const first = cycleDates(card.statementDay, card.dueDay, month).statementOn;
  if (compareIso(first, today) >= 0) return first;
  return cycleDates(card.statementDay, card.dueDay, addMonthsClamped(`${month}-01`, 1).slice(0, 7)).statementOn;
}

function questionsOf(c, unknown) {
  const questions = [];
  const ask = (field, text, extra = {}) => questions.push({ field, text, blocking: true, ...extra });
  const isCard = c.kind === 'card';
  if (!c.name) ask('name', ASK.name);
  if (!c.rate && c.rateValue === null) ask('rate', ASK.rate);
  else if (!c.rate) ask('convention', conventionQuestion(c.rateValue), { options: CONVENTION_BUTTONS.slice() });
  if (!isCard) {
    if (!Number.isSafeInteger(c.principalMinor) || c.principalMinor <= 0) ask('principal', ASK.principal);
    if (c.system !== 'none' && !c.n) ask('term', ASK.term);
    return questions.concat(amountQuestions(c));
  }
  const card = c.card || {};
  for (const field of ['statementDay', 'dueDay']) {
    if (card[field] === null || card[field] === undefined) ask(field, unknown.includes(field) ? STUCK[field] : ASK[field], unknown.includes(field) ? { stuck: true } : {});
  }
  if (card.minRule === 'unknown' || ((card.minRule === null || card.minRule === undefined) && unknown.includes('minRule'))) ask('minRule', STUCK.minRule, { stuck: true });
  else if (!MIN_RULES.includes(card.minRule)) ask('minRule', ASK.minRule, { options: MIN_OPTIONS.slice() });
  return questions.concat(amountQuestions(c));
}

function amountQuestions(c) {
  const presets = c.presets || {};
  return ['fee', 'life', 'insurance'].filter((key) => has(presets, key) && presets[key] === null).map((key) => ({ field: `amount:${key}`, text: AMOUNT_ASK[key], blocking: true }));
}

function assumptionsOf(c) {
  const presets = c.presets || {};
  const items = [{ code: 'opened_today', text: `Registro la deuda con fecha de hoy (${c.openedOn}).` }];
  if (c.kind === 'card' && !c.principalMinor) items.push({ code: 'opening_zero', text: 'La tarjeta empieza con saldo $ 0: registra tus compras y pagos desde hoy.' });
  const iva = presets.iva === undefined && presets.ivaIncluded === true ? DEFAULT_IVA_PCT : presets.iva;
  if (iva !== undefined) {
    items.push(iva === DEFAULT_IVA_PCT
      ? { code: 'iva_19', text: 'IVA del 19 % (la tarifa general) sobre la cuota de manejo, vinculado a ella: si cambia la cuota, cambia el IVA.' }
      : { code: 'iva_stated', text: `IVA del ${iva} % sobre la cuota de manejo, vinculado a ella: si cambia la cuota, cambia el IVA.` });
  }
  if (presets.ivaIncluded === true && typeof presets.fee === 'number') {
    const fee = Math.round(presets.fee / (1 + (iva === undefined ? DEFAULT_IVA_PCT : iva) / 100));
    items.push({ code: 'iva_included', text: `Tomé ${pesos(presets.fee)} como valor con IVA incluido: la cuota sin IVA es de ${pesos(fee)} (aproximado: valor ÷ 1,19, redondeado).` });
  }
  if (c.lateStated === null || c.lateStated === 'fixed' || c.lateStated === 'whole_installment') {
    items.push(lateFor(c).mode === 'usury'
      ? { code: 'mora_default_usury', text: 'Mora a la tasa de usura vigente, como se hace por defecto con tarjetas y créditos de consumo; puedes cambiarla después.' }
      : { code: 'mora_default_none', text: 'Sin mora, como se hace por defecto con deudas familiares; puedes activarla después.' });
  }
  const card = c.card || {};
  if (c.kind === 'card' && PCT_RULES.includes(card.minRule) && (card.minPct === null || card.minPct === undefined)) {
    items.push({ code: 'min_pct_5', text: 'Porcentaje del pago mínimo: 5 % (el valor habitual); corrígelo si tu extracto dice otro.' });
  }
  return items;
}

function unsupportedOf(c) {
  const codes = MENTIONS.filter((mention) => (c.mentions || []).includes(mention));
  if (c.lateStated === 'whole_installment' && !codes.includes('mora_base')) codes.push('mora_base');
  if (c.lateStated === 'fixed') codes.push('mora_fixed');
  return codes.map((code) => ({ code, text: UNSUPPORTED[code] }));
}

// Without the preset amounts that are still open: the preview shows what is already known.
function knownCase(c) {
  const presets = Object.fromEntries(Object.entries(c.presets || {}).filter(([, value]) => value !== null));
  return { ...c, presets };
}

function chargeLinesOf(c, terms) {
  const isCard = c.kind === 'card';
  let lines;
  if (terms && !isCard && terms.system !== 'none') {
    lines = buildSchedule(terms)[0].charges;
  } else {
    const charges = setupCharges(knownCase(c), { card: isCard });
    const principal = Number.isSafeInteger(c.principalMinor) ? c.principalMinor : 0;
    lines = evaluateCharges(charges, { period: 1, openingMinor: principal, installmentMinor: 0, originalMinor: principal, periodsPerYear: 12, unit: 1 }).lines;
  }
  const approximate = c.presets && c.presets.ivaIncluded === true;
  return lines.map((line) => ({ label: line.label, amountText: `${pesos(line.amountMinor)}${approximate && (line.id === 'fee' || line.id === 'mgmt_fee') ? ' (aproximado)' : ''}` }));
}

function previewOf(c, terms, legal) {
  if (!c.rate) return null;
  const isCard = c.kind === 'card';
  const card = c.card || {};
  const preview = {
    eaText: `${toEffectiveAnnual(c.rate).toFixed(2)}% E.A.`,
    rateLabel: rateLabel(c.rate),
    chargeLines: chargeLinesOf(c, terms),
    usuryLines: usuryLines(c.rate, c.kind, c.openedOn, legal),
  };
  if (isCard && MIN_RULES.includes(card.minRule)) preview.minimumText = MINIMUM_TEXT[card.minRule](card.minPct ?? 5);
  if (isCard && isDay(card.statementDay) && isDay(card.dueDay)) preview.nextStatementOn = nextStatement(card, c.openedOn);
  if (terms && !isCard && terms.system !== 'none') {
    const rows = buildSchedule(terms);
    preview.planText = `${terms.n} cuotas ${PERIOD_LABELS[terms.periodicity]} · ${SYSTEM_LABELS[terms.system]}`;
    preview.firstInstallmentText = `Primera cuota: ${pesos(rows[0].totalDueMinor)} el ${rows[0].dueOn}`;
  }
  return preview;
}

/**
 * @param {object} setupCase The merged `SetupCase` (see `extract.js` and `merge.js`); `unknown` lists the fields declared unknown after one ask.
 * @param {object[]} debts The household's debts, each with its `events` (read only by the adjust mode, when `setupCase.adjust` is true; create mode does not read them).
 * @param {{ usuryTable?: object[], status?: string }} legal The resolved legal tables.
 * @param {string} today `YYYY-MM-DD`
 * @returns {{ mode: ('create' | 'adjust'), draft: ({ setup: object } | null), steps: object[], assumptions: { code: string, text: string }[],
 *   questions: { field: string, text: string, blocking: boolean, options?: string[], stuck?: boolean }[], unsupported: { code: string, text: string }[],
 *   invalid: { code: string, text: string }[], preview: (object | null) }}
 *   `draft` is null while a question is open or something is invalid.
 */
export function proposeSetup(setupCase, debts, legal, today) {
  if (setupCase.adjust) return proposeAdjust(setupCase, debts, today);
  const c = setupCase;
  const questions = questionsOf(c, c.unknown || []);
  const invalid = [];
  const reject = (error) => {
    if (!(error instanceof ValidationError)) throw error;
    if (!invalid.some((item) => item.code === error.code)) invalid.push({ code: error.code, text: INVALID[error.code] || describeCoreError(error) });
  };
  let terms = null;
  try {
    setupCharges(knownCase(c), { card: c.kind === 'card' });
    if (questions.length === 0) terms = buildSetupTerms(c);
  } catch (error) {
    reject(error);
  }
  let preview = null;
  if (invalid.length === 0) {
    try {
      preview = previewOf(c, terms, legal);
    } catch (error) {
      reject(error);
    }
  }
  return {
    mode: 'create',
    draft: questions.length === 0 && invalid.length === 0 && terms ? { setup: c } : null,
    steps: [],
    assumptions: assumptionsOf(c),
    questions,
    unsupported: unsupportedOf(c),
    invalid,
    preview: invalid.length === 0 ? preview : null,
  };
}
