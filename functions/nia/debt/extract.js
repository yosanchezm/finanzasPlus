import { LATE_MODES, PERIODICITIES, ValidationError, isIsoDate, normalizeLate, normalizeRate } from '../../../packages/finance-core/index.js';
import { readLegalRate } from './legal.js';
import { SYSTEMS, readChargeChange, readPlanChange, readRestructure } from './planChange.js';

// The second, specialised Gemini call (AD10): the model only EXTRACTS what the
// user said. Validation, arithmetic and every decision happen in code (NDA-1).
// Pure and Node 16 safe.

export const ACTIONS = ['create', 'pay', 'simulate', 'advise', 'list', 'legal_rate', 'rate_change', 'charge_change', 'restructure', 'late_policy'];
export const STRATEGIES = ['reduce_term', 'reduce_installment', 'advance_installments'];
export const MAX_CHARGES = 6;

const KINDS = ['consumer', 'vehicle', 'libranza', 'mortgage', 'leasing', 'family', 'informal', 'card', 'other'];
const CHARGE_KINDS = ['insurance', 'fee', 'tax', 'other'];
const CHARGE_BASES = ['fixed', 'pctOutstanding', 'pctOriginal', 'pctOfSubtotal'];
const INTEREST_FREE_KINDS = ['family', 'informal'];
const ZERO_RATE = { value: 0, basis: 'effective', periodicity: 'annual', timing: 'arrears' };

const SCHEMA = '{"action":"create|pay|simulate|advise|list|legal_rate|rate_change|charge_change|restructure|late_policy","debtRef":"string|null","kind":"consumer|vehicle|libranza|mortgage|leasing|family|informal|card|other|null","name":"string|null","lender":"string|null","principalMinor":number|null,"rate":{"value":number|null,"period":"annual|monthly|bimonthly|quarterly|semiannual|weekly|biweekly|null","compounding":"effective|nominal|null","timing":"arrears|advance|null","rawText":"string|null"}|null,"n":number|null,"periodicity":"monthly|biweekly|weekly|bimonthly|quarterly|semiannual|annual|null","system":"french|german|bullet|interest_only|null","firstDueOn":"YYYY-MM-DD|null","amountMinor":number|null,"paidOn":"YYYY-MM-DD|null","strategy":"reduce_term|reduce_installment|advance_installments|null","extraMinor":number|null,"charges":[{"kind":"insurance|fee|tax|other","label":"string","basis":"fixed|pctOutstanding|pctOriginal|pctOfSubtotal","value":number}],"legal":{"kind":"usury|ibc|smmlv|null","modality":"string|null","month":"string|number|null","year":number|null,"value":number|null}|null,"planChange":{"effectiveOn":"YYYY-MM-DD|null","mode":"keep_term|keep_installment|null","chargeRef":"string|null","op":"set|remove|add|null","newValue":number|null,"n":number|null,"system":"french|german|bullet|interest_only|null","periodicity":"monthly|biweekly|weekly|bimonthly|quarterly|semiannual|annual|null","firstDueOn":"YYYY-MM-DD|null","waiveLate":boolean|null}|null,"late":{"mode":"none|usury|fixed|contract_multiple|null","rate":{"value":number|null,"period":"annual|monthly|bimonthly|quarterly|semiannual|weekly|biweekly|null","compounding":"effective|nominal|null","timing":"arrears|advance|null","rawText":"string|null"}|null,"multiple":number|null,"graceDays":number|null,"effectiveOn":"YYYY-MM-DD|null"}|null,"missingFields":["string"]}';

const conversationLines = (history) => (history || [])
  .map((item) => `${item.role === 'assistant' ? 'Nia' : 'Usuario'}: ${item.content}`)
  .join('\n');

const debtLine = (debt) => `- ${debt.name} (tipo ${debt.kind}${debt.lender ? `, entidad ${debt.lender}` : ''})`;

/**
 * Prompt of the debt extraction call.
 * @param {string} text The user's message.
 * @param {object[]} debts Existing `debts` rows (names help the model choose `debtRef`).
 * @param {{ role: string, content: string }[]} history Recent chat turns.
 * @param {{ today: string, timezone?: string, currency?: string }} options
 */
export function debtPrompt(text, debts, history, { today, timezone = 'America/Bogota', currency = 'COP' } = {}) {
  return [
    'Eres Nia. Extrae los datos de una solicitud sobre deudas (préstamos y tarjetas) de un hogar. Solo extraes: no calcules cuotas, saldos, intereses ni equivalencias de tasa; el sistema lo hace.',
    `La fecha de hoy en ${timezone} es ${today}. La moneda es ${currency}; los montos son enteros en pesos, no centavos.`,
    'action: create para registrar una deuda nueva, pay para un pago o abono, simulate para simular un abono extra, advise para pedir una recomendación y list para ver las deudas. legal_rate registra una tasa legal: la usura, el IBC o el salario mínimo (SMMLV) de un mes o año, por ejemplo “la usura de noviembre es 28.2”. rate_change cambia la tasa de una deuda que ya existe, por ejemplo “bajó la tasa del crédito a 22% EA desde hoy”. charge_change cambia el valor de un seguro o cargo que una deuda ya tiene, o lo quita, por ejemplo “quita el seguro de vida del crédito”; también se usa cuando piden agregar uno nuevo. restructure reestructura una deuda que ya existe: rehace el plan de cuotas con el saldo actual y lo vencido, por ejemplo “reestructura el crédito a 48 cuotas, primera cuota el 2026-12-05”.',
    'late_policy configura la mora (intereses por cuotas vencidas) de una deuda que ya existe, por ejemplo “activa mora a la usura en el crédito del banco” o “quita la mora del préstamo a mi hermano”. En late: mode es usury si la mora va a la tasa máxima legal (usura), fixed si da una tasa fija propia (esa tasa va en late.rate, igual que rate al crear), contract_multiple si es un múltiplo de la tasa del contrato (late.multiple, por ejemplo 1.5 veces), none si no quiere mora; graceDays son los días de gracia que dijo (null si no dijo) y effectiveOn la fecha desde la que rige, tal como la dijo, o null si no la dijo. Si no es una política de mora, late es null.',
    'debtRef es el nombre, entidad o tipo de la deuda tal como lo dijo el usuario; usa null si no menciona ninguna.',
    'En rate copia lo que dijo el usuario: value, period (de cuánto es la tasa), compounding (effective si es efectiva o periódica como “2,1% mensual”, nominal si dice nominal) y timing (arrears si es vencida, advance si es anticipada). Si no lo dijo, usa null; nunca lo supongas.',
    'En legal copia lo que dijo el usuario: kind (usury, ibc o smmlv), modality como la nombró (consumo, hipotecario, productivo rural…) o null, month tal como lo escribió (por ejemplo “noviembre”; no conviertas el mes a número ni le pongas año), year solo si lo dijo, y value (el porcentaje tal cual, 28.2; para el salario mínimo, pesos enteros). Si no es una tasa legal, legal es null.',
    'En planChange, para rate_change: la nueva tasa va en rate (igual que al crear); effectiveOn es la fecha desde la que rige el cambio, tal como la dijo, o null si no la dijo; mode es keep_term si quiere mantener el plazo (la cuota se recalcula), keep_installment si quiere mantener la cuota (el plazo se recalcula) y null si no lo dijo. Para charge_change: chargeRef es el nombre del seguro o cargo tal como lo dijo (por ejemplo “seguro de vida”), op es set para cambiar su valor, remove para quitarlo y add para agregar uno nuevo, y newValue el valor nuevo (pesos enteros si es un monto fijo; el porcentaje tal cual si es un porcentaje); usa null en lo que no dijo. Para restructure: n es el número de cuotas del plan nuevo, system y periodicity solo si los cambia, firstDueOn la fecha de la primera cuota tal como la dijo, waiveLate true solo si pide condonar o perdonar los intereses de mora, y la tasa nueva, si la dice, va en rate; charges solo si dice cuáles seguros o cargos tendrá el plan nuevo (reemplazan los actuales). Si no es un cambio de plan, planChange es null.',
    'Nunca inventes una fecha: usa null si no la dijo. Si falta un dato necesario, añade su nombre en missingFields.',
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
  if (kind === 'card') problems.push('card_in_web');
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
    const { missing, problems: found, ...planChange } = readChargeChange(input.planChange, { today });
    missingFields.push(...missing);
    problems.push(...found);
    result.planChange = planChange;
  } else if (action === 'late_policy') {
    Object.assign(result, readLatePolicy(input.late, { today }, missingFields, problems));
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
