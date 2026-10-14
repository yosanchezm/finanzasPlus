import { LEGAL_MODALITIES, capOn, smmlvFor, usuryFromIbcBp } from '@finance-core';
import { formatMoney, formatMonth } from '../../shared/lib/format';

// Accepted values, mirroring the write guard in `upsertLegalRate` (which stays the authority):
// basis points for IBC and usury, whole pesos for the SMMLV.
const BASIS_POINTS = { min: 500, max: 10000 };
const SMMLV_PESOS = { min: 100000, max: 100000000 };

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const YEAR_PATTERN = /^\d{4}$/;
// "19,49", "19.49", "19" or "19,5": at most two decimals, so basis points stay exact integers.
const PERCENT_PATTERN = /^(\d{1,3})(?:[.,](\d{0,2}))?$/;
// "1750905" or grouped thousands with "." or ",": "1.750.905".
const PESOS_PATTERN = /^(?:\d{1,3}(?:[.,]\d{3})+|\d+)$/;

const percentFormat = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "29,24" for 29.24 (es-CO decimals, always two). */
export const formatPercentEA = (percent) => percentFormat.format(percent);

/** "29,24" for 2924 basis points. */
export const formatBpPercent = (bp) => formatPercentEA(bp / 100);

const MODALITY_LABELS = {
  consumer: 'Consumo y ordinario',
  low_amount: 'Consumo de bajo monto',
  productive: 'Productivo',
  productive_rural: 'Productivo rural',
  productive_urban: 'Productivo urbano',
  popular_rural: 'Popular productivo rural',
  popular_urban: 'Popular productivo urbano',
  mortgage: 'Hipotecario',
};

export const modalityLabel = (modality) => MODALITY_LABELS[modality] ?? modality;

/**
 * Basis points from text a Colombian member types ("19,49" or "19.49"), or null when it is not a percentage
 * with at most two decimals. Integer arithmetic only: 1,15 * 100 would be 114.99999999999999 as a float.
 */
export function parsePercentBp(text) {
  const match = PERCENT_PATTERN.exec(String(text ?? '').replace(/%/g, '').trim());
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

/** Whole pesos from "1750905" or "1.750.905" (an optional "$" is ignored), or null. */
export function parsePesos(text) {
  const compact = String(text ?? '').replace(/[$\s]/g, '');
  return PESOS_PATTERN.test(compact) ? Number(compact.replace(/[.,]/g, '')) : null;
}

/** The first and last day of a "YYYY-MM" month. */
export function monthPeriod(month) {
  const [year, number] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return { validFrom: `${month}-01`, validTo: `${month}-${String(last).padStart(2, '0')}` };
}

/** The first and last day of a year. */
export const yearPeriod = (year) => ({ validFrom: `${year}-01-01`, validTo: `${year}-12-31` });

/** True when `month` ("YYYY-MM") is before the month of `today` (ISO date). */
export const isPastMonth = (month, today) => MONTH_PATTERN.test(month ?? '') && month < today.slice(0, 7);

const RATE_FORMAT_ERROR = 'Escribe la tasa como porcentaje, por ejemplo 19,49.';
const RATE_RANGE_ERROR = `La tasa debe estar entre ${formatBpPercent(BASIS_POINTS.min)} % y ${formatBpPercent(BASIS_POINTS.max)} % E.A.`;
const SMMLV_RANGE_ERROR = `El salario mínimo debe estar entre ${formatMoney(SMMLV_PESOS.min)} y ${formatMoney(SMMLV_PESOS.max)}.`;

/**
 * Checks the IBC / usury form. `ok` is false while the value is empty (no message yet) or invalid (with a message in `errors`).
 * For an IBC, `usuryBp` and `usuryLabel` are the derived cap (1.5 x IBC, half up) to echo before saving.
 * @param {{ kind: 'ibc' | 'usury', modality: string, month: string, valueText: string }} draft
 */
export function validateRateDraft({ kind, modality, month, valueText }) {
  const errors = {};
  if (!MONTH_PATTERN.test(month ?? '')) errors.month = 'Elige el mes de la tasa.';
  if (modality === 'mortgage' && kind === 'ibc') errors.kind = 'Para hipotecario escribe la usura: el IBC no la deriva.';
  const text = String(valueText ?? '').trim();
  let valueBp = null;
  if (text !== '') {
    valueBp = parsePercentBp(text);
    if (valueBp === null) errors.value = RATE_FORMAT_ERROR;
    else if (valueBp < BASIS_POINTS.min || valueBp > BASIS_POINTS.max) errors.value = RATE_RANGE_ERROR;
  }
  const ok = text !== '' && Object.keys(errors).length === 0;
  const usuryBp = ok && kind === 'ibc' ? usuryFromIbcBp(valueBp) : null;
  return { ok, errors, valueBp: ok ? valueBp : null, usuryBp, usuryLabel: usuryBp === null ? null : formatBpPercent(usuryBp) };
}

/** Checks the SMMLV form (year plus pesos), with the same `ok` / `errors` contract. */
export function validateSmmlvDraft({ year, valueText }) {
  const errors = {};
  if (!YEAR_PATTERN.test(String(year ?? '').trim())) errors.year = 'Escribe un año de cuatro cifras.';
  const text = String(valueText ?? '').trim();
  let valuePesos = null;
  if (text !== '') {
    valuePesos = parsePesos(text);
    if (valuePesos === null || valuePesos < SMMLV_PESOS.min || valuePesos > SMMLV_PESOS.max) errors.value = SMMLV_RANGE_ERROR;
  }
  const ok = text !== '' && Object.keys(errors).length === 0;
  return { ok, errors, year: errors.year ? null : Number(year), valuePesos: ok ? valuePesos : null };
}

/** The row `upsertLegalRate` stores for a valid IBC / usury draft (the actor is added by the hook). */
export function toRateRow({ kind, modality, month, valueText }, { source = '', verified = false } = {}) {
  return { kind, modality, ...monthPeriod(month), value: parsePercentBp(valueText), source: source.trim(), verified: verified === true };
}

/** The row `upsertLegalRate` stores for a valid SMMLV draft. */
export function toSmmlvRow({ year, valueText }, { source = '', verified = false } = {}) {
  return { kind: 'smmlv', modality: 'all', ...yearPeriod(Number(year)), value: parsePesos(valueText), source: source.trim(), verified: verified === true };
}

const ORIGIN_BADGES = {
  ibc: { tone: 'shared', text: 'Derivada del IBC' },
  override: { tone: 'you', text: 'Usura manual' },
  default: { tone: 'neutral', text: 'Valor de la app' },
};
const UNVERIFIED_BADGE = { tone: 'danger', text: 'Sin verificar' };

const byStartDesc = (a, b) => (a.validFrom < b.validFrom ? 1 : a.validFrom > b.validFrom ? -1 : 0);

function rateRow(entry) {
  const month = entry.validFrom.slice(0, 7);
  const badges = [ORIGIN_BADGES[entry.origin] ?? ORIGIN_BADGES.default];
  if (entry.verified !== true) badges.push(UNVERIFIED_BADGE);
  return { key: `${entry.modality}|${entry.validFrom}`, month, monthLabel: formatMonth(month), capEA: entry.capEA, ibcEA: entry.ibcEA ?? null, origin: entry.origin, source: entry.source ?? '', verified: entry.verified === true, badges };
}

function staleCap(usuryTable, modality, today) {
  const cap = capOn(usuryTable, modality, today);
  if (!cap || !cap.stale) return null;
  const currentMonth = today.slice(0, 7);
  const usingMonth = cap.lastValidTo.slice(0, 7);
  return { currentMonth, currentLabel: formatMonth(currentMonth), capEA: cap.capEA, usingMonth, badge: `Desactualizada: usando la de ${formatMonth(usingMonth)}` };
}

function smmlvView(smmlvTable, today) {
  const rows = [...smmlvTable].sort((a, b) => b.year - a.year).map((entry) => {
    const badges = [];
    if (entry.origin === 'default') badges.push(ORIGIN_BADGES.default);
    if (entry.verified !== true) badges.push(UNVERIFIED_BADGE);
    return { year: entry.year, valueMinor: entry.valueMinor, source: entry.source ?? '', verified: entry.verified === true, origin: entry.origin, badges };
  });
  const currentYear = Number(today.slice(0, 4));
  const found = smmlvFor(smmlvTable, currentYear);
  const using = found?.stale ? rows.find((row) => row.year <= currentYear) : null;
  const stale = using ? { currentYear, usingYear: using.year, valueMinor: found.valueMinor, badge: `Desactualizado: usando el de ${using.year}` } : null;
  return { rows, stale };
}

/**
 * What the panel lists, from the resolved tables: caps grouped by modality (newest month first) with their badges,
 * a stale prompt per modality whose current month has no row, the SMMLV by year and whether a mortgage cap is still missing.
 * @param {{ usuryTable: object[], smmlvTable: object[] }} legal Output of `resolveLegal`.
 * @param {string} today ISO date; decides which month is "current".
 */
export function buildLegalRatesView(legal, today) {
  const byModality = new Map();
  for (const entry of legal.usuryTable) byModality.set(entry.modality, [...(byModality.get(entry.modality) ?? []), entry]);
  const groups = LEGAL_MODALITIES.filter((modality) => byModality.has(modality)).map((modality) => ({
    modality,
    label: modalityLabel(modality),
    rows: byModality.get(modality).sort(byStartDesc).map(rateRow),
    stale: staleCap(legal.usuryTable, modality, today),
  }));
  return { groups, smmlv: smmlvView(legal.smmlvTable, today), mortgageCapMissing: !byModality.has('mortgage') };
}

/** The stored entry (with its `origin`) for a modality and month, so the form can say it will replace it. */
export const existingEntry = (legal, modality, month) => (
  legal.usuryTable.find((entry) => entry.modality === modality && entry.validFrom === `${month}-01`) ?? null
);
