import { LEGAL_MODALITIES, legalValueInRange, usuryFromIbcBp } from '../../../packages/finance-core/index.js';
import { fold } from './findDebt.js';
import { pesos } from './format.js';

// The `legal_rate` action (NI1, NI6): the model only copies the phrase and the value the user said; the month,
// the year, the modality and every range check are decided here, in code. Pure and Node 16 safe.

const KINDS = ['usury', 'ibc', 'smmlv'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MODALITY_LABELS = {
  consumer: 'consumo y ordinario',
  low_amount: 'consumo de bajo monto',
  productive: 'productivo',
  productive_rural: 'productivo rural',
  productive_urban: 'productivo urbano',
  popular_rural: 'popular rural',
  popular_urban: 'popular urbano',
  mortgage: 'hipotecario',
};
const KIND_TITLES = { usury: 'Tasa de usura (tope)', ibc: 'IBC (interés bancario corriente)', smmlv: 'Salario mínimo (SMMLV)' };
const KIND_PHRASES = { usury: 'la tasa de usura', ibc: 'el IBC', smmlv: 'el salario mínimo' };
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;
const MONTHS_AHEAD = 6; // a month without a year is the one within this many months ahead of today, else the past one
const pad2 = (value) => String(value).padStart(2, '0');
const isBlank = (value) => value === null || value === undefined || (typeof value === 'string' && value.trim() === '');

function yearOf(value) {
  const year = typeof value === 'string' && /^\d{4}$/.test(value.trim()) ? Number(value.trim()) : value;
  return Number.isInteger(year) && year >= MIN_YEAR && year <= MAX_YEAR ? year : null;
}

function monthNumber(text) {
  const name = fold(text);
  if (name.length < 3) return null;
  const index = MONTHS.findIndex((month) => month.startsWith(name));
  return index < 0 ? null : index + 1;
}

/**
 * Resolves what the user said about a month into a calendar month. Without a year, the year is the one that puts
 * the month within 6 months of today (an exact tie goes to the past: a cap is certified before it is typed in).
 * @param {(string | number | null)} month A Spanish name or abbreviation, `1`-`12`, or `YYYY-MM`.
 * @param {(number | string | null)} year An explicit year, if the user gave one.
 * @param {string} today `YYYY-MM-DD` in the household time zone.
 * @returns {{ year: number, month: number } | null} `null` when it is not a month or the year is not a sane one.
 */
export function resolveMonth(month, year, today) {
  let number = null;
  let given = isBlank(year) ? null : yearOf(year);
  if (!isBlank(year) && given === null) return null;
  if (typeof month === 'number') {
    number = month;
  } else if (typeof month === 'string') {
    const iso = /^(\d{4})-(\d{1,2})$/.exec(month.trim());
    if (iso) {
      number = Number(iso[2]);
      if (given === null) given = yearOf(Number(iso[1]));
      if (given === null) return null;
    } else {
      number = /^\d{1,2}$/.test(month.trim()) ? Number(month.trim()) : monthNumber(month);
    }
  }
  if (!Number.isInteger(number) || number < 1 || number > 12) return null;
  if (given !== null) return { year: given, month: number };
  const todayYear = Number(today.slice(0, 4));
  const todayMonth = Number(today.slice(5, 7));
  const ahead = (number - todayMonth + 12) % 12;
  const index = todayYear * 12 + (todayMonth - 1) + (ahead < MONTHS_AHEAD ? ahead : ahead - 12);
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

function modalityFrom(text) {
  const name = fold(text).replace(/_/g, ' ');
  if (name === '') return 'consumer';
  const canonical = LEGAL_MODALITIES.find((modality) => modality.replace(/_/g, ' ') === name);
  if (canonical) return canonical;
  const rural = /\brural/.test(name);
  const urban = /\burban/.test(name);
  if (/hipotec|vivienda|mortgage/.test(name)) return 'mortgage';
  if (/bajo monto/.test(name)) return 'low_amount';
  if (/popular/.test(name)) return rural ? 'popular_rural' : urban ? 'popular_urban' : null;
  if (/productiv/.test(name)) return rural ? 'productive_rural' : urban ? 'productive_urban' : 'productive';
  if (/consumo|ordinari|consumer/.test(name)) return 'consumer';
  return null;
}

// Percent as the user said it (`28.2`, or `"28,2"`) to a number; anything else is NaN (refused later).
function percentOf(value) {
  if (typeof value === 'number') return value;
  const text = typeof value === 'string' ? value.trim().replace(',', '.') : '';
  return /^\d+(\.\d+)?$/.test(text) ? Number(text) : Number.NaN;
}

// Basis points of a percent with at most two decimals, or null when it is not one or is out of range.
function basisPoints(kind, percent) {
  const scaled = percent * 100;
  const rounded = Math.round(scaled);
  return Number.isFinite(scaled) && Math.abs(scaled - rounded) < 1e-6 && legalValueInRange(kind, rounded) ? rounded : null;
}

const lastDayOf = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * Turns the model's `legal{kind, modality, month, year, value}` into a draft row, or says what is missing / invalid.
 * `ibc` and `usury` values arrive as the percent the user said (28.2) and are stored as basis points (2820); `smmlv`
 * arrives and is stored in whole pesos. A mortgage cap is never derived from an IBC, so that needs an explicit usury.
 * @param {(object | null)} raw
 * @param {{ today: string }} options
 * @returns {{ legalRate: ({ kind: string, modality: string, validFrom: string, validTo: string, value: number } | null), missingFields: string[], problems: string[] }}
 */
export function readLegalRate(raw, { today }) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const kind = typeof input.kind === 'string' && KINDS.includes(fold(input.kind)) ? fold(input.kind) : null;
  const missingFields = [];
  const problems = [];
  const fail = () => ({ legalRate: null, missingFields, problems });
  if (kind === null) missingFields.push('legal_kind');
  if (isBlank(input.value)) missingFields.push('legal_value');
  if (kind === null || isBlank(input.value)) return fail();

  if (kind === 'smmlv') {
    const year = isBlank(input.year) ? Number(today.slice(0, 4)) : yearOf(input.year);
    if (!legalValueInRange(kind, input.value)) problems.push('legal_smmlv_out_of_range');
    if (year === null) problems.push('legal_invalid_month');
    if (problems.length) return fail();
    return { legalRate: { kind, modality: 'all', validFrom: `${year}-01-01`, validTo: `${year}-12-31`, value: input.value }, missingFields, problems };
  }

  const modality = modalityFrom(input.modality);
  if (modality === null) problems.push('legal_unknown_modality');
  else if (kind === 'ibc' && modality === 'mortgage') problems.push('legal_mortgage_needs_usury');
  const value = basisPoints(kind, percentOf(input.value));
  if (value === null) problems.push('legal_value_out_of_range');
  const period = isBlank(input.month) ? null : resolveMonth(input.month, input.year, today);
  if (isBlank(input.month)) missingFields.push('legal_month');
  else if (period === null) problems.push('legal_invalid_month');
  if (problems.length || missingFields.length) return fail();
  const month = pad2(period.month);
  return {
    legalRate: { kind, modality, validFrom: `${period.year}-${month}-01`, validTo: `${period.year}-${month}-${pad2(lastDayOf(period.year, period.month))}`, value },
    missingFields,
    problems,
  };
}

const percentText = (basisPointsValue) => `${(basisPointsValue / 100).toFixed(2)}% E.A.`;
const monthText = (legalRate) => `${MONTHS[Number(legalRate.validFrom.slice(5, 7)) - 1]} de ${legalRate.validFrom.slice(0, 4)}`;
const valueText = (legalRate) => (legalRate.kind === 'smmlv' ? pesos(legalRate.value) : percentText(legalRate.value));

/** The draft as one phrase for a confirmation: "la tasa de usura (consumo y ordinario) de noviembre de 2026: 28.20% E.A." */
export function describeLegalRate(legalRate) {
  if (legalRate.kind === 'smmlv') return `${KIND_PHRASES.smmlv} de ${legalRate.validFrom.slice(0, 4)}: ${valueText(legalRate)}`;
  return `${KIND_PHRASES[legalRate.kind]} (${MODALITY_LABELS[legalRate.modality]}) de ${monthText(legalRate)}: ${valueText(legalRate)}`;
}

/**
 * Whether a draft can be written as it is: a known kind and modality, a value in range and the whole period (a month,
 * or a year for the SMMLV). Confirm re-checks this because a pending comes back from the session, not from the reader.
 * @param {(object | null)} legalRate
 * @returns {boolean}
 */
export function isStorableLegalRate(legalRate) {
  if (!legalRate || typeof legalRate !== 'object') return false;
  const { kind, modality, validFrom, validTo, value } = legalRate;
  if (!legalValueInRange(kind, value) || typeof validFrom !== 'string' || typeof validTo !== 'string') return false;
  if (kind === 'smmlv') return modality === 'all' && /^\d{4}-01-01$/.test(validFrom) && validTo === `${validFrom.slice(0, 4)}-12-31`;
  if (!LEGAL_MODALITIES.includes(modality) || (kind === 'ibc' && modality === 'mortgage')) return false;
  const [, year, month] = /^(\d{4})-(\d{2})-01$/.exec(validFrom) || [];
  return year !== undefined && Number(month) >= 1 && Number(month) <= 12 && validTo === `${year}-${month}-${pad2(lastDayOf(Number(year), Number(month)))}`;
}

/**
 * The preview of a legal rate: it echoes kind, modality, month and value, and for an IBC the usury cap it implies
 * (IBC x 1.5, half up; never for a mortgage). Nothing is written until the user confirms.
 * @param {{ kind: string, modality: string, validFrom: string, validTo: string, value: number }} legalRate
 * @returns {string}
 */
export function previewLegalRate(legalRate) {
  const lines = ['📌 Tasa legal', `Tipo: ${KIND_TITLES[legalRate.kind]}`];
  if (legalRate.kind === 'smmlv') lines.push(`Año: ${legalRate.validFrom.slice(0, 4)}`);
  else lines.push(`Modalidad: ${MODALITY_LABELS[legalRate.modality]}`, `Mes: ${monthText(legalRate)}`);
  lines.push(`Valor: ${valueText(legalRate)}`);
  if (legalRate.kind === 'ibc' && legalRate.modality !== 'mortgage') lines.push(`Tope de usura que resulta: ${percentText(usuryFromIbcBp(legalRate.value))} (IBC × 1,5)`);
  lines.push('', 'Vista previa: no se guarda hasta que confirmes.');
  return lines.join('\n');
}
