import { EXPLAIN_TOPICS, LATE_MODES, PERIODICITIES, ValidationError, isIsoDate, normalizeLate, normalizeRate } from '../../../packages/finance-core/index.js';
import { readLegalRate } from './legal.js';
import { SYSTEMS, readChargeChange, readPlanChange, readRestructure } from './planChange.js';

// The second, specialised Gemini call (AD10): the model only EXTRACTS what the
// user said. Validation, arithmetic and every decision happen in code (NDA-1).
// Pure and Node 16 safe.

export const ACTIONS = ['create', 'pay', 'simulate', 'advise', 'list', 'legal_rate', 'rate_change', 'charge_change', 'restructure', 'late_policy', 'explain', 'setup'];
export const STRATEGIES = ['reduce_term', 'reduce_installment', 'advance_installments'];
export const MAX_CHARGES = 6;

const KINDS = ['consumer', 'vehicle', 'libranza', 'mortgage', 'leasing', 'family', 'informal', 'card', 'other'];
const CHARGE_KINDS = ['insurance', 'fee', 'tax', 'other'];
const CHARGE_BASES = ['fixed', 'pctOutstanding', 'pctOriginal', 'pctOfSubtotal'];
const CHARGE_CADENCES = ['per_installment', 'annual', 'once'];
/** Minimum-payment rules of a card (the core's `MIN_RULES`), plus `unknown` for «no sé». */
export const MIN_RULES = ['interest_fees_plus_pct', 'installments_due', 'pct_balance'];
const LATE_STATED = ['usury', 'fixed', 'none', 'whole_installment'];
/** What the user may mention that Nia cannot save yet: it explains the field and answers «no soportado aún». */
export const MENTIONS = ['card_limit', 'advance_rate', 'prepayment_penalty', 'allocation_order', 'mora_base'];
const DEFAULT_IVA = 19;
const INTEREST_FREE_KINDS = ['family', 'informal'];
const ZERO_RATE = { value: 0, basis: 'effective', periodicity: 'annual', timing: 'arrears' };

const SCHEMA = '{"action":"create|pay|simulate|advise|list|legal_rate|rate_change|charge_change|restructure|late_policy|explain|setup","topic":"' + EXPLAIN_TOPICS.join('|') + '|null","debtRef":"string|null","kind":"consumer|vehicle|libranza|mortgage|leasing|family|informal|card|other|null","name":"string|null","lender":"string|null","principalMinor":number|null,"rate":{"value":number|null,"period":"annual|monthly|bimonthly|quarterly|semiannual|weekly|biweekly|null","compounding":"effective|nominal|null","timing":"arrears|advance|null","rawText":"string|null"}|null,"n":number|null,"periodicity":"monthly|biweekly|weekly|bimonthly|quarterly|semiannual|annual|null","system":"french|german|bullet|interest_only|null","firstDueOn":"YYYY-MM-DD|null","amountMinor":number|null,"paidOn":"YYYY-MM-DD|null","strategy":"reduce_term|reduce_installment|advance_installments|null","extraMinor":number|null,"charges":[{"kind":"insurance|fee|tax|other","label":"string","basis":"fixed|pctOutstanding|pctOriginal|pctOfSubtotal","value":number}],"legal":{"kind":"usury|ibc|smmlv|null","modality":"string|null","month":"string|number|null","year":number|null,"value":number|null}|null,"planChange":{"effectiveOn":"YYYY-MM-DD|null","mode":"keep_term|keep_installment|null","chargeRef":"string|null","op":"set|remove|add|null","newValue":number|null,"presets":{"fee":number|true|null,"iva":number|true|null,"ivaIncluded":boolean|null,"life":number|true|null,"insurance":number|true|null,"gmf":boolean|null}|null,"kind":"insurance|fee|tax|other|null","label":"string|null","basis":"fixed|pctOutstanding|pctOriginal|pctOfSubtotal|pctOfCharge|null","cadence":"per_installment|annual|once|null","refLabel":"string|null","n":number|null,"system":"french|german|bullet|interest_only|null","periodicity":"monthly|biweekly|weekly|bimonthly|quarterly|semiannual|annual|null","firstDueOn":"YYYY-MM-DD|null","waiveLate":boolean|null}|null,"late":{"mode":"none|usury|fixed|contract_multiple|null","rate":{"value":number|null,"period":"annual|monthly|bimonthly|quarterly|semiannual|weekly|biweekly|null","compounding":"effective|nominal|null","timing":"arrears|advance|null","rawText":"string|null"}|null,"multiple":number|null,"graceDays":number|null,"effectiveOn":"YYYY-MM-DD|null"}|null,"setup":{"card":{"statementDay":number|null,"dueDay":number|null,"minRule":"interest_fees_plus_pct|installments_due|pct_balance|unknown|null","minPct":number|null,"minFloorMinor":number|null},"presets":{"fee":number|true|null,"iva":number|true|null,"ivaIncluded":boolean|null,"life":number|true|null,"insurance":number|true|null,"gmf":boolean|null},"charges":[{"kind":"insurance|fee|tax|other","label":"string","basis":"fixed|pctOutstanding|pctOriginal|pctOfSubtotal|pctOfCharge","value":number,"cadence":"per_installment|annual|once|null","refLabel":"string|null"}],"lateStated":"usury|fixed|none|whole_installment|null","mentions":["card_limit|advance_rate|prepayment_penalty|allocation_order|mora_base"]}|null,"missingFields":["string"]}';

const conversationLines = (history) => (history || [])
  .map((item) => `${item.role === 'assistant' ? 'Nia' : 'Usuario'}: ${item.content}`)
  .join('\n');

const debtLine = (debt) => `- ${debt.name} (tipo ${debt.kind}${debt.lender ? `, entidad ${debt.lender}` : ''})`;

// A described debt that Nia is still asking questions about (S5c): without this line a short answer such as «el corte es el 15» could be read as a new request.
const openSetupLine = ({ kind, name }) => `Hay una configuración de deuda en curso: ${kind === 'card' ? 'tarjeta' : 'deuda'} «${name || 'sin nombre'}» (kind ${kind}). Nia le hizo preguntas al usuario sobre ella. Si el mensaje las responde (día de corte o de pago, cómo se calcula el pago mínimo, la tasa, un monto, “no sé”), usa action setup con kind ${kind} y llena solo lo que el usuario dijo en este mensaje; el resto va en null. Si pide otra cosa, usa la acción que corresponda.`;

/**
 * Prompt of the debt extraction call.
 * @param {string} text The user's message.
 * @param {object[]} debts Existing `debts` rows (names help the model choose `debtRef`).
 * @param {{ role: string, content: string }[]} history Recent chat turns.
 * @param {{ today: string, timezone?: string, currency?: string, setup?: ({ kind: string, name: string } | null) }} options `setup`: the described debt that is waiting for answers.
 */
export function debtPrompt(text, debts, history, { today, timezone = 'America/Bogota', currency = 'COP', setup = null } = {}) {
  return [
    'Eres Nia. Extrae los datos de una solicitud sobre deudas (préstamos y tarjetas) de un hogar. Solo extraes: no calcules cuotas, saldos, intereses ni equivalencias de tasa; el sistema lo hace.',
    `La fecha de hoy en ${timezone} es ${today}. La moneda es ${currency}; los montos son enteros en pesos, no centavos.`,
    'action: create para registrar una deuda nueva, pay para un pago o abono, simulate para simular un abono extra, advise para pedir una recomendación y list para ver las deudas. legal_rate registra una tasa legal: la usura, el IBC o el salario mínimo (SMMLV) de un mes o año, por ejemplo “la usura de noviembre es 28.2”. rate_change cambia la tasa de una deuda que ya existe, por ejemplo “bajó la tasa del crédito a 22% EA desde hoy”. charge_change cambia el valor de un seguro o cargo que una deuda ya tiene, o lo quita, por ejemplo “quita el seguro de vida del crédito”; también se usa cuando piden agregar uno nuevo. restructure reestructura una deuda que ya existe: rehace el plan de cuotas con el saldo actual y lo vencido, por ejemplo “reestructura el crédito a 48 cuotas, primera cuota el 2026-12-05”.',
    'explain responde una pregunta o pide explicar un concepto de deudas (tasas y sus convenciones, usura o IBC, mora, abonos, cargos, GMF, corte de la tarjeta, reestructuración, abonos extra); no escribe nada. Con explain, topic es uno de: ' + EXPLAIN_TOPICS.join(', ') + '; usa null si no es claro cuál. Si el usuario da una tasa o un monto para el ejemplo, cópialos en rate y amountMinor tal como los dijo. Si pide registrar, pagar o cambiar algo, no es explain.',
    'setup arma una deuda nueva a partir de un caso que el usuario describe, por ejemplo “tarjeta Bancolombia, extracto 2,1% MV, cuota de manejo 45.000 más IVA”; también se usa create con kind card. Usa los campos comunes (kind, name, lender, rate, principalMinor, n…) y el bloque setup. En setup.card: statementDay y dueDay (día del mes, 1 a 31), minRule (interest_fees_plus_pct si el mínimo es intereses, cuota de manejo y un porcentaje del saldo; installments_due si es intereses, cuota de manejo y cuotas del mes; pct_balance si es un porcentaje del total del extracto; unknown si dice que no sabe) con minPct y minFloorMinor; usa null en lo que no dijo y nunca lo supongas. En setup.presets pon solo las claves que el usuario mencionó (omítelas o usa null si no las mencionó): fee es la cuota de manejo o comisión (pesos), iva su IVA (el porcentaje, o true si dice “más IVA” sin porcentaje), ivaIncluded true si el monto ya incluye el IVA, life el seguro de vida como porcentaje del saldo, insurance otro seguro como monto fijo en pesos, gmf true si cobran el 4 por mil; usa true en fee, life o insurance si lo mencionó sin dar el monto. En setup.charges solo cargos que no son esos presets; un cargo que se calcula como porcentaje de otro (basis pctOfCharge) lleva en refLabel el nombre del cargo al que se aplica. En setup.lateStated copia lo que dijo de la mora (usury, fixed, none, whole_installment si cobran la mora sobre toda la cuota) o null. En setup.mentions pon card_limit si dijo el cupo, advance_rate si dijo la tasa de avances, prepayment_penalty si dijo una penalización por abono, allocation_order si dijo el orden de aplicación de los pagos y mora_base si habló de la base de la mora; nunca pongas el cupo en otro campo.',
    'late_policy configura la mora (intereses por cuotas vencidas) de una deuda que ya existe, por ejemplo “activa mora a la usura en el crédito del banco” o “quita la mora del préstamo a mi hermano”. En late: mode es usury si la mora va a la tasa máxima legal (usura), fixed si da una tasa fija propia (esa tasa va en late.rate, igual que rate al crear), contract_multiple si es un múltiplo de la tasa del contrato (late.multiple, por ejemplo 1.5 veces), none si no quiere mora; graceDays son los días de gracia que dijo (null si no dijo) y effectiveOn la fecha desde la que rige, tal como la dijo, o null si no la dijo. Si no es una política de mora, late es null.',
    'debtRef es el nombre, entidad o tipo de la deuda tal como lo dijo el usuario; usa null si no menciona ninguna.',
    'En rate copia lo que dijo el usuario: value, period (de cuánto es la tasa), compounding (effective si es efectiva o periódica como “2,1% mensual”, nominal si dice nominal) y timing (arrears si es vencida, advance si es anticipada). Si no lo dijo, usa null; nunca lo supongas.',
    'En legal copia lo que dijo el usuario: kind (usury, ibc o smmlv), modality como la nombró (consumo, hipotecario, productivo rural…) o null, month tal como lo escribió (por ejemplo “noviembre”; no conviertas el mes a número ni le pongas año), year solo si lo dijo, y value (el porcentaje tal cual, 28.2; para el salario mínimo, pesos enteros). Si no es una tasa legal, legal es null.',
    'En planChange, para rate_change: la nueva tasa va en rate (igual que al crear); effectiveOn es la fecha desde la que rige el cambio, tal como la dijo, o null si no la dijo; mode es keep_term si quiere mantener el plazo (la cuota se recalcula), keep_installment si quiere mantener la cuota (el plazo se recalcula) y null si no lo dijo. Para charge_change: chargeRef es el nombre del seguro o cargo tal como lo dijo (por ejemplo “seguro de vida”), op es set para cambiar su valor, remove para quitarlo y add para agregar uno nuevo, y newValue el valor nuevo (pesos enteros si es un monto fijo; el porcentaje tal cual si es un porcentaje); usa null en lo que no dijo. Para agregar un seguro o cargo (op add): en presets pon solo lo que mencionó (fee es la cuota de manejo o comisión en pesos, iva su IVA, ivaIncluded si el monto ya lo incluye, life el seguro de vida como porcentaje del saldo, insurance otro seguro en pesos, gmf true si cobran el 4 por mil; true en fee, life o insurance si lo mencionó sin monto); si no es uno de esos, usa kind, label, basis, newValue (el valor), cadence (per_installment si es por cuota o mensual, annual, once) y refLabel (el nombre del cargo al que se aplica, solo con basis pctOfCharge). Nunca supongas el valor. Para restructure: n es el número de cuotas del plan nuevo, system y periodicity solo si los cambia, firstDueOn la fecha de la primera cuota tal como la dijo, waiveLate true solo si pide condonar o perdonar los intereses de mora, y la tasa nueva, si la dice, va en rate; charges solo si dice cuáles seguros o cargos tendrá el plan nuevo (reemplazan los actuales). Si no es un cambio de plan, planChange es null.',
    'Nunca inventes una fecha: usa null si no la dijo. Si falta un dato necesario, añade su nombre en missingFields.',
    ...(setup ? [openSetupLine(setup)] : []),
    'Devuelve únicamente JSON válido, sin markdown, con exactamente estas claves:',
    SCHEMA,
    debts.length ? `Deudas registradas:\n${debts.map(debtLine).join('\n')}` : 'No hay deudas registradas.',
    history && history.length ? `Contexto reciente del chat:\n${conversationLines(history)}` : 'Sin contexto anterior.',
    `Nuevo mensaje del usuario:\n${text}`,
  ].join('\n\n');
}

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const MAX_LATE_MULTIPLE = 3;
const MAX_LATE_GRACE_DAYS = 90;
const isPositiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
const hasKey = (object, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(object, key);

// undefined: the user did not say it; null: said but invalid (recorded in `problems`); number: valid.
function readAmount(value, problems) {
  if (value === null || value === undefined) return undefined;
  const problem = typeof value !== 'number' || !Number.isFinite(value) ? 'invalid_amount' : value < 0 ? 'negative_amount' : !isPositiveInteger(value) ? 'invalid_amount' : null;
  if (problem) {
    problems.push(problem);
    return null;
  }
  return value;
}

function readCharges(raw) {
  const charges = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const value = item && item.value;
    const valid = item
      && CHARGE_BASES.includes(item.basis)
      && typeof value === 'number' && Number.isFinite(value) && value >= 0
      && (item.basis !== 'fixed' || Number.isSafeInteger(value));
    if (valid && charges.length < MAX_CHARGES) {
      charges.push({
        id: `c${charges.length + 1}`,
        kind: CHARGE_KINDS.includes(item.kind) ? item.kind : 'other',
        label: text(item.label, 40) || `Cargo ${charges.length + 1}`,
        basis: item.basis,
        value,
        cadence: 'per_installment',
      });
    }
  }
  return charges;
}

// Annual rates need no timing. Any other period must state compounding and timing, otherwise the
// user is asked to choose the convention with buttons (NDA-2).
function readRate(raw, kind, problems) {
  const value = raw && typeof raw.value === 'number' && Number.isFinite(raw.value) ? raw.value : null;
  if (value === null) {
    const interestFree = INTEREST_FREE_KINDS.includes(kind);
    return { rate: interestFree ? ZERO_RATE : null, rateValue: null, missing: !interestFree };
  }
  if (value < 0) {
    problems.push('invalid_rate');
    return { rate: null, rateValue: null };
  }
  if (value === 0) return { rate: ZERO_RATE, rateValue: 0 };
  const periodKnown = hasKey(PERIODICITIES, raw.period);
  const annual = raw.period === 'annual';
  const complete = periodKnown && (annual || (['effective', 'nominal'].includes(raw.compounding) && ['arrears', 'advance'].includes(raw.timing)));
  if (!complete) return { rate: null, rateValue: value, needsConvention: true };
  try {
    const rate = normalizeRate({
      value,
      basis: raw.compounding === 'nominal' ? 'nominal' : 'effective',
      periodicity: raw.period,
      timing: raw.timing === 'advance' ? 'advance' : 'arrears',
    });
    return { rate, rateValue: value };
  } catch {
    problems.push('invalid_rate');
    return { rate: null, rateValue: value };
  }
}

function readCreate(raw, today, missingFields, problems) {
  const kind = KINDS.includes(raw.kind) ? raw.kind : 'consumer';
  const name = text(raw.name, 120);
  if (!name) missingFields.push('name');
  const principalMinor = readAmount(raw.principalMinor, problems);
  if (principalMinor === undefined) missingFields.push('principal');
  const informal = kind === 'informal';
  const { rate, rateValue, missing, needsConvention } = informal ? { rate: ZERO_RATE, rateValue: 0 } : readRate(raw.rate, kind, problems);
  if (missing) missingFields.push('rate');
  const n = isPositiveInteger(raw.n) ? raw.n : null;
  if (!informal && n === null) missingFields.push('term');
  return {
    needsConvention: needsConvention === true,
    create: {
      kind,
      name,
      lender: text(raw.lender, 120),
      principalMinor: principalMinor ?? null,
      rate,
      rateValue,
      n,
      periodicity: hasKey(PERIODICITIES, raw.periodicity) ? raw.periodicity : 'monthly',
      system: informal ? 'none' : SYSTEMS.includes(raw.system) ? raw.system : 'french',
      firstDueOn: isIsoDate(raw.firstDueOn) ? raw.firstDueOn : null,
      charges: readCharges(raw.charges),
      openedOn: today,
    },
  };
}

const isDay = (value) => Number.isInteger(value) && value >= 1 && value <= 31;

function readDay(value, problems) {
  if (value === null || value === undefined) return null;
  if (isDay(value)) return value;
  if (!problems.includes('invalid_day')) problems.push('invalid_day');
  return null;
}

const readPercent = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null);

// The presets the user mentioned (S5): an absent key was not mentioned, `null` is an amount that was not given (the advisor asks for it),
// and a number is the amount. The model sends `true` for «mentioned without an amount»; an IVA without a percentage is the default 19.
function readPresets(raw, problems) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const presets = {};
  for (const key of ['fee', 'insurance']) {
    if (input[key] === true) presets[key] = null;
    else {
      const amount = readAmount(input[key], problems);
      if (amount !== undefined) presets[key] = amount;
    }
  }
  if (input.life === true) presets.life = null;
  else if (input.life !== null && input.life !== undefined) {
    const pct = typeof input.life === 'number' && input.life > 0 ? readPercent(input.life) : null;
    if (pct === null) problems.push(typeof input.life === 'number' && input.life < 0 ? 'negative_amount' : 'invalid_amount');
    else presets.life = pct;
  }
  if (input.iva === true) presets.iva = DEFAULT_IVA;
  else if (input.iva !== null && input.iva !== undefined) {
    const pct = typeof input.iva === 'number' && input.iva > 0 ? readPercent(input.iva) : null;
    if (pct === null) problems.push('invalid_amount');
    else presets.iva = pct;
  }
  if (input.ivaIncluded === true) presets.ivaIncluded = true;
  if (input.gmf === true) presets.gmf = true;
  return Object.fromEntries(['fee', 'iva', 'ivaIncluded', 'life', 'insurance', 'gmf'].filter((key) => hasKey(presets, key)).map((key) => [key, presets[key]]));
}

// Charges that are not presets, as the model described them: no ids yet, and a `pctOfCharge` names its target by label (`refLabel`).
// The code resolves the label against the charges of the case (`addExplicitCharge`), so a dangling reference is caught there.
function readSetupCharges(raw) {
  const charges = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const value = item && item.value;
    const valid = item
      && [...CHARGE_BASES, 'pctOfCharge'].includes(item.basis)
      && typeof value === 'number' && Number.isFinite(value) && value >= 0
      && (item.basis !== 'fixed' || Number.isSafeInteger(value));
    if (valid && charges.length < MAX_CHARGES) {
      charges.push({
        kind: CHARGE_KINDS.includes(item.kind) ? item.kind : 'other',
        label: text(item.label, 40) || `Cargo ${charges.length + 1}`,
        basis: item.basis,
        value,
        cadence: CHARGE_CADENCES.includes(item.cadence) ? item.cadence : 'per_installment',
        ...(item.basis === 'pctOfCharge' ? { refLabel: text(item.refLabel, 40) } : {}),
      });
    }
  }
  return charges;
}

// A described debt (S5): `setup`, or `create` of a card. Nothing here is defaulted: a statement day, a due day or a minimum rule the user did
// not say stays null so the advisor asks for it. The card limit is never read: a stated limit is only the mention `card_limit`.
function readSetup(raw, today, problems) {
  const kind = KINDS.includes(raw.kind) ? raw.kind : 'consumer';
  const block = raw.setup && typeof raw.setup === 'object' ? raw.setup : {};
  const cardInput = block.card && typeof block.card === 'object' ? block.card : {};
  const card = kind === 'card';
  const informal = kind === 'informal';
  const { rate, rateValue, needsConvention } = informal ? { rate: ZERO_RATE, rateValue: 0 } : readRate(raw.rate, kind, problems);
  const principalMinor = readAmount(raw.principalMinor, problems);
  const floorMinor = readAmount(cardInput.minFloorMinor, problems);
  const scheduled = !card && !informal;
  return {
    needsConvention: needsConvention === true,
    setup: {
      kind,
      name: text(raw.name, 120),
      lender: text(raw.lender, 120),
      principalMinor: principalMinor === undefined ? (card ? 0 : null) : principalMinor,
      openedOn: today,
      rate: rate ?? null,
      rateValue: rateValue ?? null,
      n: scheduled && isPositiveInteger(raw.n) ? raw.n : null,
      periodicity: hasKey(PERIODICITIES, raw.periodicity) ? raw.periodicity : null,
      system: card || informal ? 'none' : SYSTEMS.includes(raw.system) ? raw.system : null,
      firstDueOn: isIsoDate(raw.firstDueOn) ? raw.firstDueOn : null,
      card: {
        statementDay: readDay(cardInput.statementDay, problems),
        dueDay: readDay(cardInput.dueDay, problems),
        minRule: MIN_RULES.includes(cardInput.minRule) || cardInput.minRule === 'unknown' ? cardInput.minRule : null,
        minPct: readPercent(cardInput.minPct),
        minFloorMinor: floorMinor === undefined ? null : floorMinor,
      },
      presets: readPresets(block.presets, problems),
      charges: readSetupCharges(block.charges),
      lateStated: LATE_STATED.includes(block.lateStated) ? block.lateStated : null,
      mentions: MENTIONS.filter((mention) => Array.isArray(block.mentions) && block.mentions.includes(mention)),
    },
  };
}

// The mora policy of a late_policy request (F2). The mode names are the core's (`LATE_MODES`); the field is `late.mode`, apart from the keep_term/keep_installment `planChange.mode`.
// A fixed rate with no stated convention stays in `rateValue` until the buttons answer it, like the rate of a rate change. Nothing here trusts the model.
function readLatePolicy(raw, { today }, missingFields, problems) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const effectiveOn = isIsoDate(input.effectiveOn) ? input.effectiveOn : today;
  const graceDays = input.graceDays === null || input.graceDays === undefined ? 0 : input.graceDays;
  const late = LATE_MODES.includes(input.mode) ? { mode: input.mode, graceDays } : { graceDays };
  let rateValue;
  let needsConvention = false;
  if (!LATE_MODES.includes(input.mode)) {
    missingFields.push('late_mode');
  } else if (input.mode === 'fixed') {
    const stated = Boolean(input.rate) && typeof input.rate.value === 'number' && Number.isFinite(input.rate.value);
    if (!stated) missingFields.push('late_rate');
    else {
      const read = readRate(input.rate, 'other', problems);
      needsConvention = read.needsConvention === true;
      if (needsConvention) rateValue = read.rateValue;
      else if (read.rate) late.rate = read.rate;
    }
  } else if (input.mode === 'contract_multiple') {
    if (input.multiple === null || input.multiple === undefined) missingFields.push('late_multiple');
    else if (typeof input.multiple === 'number' && input.multiple > 0 && input.multiple <= MAX_LATE_MULTIPLE) late.multiple = input.multiple;
    else problems.push('late_invalid_multiple');
  }
  if (!Number.isInteger(graceDays) || graceDays < 0 || graceDays > MAX_LATE_GRACE_DAYS) problems.push('late_invalid_grace');
  else if (missingFields.length === 0 && problems.length === 0 && !needsConvention) {
    try {
      normalizeLate(late);
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      problems.push('late_invalid');
    }
  }
  return { needsConvention, latePolicy: { effectiveOn, late, ...(rateValue === undefined ? {} : { rateValue }) } };
}

// The explain request (S0): the closed topic (an unknown or missing one means no topic, so Nia shows the menu and never
// guesses), the rate the user stated for the example, and an optional amount. The debt selector is the common `debtRef`.
// A stated rate without its convention is kept as a bare `rateValue`; nothing is ever defaulted.
function readExplain(input, problems) {
  const topic = EXPLAIN_TOPICS.includes(input.topic) ? input.topic : null;
  const stated = Boolean(input.rate) && typeof input.rate.value === 'number' && Number.isFinite(input.rate.value);
  const { rate, rateValue } = stated ? readRate(input.rate, 'other', problems) : {};
  const amountMinor = readAmount(input.amountMinor, problems);
  return { topic, stated: rate ?? null, rateValue: rateValue ?? null, amountMinor: amountMinor ?? null };
}

/**
 * Turns the model's JSON into a validated request. Nothing here trusts the model:
 * `missingFields` lists what the user did not say, `problems` what is invalid
 * (negative or fractional amounts, future dates, impossible rates) and must be corrected.
 * @param {object | null} raw
 * @param {{ today: string }} options `today` as `YYYY-MM-DD` in the household time zone.
 */
export function normaliseDebtExtraction(raw, { today }) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const missingFields = [];
  const problems = [];
  const action = ACTIONS.includes(input.action) ? input.action : Number.isFinite(input.amountMinor) ? 'pay' : 'list';
  const result = {
    action,
    debtRef: text(input.debtRef, 120) || null,
    amountMinor: null,
    paidOn: isIsoDate(input.paidOn) ? input.paidOn : today,
    strategy: STRATEGIES.includes(input.strategy) ? input.strategy : null,
    extraMinor: null,
    needsConvention: false,
    create: null,
    legalRate: null,
    planChange: null,
    latePolicy: null,
    explain: null,
    setup: null,
    missingFields,
    problems,
  };
  if (action === 'pay') {
    const amountMinor = readAmount(input.amountMinor, problems);
    if (amountMinor === undefined) missingFields.push('amount');
    result.amountMinor = amountMinor ?? null;
    if (result.paidOn > today) problems.push('future_date');
  } else if (action === 'simulate' || action === 'advise') {
    // The extra amount may arrive as extraMinor or, like a payment, as amountMinor.
    const given = [input.extraMinor, input.amountMinor].find(isPositiveInteger);
    result.extraMinor = given === undefined ? null : given;
  } else if (action === 'setup' || (action === 'create' && input.kind === 'card')) {
    Object.assign(result, readSetup(input, today, problems));
  } else if (action === 'create') {
    Object.assign(result, readCreate(input, today, missingFields, problems));
  } else if (action === 'legal_rate') {
    const legal = readLegalRate(input.legal, { today });
    result.legalRate = legal.legalRate;
    missingFields.push(...legal.missingFields);
    problems.push(...legal.problems);
  } else if (action === 'rate_change') {
    const { rate, rateValue, missing, needsConvention } = readRate(input.rate, 'other', problems);
    if (missing) missingFields.push('rate');
    result.needsConvention = needsConvention === true;
    result.planChange = { ...readPlanChange(input.planChange, { today }), rate, rateValue };
  } else if (action === 'charge_change') {
    // An add names presets (read here with the amount rules of `setup`) or explicit fields; `readChargeChange` asks for what is missing.
    const rawChange = input.planChange && typeof input.planChange === 'object' ? input.planChange : {};
    const presets = rawChange.op === 'add' ? readPresets(rawChange.presets, problems) : {};
    const { missing, problems: found, ...planChange } = readChargeChange(input.planChange, { today, presets });
    missingFields.push(...missing);
    problems.push(...found);
    result.planChange = planChange;
  } else if (action === 'late_policy') {
    Object.assign(result, readLatePolicy(input.late, { today }, missingFields, problems));
  } else if (action === 'explain') {
    result.explain = readExplain(input, problems);
  } else if (action === 'restructure') {
    const stated = Boolean(input.rate) && typeof input.rate.value === 'number' && Number.isFinite(input.rate.value);
    const { rate, rateValue, needsConvention } = stated ? readRate(input.rate, 'other', problems) : {};
    result.needsConvention = needsConvention === true;
    const plan = readRestructure(input.planChange, { today });
    if (plan.n === null) missingFields.push('term');
    const charges = readCharges(input.charges);
    result.planChange = { ...plan, ...(stated ? { rate, rateValue } : {}), ...(charges.length > 0 ? { charges } : {}) };
  }
  return result;
}
