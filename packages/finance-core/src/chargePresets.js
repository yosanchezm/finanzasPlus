import { ValidationError } from './errors.js';
import { normalizeCharges } from './terms.js';

// Charge presets: the management fee with its IVA, life insurance, other insurance and GMF 4x1000. One builder for the web wizard
// and for Nia, so the IVA `pctOfCharge` link is built the same way everywhere. Pure and Node 16 safe.
//
// A preset fixes label, kind, basis and cadence and never invents an amount: a missing amount is an error the caller turns into a
// question. `iva` links to the fee (`refId`/`requires`) and defaults to 19; `gmf` defaults to 0.4.

const spec = (fields) => Object.freeze({ ...fields });

/** The five presets, in the evaluation order of the core (the IVA after its fee, GMF last). */
export const CHARGE_PRESET_SPECS = Object.freeze({
  life: spec({ kind: 'insurance', basis: 'pctOutstanding', cadence: 'per_installment', label: 'Seguro de vida' }),
  insurance: spec({ kind: 'insurance', basis: 'fixed', cadence: 'per_installment', label: 'Otro seguro' }),
  fee: spec({ kind: 'fee', basis: 'fixed', cadence: 'per_installment', label: 'Comisión o cuota de manejo' }),
  iva: spec({ kind: 'tax', basis: 'pctOfCharge', cadence: 'per_installment', label: 'IVA sobre la comisión', refId: 'fee', requires: 'fee', defaultValue: 19 }),
  gmf: spec({ kind: 'tax', basis: 'pctOfSubtotal', cadence: 'per_installment', label: 'GMF (4 x 1000)', defaultValue: 0.4 }),
});

const KEYS = Object.keys(CHARGE_PRESET_SPECS);
// A card keeps the ids and labels the web wizard has always stored for its management fee.
const CARD_IDS = { fee: 'mgmt_fee', iva: 'mgmt_iva' };
const CARD_LABELS = { fee: 'Cuota de manejo', iva: 'IVA' };

const fail = (code, message) => new ValidationError(code, message);
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

const fold = (text) => String(text).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
const idOf = (key, card) => (card && has(CARD_IDS, key) ? CARD_IDS[key] : key);
const labelOf = (key, card) => (card && has(CARD_LABELS, key) ? CARD_LABELS[key] : CHARGE_PRESET_SPECS[key].label);

function requireKey(key) {
  if (!has(CHARGE_PRESET_SPECS, key)) throw fail('unknown_preset', `unknown charge preset: ${String(key)}`);
  return CHARGE_PRESET_SPECS[key];
}

// `true` asks for the default of the preset; a missing amount (null or undefined) is never invented.
function amountOf(key, value) {
  const { defaultValue } = CHARGE_PRESET_SPECS[key];
  if (value === true && defaultValue !== undefined) return defaultValue;
  if (value === null || value === undefined || value === true) throw fail('preset_amount_missing', `the ${key} preset needs an amount`);
  return value;
}

function presetCharge(key, value, card, refId) {
  const { kind, basis, cadence } = CHARGE_PRESET_SPECS[key];
  return { id: idOf(key, card), kind, label: labelOf(key, card), basis, cadence, value: amountOf(key, value), ...(refId ? { refId } : {}) };
}

/**
 * The charges of the selected presets, validated by the core.
 * @param {Record<string, (number | true | null | undefined)>} selected Amount per preset key: pesos (fixed) or a percentage; `true` is the default of the preset; `undefined` or `false` means not selected; `null` is a missing amount.
 * @param {{ card?: boolean }} [options] `card`: ids `mgmt_fee`/`mgmt_iva` and the labels «Cuota de manejo»/«IVA».
 * @returns {object[]} Normalized charges in evaluation order.
 * @throws {ValidationError} `preset_amount_missing`, `preset_requires_fee`, `invalid_charge`
 */
export function presetCharges(selected, { card = false } = {}) {
  const chosen = KEYS.filter((key) => has(selected, key) && selected[key] !== undefined && selected[key] !== false);
  const charges = [];
  for (const key of chosen) {
    const { requires } = CHARGE_PRESET_SPECS[key];
    if (requires && !chosen.includes(requires)) throw fail('preset_requires_fee', `the ${key} preset needs the ${requires} preset`);
    charges.push(presetCharge(key, selected[key], card, requires ? idOf(requires, card) : undefined));
  }
  return normalizeCharges(charges);
}

const sameShape = (charge, preset) => charge.kind === preset.kind && charge.basis === preset.basis;

function exists(charges, key, card, feeId) {
  const preset = CHARGE_PRESET_SPECS[key];
  if (charges.some((charge) => charge.id === idOf(key, card) || fold(charge.label) === fold(labelOf(key, card)))) return true;
  if (key === 'iva') return charges.some((charge) => charge.basis === 'pctOfCharge' && charge.refId === feeId);
  return key !== 'insurance' && charges.some((charge) => sameShape(charge, preset));
}

function singleFee(charges) {
  const fees = charges.filter((charge) => charge.kind === 'fee' && charge.basis !== 'pctOfCharge');
  if (fees.length === 0) throw fail('preset_requires_fee', 'the IVA preset needs a fee to link to');
  if (fees.length > 1) throw fail('charge_ref_ambiguous', 'there is more than one fee: say which one the IVA applies to');
  return fees[0];
}

/**
 * Adds one preset to a charge set. The IVA links to the single fee already in the set, whatever its id.
 * @param {object[]} charges Normalized charges in force.
 * @param {string} key A preset key.
 * @param {(number | true | null | undefined)} value See `presetCharges`.
 * @param {{ card?: boolean }} [options]
 * @returns {object[]} A new, validated set.
 * @throws {ValidationError} `unknown_preset`, `preset_exists`, `preset_requires_fee`, `charge_ref_ambiguous`, `preset_amount_missing`, `invalid_charge`
 */
export function addPresetCharge(charges, key, value, { card = false } = {}) {
  const preset = requireKey(key);
  const fee = preset.requires ? singleFee(charges) : null;
  if (exists(charges, key, card, fee && fee.id)) throw fail('preset_exists', `the ${key} preset is already in the charges`);
  return normalizeCharges([...charges, presetCharge(key, value, card, fee ? fee.id : undefined)]);
}

function freshId(charges) {
  let n = 1;
  while (charges.some((charge) => charge.id === `c${n}`)) n += 1;
  return `c${n}`;
}

function refIdOf(charges, refLabel) {
  const wanted = typeof refLabel === 'string' ? fold(refLabel) : '';
  const found = wanted === '' ? [] : charges.filter((charge) => fold(charge.label) === wanted);
  if (found.length === 0) throw fail('charge_ref_unknown', `no charge is called "${String(refLabel)}"`);
  if (found.length > 1) throw fail('charge_ref_ambiguous', `more than one charge is called "${String(refLabel)}"`);
  return found[0].id;
}

/**
 * Adds a charge described field by field. A `pctOfCharge` charge names the charge it applies to by label (`refLabel`), matched ignoring
 * case and accents.
 * @param {object[]} charges Normalized charges in force.
 * @param {{ kind: string, label: string, basis: string, value: number, cadence?: string, refLabel?: string }} fields
 * @returns {object[]} A new, validated set.
 * @throws {ValidationError} `charge_value_missing`, `charge_ref_unknown`, `charge_ref_ambiguous`, `invalid_charge`
 */
export function addExplicitCharge(charges, { kind, label, basis, value, cadence = 'per_installment', refLabel } = {}) {
  if (value === null || value === undefined) throw fail('charge_value_missing', 'a charge needs its value');
  const charge = { id: freshId(charges), kind, label, basis, cadence, value };
  if (basis === 'pctOfCharge') charge.refId = refIdOf(charges, refLabel);
  return normalizeCharges([...charges, charge]);
}
