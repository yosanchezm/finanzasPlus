// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { evaluateCharges } from '../src/charges.js';
import { CHARGE_PRESET_SPECS, addExplicitCharge, addPresetCharge, presetCharges } from '../src/chargePresets.js';
import { ValidationError } from '../src/errors.js';
import { normalizeCharges } from '../src/terms.js';

const ctx = (overrides = {}) => ({ period: 1, openingMinor: 0, installmentMinor: 0, originalMinor: 0, periodsPerYear: 12, unit: 1, ...overrides });
const amounts = (charges, context) => Object.fromEntries(evaluateCharges(charges, ctx(context)).lines.map((line) => [line.id, line.amountMinor]));
const codeOf = (run) => {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return error.code;
  }
  return null;
};

describe('CHARGE_PRESET_SPECS', () => {
  it('fixes kind, basis, label and cadence of the five presets, in evaluation order', () => {
    expect(Object.keys(CHARGE_PRESET_SPECS)).toEqual(['life', 'insurance', 'fee', 'iva', 'gmf']);
    expect(CHARGE_PRESET_SPECS.life).toEqual({ kind: 'insurance', basis: 'pctOutstanding', cadence: 'per_installment', label: 'Seguro de vida' });
    expect(CHARGE_PRESET_SPECS.insurance).toEqual({ kind: 'insurance', basis: 'fixed', cadence: 'per_installment', label: 'Otro seguro' });
    expect(CHARGE_PRESET_SPECS.fee).toEqual({ kind: 'fee', basis: 'fixed', cadence: 'per_installment', label: 'Comisión o cuota de manejo' });
    expect(CHARGE_PRESET_SPECS.iva).toEqual({ kind: 'tax', basis: 'pctOfCharge', cadence: 'per_installment', label: 'IVA sobre la comisión', refId: 'fee', requires: 'fee', defaultValue: 19 });
    expect(CHARGE_PRESET_SPECS.gmf).toEqual({ kind: 'tax', basis: 'pctOfSubtotal', cadence: 'per_installment', label: 'GMF (4 x 1000)', defaultValue: 0.4 });
  });

  it('is frozen, so no caller can change a preset', () => {
    expect(Object.isFrozen(CHARGE_PRESET_SPECS)).toBe(true);
    expect(Object.isFrozen(CHARGE_PRESET_SPECS.iva)).toBe(true);
  });
});

describe('presetCharges', () => {
  it('links the IVA to the fee as pctOfCharge 19, and 45,000 gives 8,550', () => {
    const charges = presetCharges({ fee: 45_000, iva: 19 });
    expect(charges.map((charge) => charge.id)).toEqual(['fee', 'iva']);
    expect(charges[1]).toMatchObject({ basis: 'pctOfCharge', refId: 'fee', value: 19, kind: 'tax' });
    expect(amounts(charges)).toEqual({ fee: 45_000, iva: 8550 });
  });

  it('keeps the stored card ids and the label «Cuota de manejo» with {card:true}', () => {
    const charges = presetCharges({ fee: 45_000, iva: 19 }, { card: true });
    expect(charges.map((charge) => [charge.id, charge.label, charge.refId])).toEqual([['mgmt_fee', 'Cuota de manejo', undefined], ['mgmt_iva', 'IVA', 'mgmt_fee']]);
    expect(amounts(charges)).toEqual({ mgmt_fee: 45_000, mgmt_iva: 8550 });
  });

  it('uses the default of a preset for true and never invents an amount', () => {
    expect(presetCharges({ fee: 10_000, iva: true, gmf: true }).map((charge) => charge.value)).toEqual([10_000, 19, 0.4]);
    expect(codeOf(() => presetCharges({ life: null }))).toBe('preset_amount_missing');
    expect(codeOf(() => presetCharges({ insurance: true }))).toBe('preset_amount_missing');
    expect(codeOf(() => presetCharges({ fee: undefined, life: undefined }))).toBeNull();
  });

  it('orders the presets by evaluation order whatever the order of the keys', () => {
    const charges = presetCharges({ gmf: true, iva: 19, fee: 1000, life: 0.05 });
    expect(charges.map((charge) => charge.id)).toEqual(['life', 'fee', 'iva', 'gmf']);
  });

  it('refuses an IVA without a fee', () => {
    expect(codeOf(() => presetCharges({ iva: 19 }))).toBe('preset_requires_fee');
    expect(codeOf(() => presetCharges({ iva: 19 }, { card: true }))).toBe('preset_requires_fee');
  });

  it('charges GMF 0.4% on a base of 400,000: 1,600', () => {
    const charges = presetCharges({ gmf: true });
    expect(amounts(charges, { installmentMinor: 400_000 })).toEqual({ gmf: 1600 });
  });

  it('returns charges that the core accepts again unchanged', () => {
    const charges = presetCharges({ fee: 45_000, iva: 19, life: 0.05, insurance: 12_000, gmf: true });
    expect(normalizeCharges(charges)).toEqual(charges);
  });

  it('lets the core judge a fractional fixed amount', () => {
    expect(codeOf(() => presetCharges({ fee: 1000.5 }))).toBe('invalid_charge');
  });
});

describe('addPresetCharge', () => {
  const base = () => presetCharges({ fee: 45_000 });

  it('adds a preset to an existing set and keeps the others', () => {
    const next = addPresetCharge(presetCharges({ life: 0.05 }), 'insurance', 12_000);
    expect(next.map((charge) => charge.id)).toEqual(['life', 'insurance']);
  });

  it('links the IVA to the single existing fee, whatever its id', () => {
    const charges = addPresetCharge(base(), 'iva', 19);
    expect(charges[1]).toMatchObject({ id: 'iva', basis: 'pctOfCharge', refId: 'fee', value: 19 });
    const card = addPresetCharge(presetCharges({ fee: 45_000 }, { card: true }), 'iva', true, { card: true });
    expect(card[1]).toMatchObject({ id: 'mgmt_iva', refId: 'mgmt_fee', value: 19 });
    const stored = normalizeCharges([{ id: 'c1', kind: 'fee', label: 'Comisión del banco', basis: 'fixed', value: 30_000 }]);
    expect(addPresetCharge(stored, 'iva', 19)[1]).toMatchObject({ refId: 'c1' });
    expect(amounts(addPresetCharge(stored, 'iva', 19))).toEqual({ c1: 30_000, iva: 5700 });
  });

  it('throws preset_exists for a preset that is already there, by id, by label or by shape', () => {
    expect(codeOf(() => addPresetCharge(base(), 'fee', 10_000))).toBe('preset_exists');
    const withIva = addPresetCharge(base(), 'iva', 19);
    expect(codeOf(() => addPresetCharge(withIva, 'iva', 19))).toBe('preset_exists');
    const labelled = normalizeCharges([{ id: 'x1', kind: 'insurance', label: 'seguro de vida', basis: 'pctOutstanding', value: 0.05 }]);
    expect(codeOf(() => addPresetCharge(labelled, 'life', 0.1))).toBe('preset_exists');
    expect(codeOf(() => addPresetCharge(presetCharges({ gmf: true }), 'gmf', 0.4))).toBe('preset_exists');
  });

  it('throws preset_requires_fee when there is no fee, and refuses to guess between two fees', () => {
    expect(codeOf(() => addPresetCharge([], 'iva', 19))).toBe('preset_requires_fee');
    const two = normalizeCharges([
      { id: 'f1', kind: 'fee', label: 'Comisión A', basis: 'fixed', value: 1000 },
      { id: 'f2', kind: 'fee', label: 'Comisión B', basis: 'fixed', value: 2000 },
    ]);
    expect(codeOf(() => addPresetCharge(two, 'iva', 19))).toBe('charge_ref_ambiguous');
  });

  it('refuses an unknown preset and a missing amount', () => {
    expect(codeOf(() => addPresetCharge([], 'hipoteca', 1))).toBe('unknown_preset');
    expect(codeOf(() => addPresetCharge([], 'life', null))).toBe('preset_amount_missing');
  });

  it('does not touch the set it receives', () => {
    const charges = Object.freeze(base().map((charge) => Object.freeze(charge)));
    expect(addPresetCharge(charges, 'iva', 19)).toHaveLength(2);
    expect(charges).toHaveLength(1);
  });
});

describe('addExplicitCharge', () => {
  const fee = () => presetCharges({ fee: 45_000 }, { card: true });

  it('adds a charge with explicit fields and a cadence that defaults to per_installment', () => {
    const next = addExplicitCharge([], { kind: 'insurance', label: 'Seguro de desempleo', basis: 'fixed', value: 8000 });
    expect(next).toEqual([expect.objectContaining({ kind: 'insurance', label: 'Seguro de desempleo', basis: 'fixed', value: 8000, cadence: 'per_installment' })]);
    const annual = addExplicitCharge([], { kind: 'fee', label: 'Anualidad', basis: 'fixed', value: 90_000, cadence: 'annual' });
    expect(annual[0].cadence).toBe('annual');
  });

  it('gives a new unique id even when an id is already taken', () => {
    const first = addExplicitCharge([], { kind: 'fee', label: 'A', basis: 'fixed', value: 1 });
    const second = addExplicitCharge(first, { kind: 'fee', label: 'B', basis: 'fixed', value: 2 });
    expect(new Set(second.map((charge) => charge.id)).size).toBe(2);
  });

  it('resolves refLabel by folded label for a pctOfCharge charge', () => {
    const next = addExplicitCharge(fee(), { kind: 'tax', label: 'IVA', basis: 'pctOfCharge', value: 19, refLabel: 'CUOTA DE MANEJO' });
    expect(next[1]).toMatchObject({ basis: 'pctOfCharge', refId: 'mgmt_fee' });
    const accented = addExplicitCharge(presetCharges({ insurance: 12_000 }), { kind: 'tax', label: 'IVA', basis: 'pctOfCharge', value: 19, refLabel: 'otro seguro' });
    expect(accented[1].refId).toBe('insurance');
    expect(amounts(next)).toEqual({ mgmt_fee: 45_000, c1: 8550 });
  });

  it('throws charge_ref_unknown for a dangling or missing refLabel', () => {
    expect(codeOf(() => addExplicitCharge([], { kind: 'tax', label: 'IVA', basis: 'pctOfCharge', value: 19, refLabel: 'cuota de manejo' }))).toBe('charge_ref_unknown');
    expect(codeOf(() => addExplicitCharge(fee(), { kind: 'tax', label: 'IVA', basis: 'pctOfCharge', value: 19 }))).toBe('charge_ref_unknown');
    expect(codeOf(() => addExplicitCharge(fee(), { kind: 'tax', label: 'IVA', basis: 'pctOfCharge', value: 19, refLabel: 'otra' }))).toBe('charge_ref_unknown');
  });

  it('never invents a missing value', () => {
    expect(codeOf(() => addExplicitCharge([], { kind: 'fee', label: 'A', basis: 'fixed' }))).toBe('charge_value_missing');
    expect(codeOf(() => addExplicitCharge([], { kind: 'fee', label: 'A', basis: 'fixed', value: null }))).toBe('charge_value_missing');
  });

  it('validates the whole resulting set through the core', () => {
    expect(codeOf(() => addExplicitCharge([], { kind: 'fee', label: 'A', basis: 'weird', value: 1 }))).toBe('invalid_charge');
    expect(codeOf(() => addExplicitCharge([], { kind: 'fee', label: 'A', basis: 'fixed', value: 10.5 }))).toBe('invalid_charge');
  });
});
