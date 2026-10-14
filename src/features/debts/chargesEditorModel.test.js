import { normalizeCharges } from '@finance-core';
import { describe, expect, it } from 'vitest';
import {
  addCustom, addPreset, availablePresets, dependentsOf, draftsFromCharges, issueOf, patchDraft, referenceOptions, removeDraft, validateCharges,
} from './chargesEditorModel';

// The real charges of the spec's loan: a fixed fee, the IVA on that fee and a life insurance on the outstanding balance.
const CHARGES = normalizeCharges([
  { id: 'fee', kind: 'fee', label: 'Comisión', basis: 'fixed', value: 10000, cadence: 'per_installment' },
  { id: 'iva', kind: 'tax', label: 'IVA sobre la comisión', basis: 'pctOfCharge', refId: 'fee', value: 19, cadence: 'per_installment' },
  { id: 'life', kind: 'insurance', label: 'Seguro de vida', basis: 'pctOutstanding', value: 0.05, cadence: 'per_installment' },
]);
const rows = () => draftsFromCharges(CHARGES);
const valid = (drafts) => validateCharges(drafts);

describe('draftsFromCharges', () => {
  it('holds every field as the string its input shows: comma decimals, empty periods for "no limit"', () => {
    const [fee, iva, life] = rows();

    expect(fee).toMatchObject({ id: 'fee', kind: 'fee', label: 'Comisión', basis: 'fixed', value: '10000', cadence: 'per_installment', fromPeriod: '1', toPeriod: '', refId: '' });
    expect(iva).toMatchObject({ id: 'iva', basis: 'pctOfCharge', refId: 'fee', value: '19' });
    expect(life).toMatchObject({ id: 'life', basis: 'pctOutstanding', value: '0,05' });
  });

  it('returns the very same real charges when nothing was edited, including the periods, the cadence and the base', () => {
    const original = normalizeCharges([
      ...CHARGES,
      { id: 'annual', kind: 'insurance', label: 'Seguro anual', basis: 'fixed', value: 120000, cadence: 'annual', fromPeriod: 3, toPeriod: 24 },
      { id: 'base', kind: 'fee', label: 'Aval', basis: 'pctOfBase', baseMinor: 2000000, value: 1.5, display: 'bundled' },
    ]);

    const result = valid(draftsFromCharges(original));

    expect(result.ok).toBe(true);
    expect(result.charges).toEqual(original);
    expect(result.charges[3]).toMatchObject({ cadence: 'annual', fromPeriod: 3, toPeriod: 24 });
    expect(result.charges[4]).toMatchObject({ basis: 'pctOfBase', baseMinor: 2000000, display: 'bundled' });
  });
});

describe('validateCharges values', () => {
  it('turns a fixed fee of 10,000 into 12,000 and keeps every other field untouched', () => {
    const edited = patchDraft(rows(), 'fee', { value: '12000' });

    const { ok, charges } = valid(edited);

    expect(ok).toBe(true);
    expect(charges[0]).toEqual({ ...CHARGES[0], value: 12000 });
    expect(charges.slice(1)).toEqual(CHARGES.slice(1));
  });

  it('parses percentages with a comma or a dot decimal into the exact number typed, with no float drift', () => {
    const percentOf = (text) => valid(patchDraft(rows(), 'life', { value: text })).charges?.[2].value;

    expect(percentOf('0,07')).toBe(0.07);
    expect(percentOf('0.07')).toBe(0.07);
    expect(percentOf('1,1')).toBe(1.1);
    expect(percentOf(' 0,4 % ')).toBe(0.4);
    expect(percentOf('19')).toBe(19);
    expect(percentOf('0,0001')).toBe(0.0001);
  });

  it('accepts whole pesos with thousand dots and rejects decimals or text in a fixed value', () => {
    const feeOf = (text) => valid(patchDraft(rows(), 'fee', { value: text }));

    expect(feeOf('1.250.000').charges[0].value).toBe(1250000);
    expect(feeOf('$ 9.500').charges[0].value).toBe(9500);
    for (const bad of ['', '12,5', '1.5', 'abc', '-5']) {
      const result = feeOf(bad);
      expect(result.ok).toBe(false);
      expect(result.charges).toBeNull();
      expect(issueOf(result.issues, 'fee', 'value')).toMatch(/pesos/);
    }
  });

  it('rejects an empty, negative, over-precise or over-100 percentage, naming the field', () => {
    for (const bad of ['', '-1', 'x', '1,23456', '100,5']) {
      const result = valid(patchDraft(rows(), 'life', { value: bad }));
      expect(result.ok).toBe(false);
      expect(issueOf(result.issues, 'life', 'value')).toMatch(/porcentaje/);
    }
    expect(valid(patchDraft(rows(), 'life', { value: '0' })).ok).toBe(true); // a zero charge is legal
  });

  it('asks for a name', () => {
    const result = valid(patchDraft(rows(), 'life', { label: '   ' }));

    expect(result.ok).toBe(false);
    expect(issueOf(result.issues, 'life', 'label')).toBe('Escribe un nombre.');
  });

  it('keeps the periods apart from the amounts and checks 1 <= from <= to', () => {
    const limited = valid(patchDraft(patchDraft(rows(), 'life', { fromPeriod: '3' }), 'life', { toPeriod: '12' }));
    expect(limited.charges[2]).toMatchObject({ fromPeriod: 3, toPeriod: 12 });

    expect(issueOf(valid(patchDraft(rows(), 'life', { fromPeriod: '0' })).issues, 'life', 'fromPeriod')).toMatch(/cuota/);
    expect(issueOf(valid(patchDraft(rows(), 'life', { fromPeriod: 'x' })).issues, 'life', 'fromPeriod')).toMatch(/cuota/);
    const reversed = valid(patchDraft(patchDraft(rows(), 'life', { fromPeriod: '6' }), 'life', { toPeriod: '4' }));
    expect(reversed.ok).toBe(false);
    expect(issueOf(reversed.issues, 'life', 'toPeriod')).toMatch(/no puede ser anterior/);
  });
});

describe('pctOfCharge references', () => {
  it('rejects an IVA whose fee is gone, with a message naming the IVA', () => {
    const dangling = rows().filter((row) => row.id !== 'fee');

    const result = valid(dangling);

    expect(result.ok).toBe(false);
    expect(result.charges).toBeNull();
    expect(issueOf(result.issues, 'iva', 'refId')).toBe('«IVA sobre la comisión» necesita un cargo anterior como base. Elige uno o quítalo.');
  });

  it('rejects a reference to a later charge, to itself or to a charge calculated on the subtotal', () => {
    const later = [rows()[1], rows()[0]]; // IVA listed before its fee
    expect(issueOf(valid(later).issues, 'iva', 'refId')).toMatch(/necesita un cargo anterior/);

    const onSubtotal = patchDraft(rows(), 'fee', { basis: 'pctOfSubtotal', value: '0,4' });
    expect(valid(onSubtotal).ok).toBe(false);
    expect(issueOf(valid(onSubtotal).issues, 'iva', 'refId')).toMatch(/necesita un cargo anterior/);
  });

  it('flags a new "% de otro cargo" row until a base is picked', () => {
    const added = patchDraft(addCustom([]), 'extra', { basis: 'pctOfCharge', label: 'Impuesto', value: '5' });

    expect(issueOf(valid(added).issues, 'extra', 'refId')).toMatch(/necesita un cargo anterior/);
  });

  it('lists as base options only the earlier charges that are not calculated on the subtotal', () => {
    const list = [...addPreset(rows(), 'gmf'), ...addPreset([], 'insurance')]; // fee, iva, life, gmf (subtotal), insurance

    expect(referenceOptions(list, 'iva').map((row) => row.id)).toEqual(['fee']);
    expect(referenceOptions(list, 'life').map((row) => row.id)).toEqual(['fee', 'iva']);
    expect(referenceOptions(list, 'fee')).toEqual([]);
    expect(referenceOptions(list, 'insurance').map((row) => row.id)).toEqual(['fee', 'iva', 'life']); // gmf is on the subtotal: never a base
  });

  it('picks the first base when a row becomes "% de otro cargo" and clears it when it stops being one', () => {
    const asReference = patchDraft(rows(), 'life', { basis: 'pctOfCharge' });
    expect(asReference[2]).toMatchObject({ basis: 'pctOfCharge', refId: 'fee' });
    expect(valid(asReference).ok).toBe(true);

    const back = patchDraft(asReference, 'life', { basis: 'pctOutstanding' });
    expect(back[2].refId).toBe('');
    expect(valid(back).charges[2]).not.toHaveProperty('refId');
  });
});

describe('removal and its dependents', () => {
  it('lists the IVA when the fee goes, and removes both', () => {
    const list = rows();

    expect(dependentsOf(list, 'fee').map((row) => row.label)).toEqual(['IVA sobre la comisión']);
    expect(removeDraft(list, 'fee').map((row) => row.id)).toEqual(['life']);
  });

  it('follows the chain: a charge on the IVA goes with the fee too', () => {
    const chained = [...rows(), { ...rows()[1], id: 'tax2', label: 'Impuesto sobre el IVA', refId: 'iva' }];

    expect(dependentsOf(chained, 'fee').map((row) => row.id)).toEqual(['iva', 'tax2']);
    expect(removeDraft(chained, 'iva').map((row) => row.id)).toEqual(['fee', 'life']);
  });

  it('lists nothing for a charge nobody references, and nothing for an unknown id', () => {
    expect(dependentsOf(rows(), 'life')).toEqual([]);
    expect(removeDraft(rows(), 'life').map((row) => row.id)).toEqual(['fee', 'iva']);
    expect(dependentsOf(rows(), 'nope')).toEqual([]);
    expect(removeDraft(rows(), 'nope')).toHaveLength(3);
  });
});

describe('presets and custom charges', () => {
  it('offers every wizard preset on an empty set except the IVA, which needs a fee first', () => {
    expect(availablePresets([]).map((preset) => preset.key)).toEqual(['life', 'insurance', 'fee', 'gmf']);
  });

  it('drops a preset once added and offers the IVA when there is a fee to charge it on', () => {
    const withFee = addPreset([], 'fee');
    expect(availablePresets(withFee).map((preset) => preset.key)).toEqual(['life', 'insurance', 'iva', 'gmf']);

    const withIva = addPreset(withFee, 'iva');
    expect(withIva.map((row) => row.id)).toEqual(['fee', 'iva']);
    expect(withIva[1]).toMatchObject({ kind: 'tax', basis: 'pctOfCharge', refId: 'fee', value: '19', label: 'IVA sobre la comisión' });
    expect(availablePresets(withIva).map((preset) => preset.key)).toEqual(['life', 'insurance', 'gmf']);
  });

  it('starts the fixed presets empty and the tax presets on their usual value', () => {
    expect(addPreset([], 'insurance')[0]).toMatchObject({ id: 'insurance', basis: 'fixed', value: '', cadence: 'per_installment', fromPeriod: '1', toPeriod: '' });
    expect(addPreset([], 'gmf')[0]).toMatchObject({ basis: 'pctOfSubtotal', value: '0,4' });
    expect(valid(addPreset([], 'gmf')).charges).toEqual(normalizeCharges([{ id: 'gmf', kind: 'tax', label: 'GMF (4 x 1000)', basis: 'pctOfSubtotal', value: 0.4 }]));
  });

  it('puts the IVA on the fee the debt already has, whatever its id (a card names it mgmt_fee)', () => {
    const card = draftsFromCharges(normalizeCharges([{ id: 'mgmt_fee', kind: 'fee', label: 'Cuota de manejo', basis: 'fixed', value: 9000 }]));

    const withIva = addPreset(card, 'iva');

    expect(withIva[1]).toMatchObject({ id: 'iva', refId: 'mgmt_fee' });
    expect(valid(withIva).ok).toBe(true);
  });

  it('hides the IVA preset when the fee already has one, even under another id', () => {
    const card = draftsFromCharges(normalizeCharges([
      { id: 'mgmt_fee', kind: 'fee', label: 'Cuota de manejo', basis: 'fixed', value: 9000 },
      { id: 'mgmt_iva', kind: 'tax', label: 'IVA', basis: 'pctOfCharge', refId: 'mgmt_fee', value: 19 },
    ]));

    expect(availablePresets(card).map((preset) => preset.key)).not.toContain('iva');
  });

  it('adds blank custom charges with unique ids', () => {
    const twice = addCustom(addCustom([]));

    expect(twice.map((row) => row.id)).toEqual(['extra', 'extra_2']);
    expect(twice[0]).toMatchObject({ kind: 'other', basis: 'fixed', label: '', value: '', cadence: 'per_installment' });
    const result = valid(twice);
    expect(result.ok).toBe(false);
    expect(issueOf(result.issues, 'extra_2', 'label')).toBe('Escribe un nombre.');
    expect(issueOf(result.issues, 'extra_2', 'value')).toMatch(/pesos/);
  });
});
