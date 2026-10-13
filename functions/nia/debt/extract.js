import { PERIODICITIES, isIsoDate, normalizeRate } from '../../../packages/finance-core/index.js';

// The second, specialised Gemini call (AD10): the model only EXTRACTS what the
// user said. Validation, arithmetic and every decision happen in code (NDA-1).
// Pure and Node 16 safe.

export const ACTIONS = ['create', 'pay', 'simulate', 'advise', 'list'];
export const STRATEGIES = ['reduce_term', 'reduce_installment', 'advance_installments'];
export const MAX_CHARGES = 6;

const KINDS = ['consumer', 'vehicle', 'libranza', 'mortgage', 'leasing', 'family', 'informal', 'card', 'other'];
const SYSTEMS = ['french', 'german', 'bullet', 'interest_only'];
const CHARGE_KINDS = ['insurance', 'fee', 'tax', 'other'];
const CHARGE_BASES = ['fixed', 'pctOutstanding', 'pctOriginal', 'pctOfSubtotal'];
const INTEREST_FREE_KINDS = ['family', 'informal'];
const ZERO_RATE = { value: 0, basis: 'effective', periodicity: 'annual', timing: 'arrears' };

const SCHEMA = '{"action":"create|pay|simulate|advise|list","debtRef":"string|null","kind":"consumer|vehicle|libranza|mortgage|leasing|family|informal|card|other|null","name":"string|null","lender":"string|null","principalMinor":number|null,"rate":{"value":number|null,"period":"annual|monthly|bimonthly|quarterly|semiannual|weekly|biweekly|null","compounding":"effective|nominal|null","timing":"arrears|advance|null","rawText":"string|null"}|null,"n":number|null,"periodicity":"monthly|biweekly|weekly|bimonthly|quarterly|semiannual|annual|null","system":"french|german|bullet|interest_only|null","firstDueOn":"YYYY-MM-DD|null","amountMinor":number|null,"paidOn":"YYYY-MM-DD|null","strategy":"reduce_term|reduce_installment|advance_installments|null","extraMinor":number|null,"charges":[{"kind":"insurance|fee|tax|other","label":"string","basis":"fixed|pctOutstanding|pctOriginal|pctOfSubtotal","value":number}],"missingFields":["string"]}';

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
    'action: create para registrar una deuda nueva, pay para un pago o abono, simulate para simular un abono extra, advise para pedir una recomendación y list para ver las deudas.',
    'debtRef es el nombre, entidad o tipo de la deuda tal como lo dijo el usuario; usa null si no menciona ninguna.',
    'En rate copia lo que dijo el usuario: value, period (de cuánto es la tasa), compounding (effective si es efectiva o periódica como “2,1% mensual”, nominal si dice nominal) y timing (arrears si es vencida, advance si es anticipada). Si no lo dijo, usa null; nunca lo supongas.',
    'Nunca inventes una fecha: usa null si no la dijo. Si falta un dato necesario, añade su nombre en missingFields.',
    'Devuelve únicamente JSON válido, sin markdown, con exactamente estas claves:',
    SCHEMA,
    debts.length ? `Deudas registradas:\n${debts.map(debtLine).join('\n')}` : 'No hay deudas registradas.',
    history && history.length ? `Contexto reciente del chat:\n${conversationLines(history)}` : 'Sin contexto anterior.',
    `Nuevo mensaje del usuario:\n${text}`,
  ].join('\n\n');
}

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
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
    missingFields,
    problems,
  };
  if (action === 'pay') {
    const amountMinor = readAmount(input.amountMinor, problems);
    if (amountMinor === undefined) missingFields.push('amount');
    result.amountMinor = amountMinor ?? null;
    if (result.paidOn > today) problems.push('future_date');
  } else if (action === 'simulate') {
    result.extraMinor = isPositiveInteger(input.extraMinor) ? input.extraMinor : null;
  } else if (action === 'create') {
    Object.assign(result, readCreate(input, today, missingFields, problems));
  }
  return result;
}
