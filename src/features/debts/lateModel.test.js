import { describe, expect, it } from 'vitest';
import { defaultLateDraft, lateDraftOf, lateFromDraft, lateIssueOf } from './lateModel';

const fixedDraft = (patch = {}) => ({ ...defaultLateDraft('consumer'), mode: 'fixed', rate: { value: '36', basis: 'effective', periodicity: 'annual', timing: 'arrears' }, ...patch });

describe('defaultLateDraft', () => {
  it('presets usury for bank kinds and none for family, informal and other', () => {
    for (const kind of ['consumer', 'vehicle', 'libranza', 'leasing', 'mortgage', 'card']) expect(defaultLateDraft(kind).mode).toBe('usury');
    for (const kind of ['family', 'informal', 'other']) expect(defaultLateDraft(kind).mode).toBe('none');
  });

  it('starts with no grace days, an empty EA rate and an empty multiple', () => {
    expect(defaultLateDraft('consumer')).toEqual({
      mode: 'usury', graceDays: '0', multiple: '', rate: { value: '', basis: 'effective', periodicity: 'annual', timing: 'arrears' },
    });
  });
});

describe('lateDraftOf', () => {
  it('shows an absent policy as none', () => {
    expect(lateDraftOf(undefined)).toMatchObject({ mode: 'none', graceDays: '0' });
  });

  it('turns a stored policy into the strings the inputs hold', () => {
    const rate = { value: 3, basis: 'nominal', periodicity: 'monthly', timing: 'arrears' };
    expect(lateDraftOf({ mode: 'fixed', rate, graceDays: 5 })).toMatchObject({ mode: 'fixed', rate: { value: '3', basis: 'nominal' }, graceDays: '5' });
    expect(lateDraftOf({ mode: 'contract_multiple', multiple: 1.5, graceDays: 0 })).toMatchObject({ mode: 'contract_multiple', multiple: '1.5' });
  });
});

describe('lateFromDraft', () => {
  it('keeps only the field the mode uses', () => {
    expect(lateFromDraft({ ...fixedDraft(), mode: 'usury', multiple: '2' })).toEqual({ mode: 'usury', graceDays: 0 });
    expect(lateFromDraft(fixedDraft({ graceDays: '3' }))).toEqual({ mode: 'fixed', graceDays: 3, rate: { value: 36, basis: 'effective', periodicity: 'annual', timing: 'arrears' } });
    expect(lateFromDraft({ ...defaultLateDraft('consumer'), mode: 'contract_multiple', multiple: '1.5' })).toEqual({ mode: 'contract_multiple', graceDays: 0, multiple: 1.5 });
  });

  it('treats a blank grace as zero and leaves a blank rate or multiple as NaN for the core to reject', () => {
    expect(lateFromDraft(fixedDraft({ graceDays: '' })).graceDays).toBe(0);
    expect(lateFromDraft(fixedDraft({ rate: { ...fixedDraft().rate, value: '' } })).rate.value).toBeNaN();
    expect(lateFromDraft({ ...defaultLateDraft('consumer'), mode: 'contract_multiple' }).multiple).toBeNaN();
  });
});

describe('lateIssueOf', () => {
  it('accepts every valid policy', () => {
    expect(lateIssueOf(defaultLateDraft('consumer'))).toBeNull();
    expect(lateIssueOf(defaultLateDraft('family'))).toBeNull();
    expect(lateIssueOf(fixedDraft())).toBeNull();
    expect(lateIssueOf({ ...defaultLateDraft('consumer'), mode: 'contract_multiple', multiple: '3' })).toBeNull();
  });

  it('ignores grace days while the mode is none, because the field is hidden', () => {
    expect(lateIssueOf({ ...defaultLateDraft('family'), graceDays: '120' })).toBeNull();
    expect(lateIssueOf({ ...defaultLateDraft('consumer'), graceDays: '120' }).message).toBe('Los días de gracia deben ser un número entero de 0 a 90.');
  });

  it('asks for the rate of a fixed policy as a missing field', () => {
    expect(lateIssueOf(fixedDraft({ rate: { ...fixedDraft().rate, value: '' } }))).toEqual({ message: 'Escribe la tasa de la mora.', missing: true });
  });

  it('explains a rate that is not above zero, a multiple out of range and bad grace days', () => {
    expect(lateIssueOf(fixedDraft({ rate: { ...fixedDraft().rate, value: '0' } })).message).toBe('La tasa de la mora debe ser mayor que cero.');
    const multiple = (value) => lateIssueOf({ ...defaultLateDraft('consumer'), mode: 'contract_multiple', multiple: value });
    expect(multiple('').message).toBe('Escribe el múltiplo de la tasa del contrato.');
    expect(multiple('').missing).toBe(true);
    expect(multiple('0').message).toBe('El múltiplo debe ser mayor que 0 y de hasta 3 veces la tasa del contrato.');
    expect(multiple('3.5').message).toBe('El múltiplo debe ser mayor que 0 y de hasta 3 veces la tasa del contrato.');
    expect(lateIssueOf({ ...defaultLateDraft('consumer'), graceDays: '91' }).message).toBe('Los días de gracia deben ser un número entero de 0 a 90.');
    expect(lateIssueOf({ ...defaultLateDraft('consumer'), graceDays: '2.5' }).message).toBe('Los días de gracia deben ser un número entero de 0 a 90.');
  });
});
