import { ValidationError, normalizeCharges, removeCharge } from '@finance-core';
import { CHARGE_PRESETS } from './wizard/wizardModel';

// Pure model of the charges editor. The editor works on drafts: the real `Charge` fields (kind, label, basis, value,
// cadence, fromPeriod, toPeriod, refId, display, baseMinor) with the numbers held as the strings the inputs show, so a
// percentage such as "0,05" is parsed once, as typed, and never goes through float arithmetic. `validateCharges` turns
// drafts back into real charges and the core `normalizeCharges` has the last word.

export const KIND_OPTIONS = [
  { value: 'insurance', label: 'Seguro' },
  { value: 'fee', label: 'Comisión' },
  { value: 'tax', label: 'Impuesto' },
  { value: 'other', label: 'Otro' },
];
export const CADENCE_OPTIONS = [
  { value: 'per_installment', label: 'En cada cuota' },
  { value: 'annual', label: 'Una vez al año' },
  { value: 'once', label: 'Una sola vez' },
];
const BASIS_OPTIONS = [
  { value: 'fixed', label: 'Valor fijo en pesos' },
  { value: 'pctOutstanding', label: '% del saldo' },
  { value: 'pctOriginal', label: '% del monto original' },
  { value: 'pctOfCharge', label: '% de otro cargo' },
  { value: 'pctOfSubtotal', label: '% de lo que pagas en la cuota' },
];
const BASE_BASIS = { value: 'pctOfBase', label: '% de una base fija' }; // kept when a stored charge already uses it

/** The calculation choices a row offers: the five bases, plus the fixed-base one only for a charge that already has it. */
export const basisOptionsFor = (row) => (row.basis === BASE_BASIS.value ? [...BASIS_OPTIONS, BASE_BASIS] : BASIS_OPTIONS);

const PESOS_MESSAGE = 'Escribe un valor en pesos, sin decimales.';
const PERCENT_MESSAGE = 'Escribe un porcentaje entre 0 y 100, con hasta 4 decimales.';
const FROM_MESSAGE = 'Escribe la cuota desde la que aplica (1 o más).';
const TO_MESSAGE = 'Escribe la última cuota en que aplica (1 o más) o déjala vacía.';
const RANGE_MESSAGE = 'La cuota final no puede ser anterior a la inicial.';
const LABEL_MESSAGE = 'Escribe un nombre.';
const SET_MESSAGE = 'Revisa los cargos: no se pueden guardar así.';
const MAX_PERCENT = 100;

const isPercent = (basis) => basis !== 'fixed';

/** The text an input shows for a stored value: whole pesos as is, percentages with a comma decimal. */
const valueText = (charge) => (charge.basis === 'fixed' ? String(charge.value) : String(charge.value).replace('.', ','));

/** Drafts of the charges in force (normalized charges, as `projection.terms.charges`). */
export const draftsFromCharges = (charges) => charges.map((charge) => ({
  id: charge.id,
  kind: charge.kind,
  label: charge.label ?? charge.id,
  basis: charge.basis,
  value: valueText(charge),
  cadence: charge.cadence ?? 'per_installment',
  fromPeriod: String(charge.fromPeriod ?? 1),
  toPeriod: charge.toPeriod == null ? '' : String(charge.toPeriod),
  refId: charge.refId ?? '',
  display: charge.display ?? 'itemized',
  ...(charge.baseMinor === undefined ? {} : { baseMinor: charge.baseMinor }),
}));

/** Whole pesos from "10000", "10.000", "$ 1.250.000" (a dot only as a thousands separator); null when it is anything else. */
function parsePesos(text) {
  const clean = String(text).replace(/[$\s]/g, '');
  if (/^\d+$/.test(clean)) return Number(clean);
  if (/^\d{1,3}(\.\d{3})+$/.test(clean)) return Number(clean.replace(/\./g, ''));
  return null;
}

/** A percentage from "0,05", "0.05" or "19 %" (up to 4 decimals, 0..100), as the exact number typed; null otherwise. */
function parsePercent(text) {
  const clean = String(text).replace(/[%\s]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,4})?$/.test(clean)) return null;
  const value = Number(clean);
  return value <= MAX_PERCENT ? value : null;
}

const parsePeriod = (text) => (/^\d+$/.test(text) && Number(text) >= 1 ? Number(text) : null);

const nameOf = (row) => row.label.trim() || row.id;

/** The charges a row may be calculated on: the ones listed before it that are not calculated on the subtotal. */
export function referenceOptions(rows, id) {
  const index = rows.findIndex((row) => row.id === id);
  return index < 0 ? [] : rows.slice(0, index).filter((row) => row.basis !== 'pctOfSubtotal');
}

/** First message of a row field in `issues` (see `validateCharges`), or null. */
export const issueOf = (issues, id, field) => issues.find((issue) => issue.id === id && issue.field === field)?.message ?? null;

function validateRow(row, rows) {
  const issues = [];
  const fail = (field, message) => issues.push({ id: row.id, field, message });
  if (row.label.trim() === '') fail('label', LABEL_MESSAGE);
  const value = row.basis === 'fixed' ? parsePesos(row.value) : parsePercent(row.value);
  if (value === null) fail('value', row.basis === 'fixed' ? PESOS_MESSAGE : PERCENT_MESSAGE);
  const from = row.fromPeriod.trim() === '' ? 1 : parsePeriod(row.fromPeriod.trim());
  if (from === null) fail('fromPeriod', FROM_MESSAGE);
  const toText = row.toPeriod.trim();
  const to = toText === '' ? null : parsePeriod(toText);
  if (toText !== '' && to === null) fail('toPeriod', TO_MESSAGE);
  else if (to !== null && from !== null && to < from) fail('toPeriod', RANGE_MESSAGE);
  if (row.basis === 'pctOfCharge' && !referenceOptions(rows, row.id).some((option) => option.id === row.refId)) {
    fail('refId', `«${nameOf(row)}» necesita un cargo anterior como base. Elige uno o quítalo.`);
  }
  return { issues, value, from, to };
}

/**
 * Drafts to real charges. `ok` is false while any row has a problem; `issues` then lists `{ id, field, message }`
 * (fields: label, value, fromPeriod, toPeriod, refId) and `charges` is null. When `ok`, `charges` are the normalized
 * `Charge` objects the `charge_change` event takes. Pure.
 * @param {object[]} rows Drafts (see `draftsFromCharges`).
 * @returns {{ ok: boolean, charges: (object[] | null), issues: Array<{ id: (string | null), field: string, message: string }> }}
 */
export function validateCharges(rows) {
  const issues = [];
  const built = [];
  for (const row of rows) {
    const checked = validateRow(row, rows);
    issues.push(...checked.issues);
    built.push({
      id: row.id,
      kind: row.kind,
      label: row.label.trim(),
      basis: row.basis,
      value: checked.value,
      cadence: row.cadence,
      fromPeriod: checked.from,
      toPeriod: checked.to,
      display: row.display,
      ...(row.basis === 'pctOfCharge' ? { refId: row.refId } : {}),
      ...(row.basis === 'pctOfBase' ? { baseMinor: row.baseMinor } : {}),
    });
  }
  if (issues.length > 0) return { ok: false, charges: null, issues };
  try {
    return { ok: true, charges: normalizeCharges(built), issues };
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return { ok: false, charges: null, issues: [{ id: null, field: 'set', message: SET_MESSAGE }] };
  }
}

/** Edits one row. Changing the calculation resets what depended on the old one: the base charge of a "% de otro cargo". */
export function patchDraft(rows, id, patch) {
  return rows.map((row) => {
    if (row.id !== id) return row;
    const next = { ...row, ...patch };
    if (patch.basis !== undefined && patch.basis !== row.basis) {
      next.refId = patch.basis === 'pctOfCharge' ? (referenceOptions(rows, id)[0]?.id ?? '') : '';
    }
    return next;
  });
}

/** The rows that go with `id` when it is removed: every charge calculated on it, transitively (`removeCharge` of the core). */
export function dependentsOf(rows, id) {
  const kept = new Set(removeCharge(rows, id).map((row) => row.id));
  return rows.filter((row) => row.id !== id && !kept.has(row.id));
}

/** Removes a row together with its dependents. */
export const removeDraft = (rows, id) => removeCharge(rows, id);

function uniqueId(rows, base) {
  const taken = new Set(rows.map((row) => row.id));
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}_${n}`;
  return id;
}

// The fees an IVA preset could be charged on: not calculated on the subtotal and without a charge on them yet.
const taxableFees = (rows) => rows.filter((row) => row.kind === 'fee' && row.basis !== 'pctOfSubtotal'
  && !rows.some((other) => other.basis === 'pctOfCharge' && other.refId === row.id));

/** The wizard presets that can still be added: not present yet, and the IVA only when there is a fee to charge it on. */
export const availablePresets = (rows) => CHARGE_PRESETS.filter((preset) => !rows.some((row) => row.id === preset.key)
  && (!preset.requires || taxableFees(rows).length > 0));

/** Adds a wizard preset (life insurance, other insurance, fee, IVA on the fee, GMF) with its usual value. */
export function addPreset(rows, key) {
  const preset = availablePresets(rows).find((item) => item.key === key);
  if (!preset) return rows;
  const draft = {
    id: preset.key,
    kind: preset.kind,
    label: preset.label,
    basis: preset.basis,
    value: preset.defaultValue === undefined ? '' : String(preset.defaultValue).replace('.', ','),
    cadence: 'per_installment',
    fromPeriod: '1',
    toPeriod: '',
    refId: preset.requires ? taxableFees(rows)[0].id : '',
    display: 'itemized',
  };
  return [...rows, draft];
}

/** Adds a blank charge of the user's own. */
export const addCustom = (rows) => [...rows, {
  id: uniqueId(rows, 'extra'), kind: 'other', label: '', basis: 'fixed', value: '', cadence: 'per_installment', fromPeriod: '1', toPeriod: '', refId: '', display: 'itemized',
}];

/** Unit shown next to a value input. */
export const unitOf = (row) => (isPercent(row.basis) ? '%' : '$');
