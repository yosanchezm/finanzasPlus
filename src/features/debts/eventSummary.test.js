// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { describeBlockers, summarizeEvent } from './eventSummary';

const EA = (value) => ({ value, basis: 'effective', periodicity: 'annual', timing: 'arrears' });
const event = (kind, effectiveOn, payload = {}) => ({ id: `${kind}1`, kind, effectiveOn, amountMinor: 0, payload });
const charge = (id, label, value = 10000) => ({ id, kind: 'fee', label, basis: 'fixed', value, cadence: 'per_installment' });

describe('summarizeEvent: rate_change', () => {
  it('shows the old and new EA, the date and the mode', () => {
    const rate = event('rate_change', '2026-11-01', { rate: EA(20), mode: 'keep_term' });
    expect(summarizeEvent(rate, { applied: { fromEA: 24, toEA: 20 } })).toBe('Tasa: 24,00 % → 20,00 % E.A. desde 1 nov · mantiene plazo');
    const installment = event('rate_change', '2026-12-01', { rate: EA(30), mode: 'keep_installment' });
    expect(summarizeEvent(installment, { applied: { fromEA: 20, toEA: 30.456 } })).toBe('Tasa: 20,00 % → 30,46 % E.A. desde 1 dic · mantiene cuota');
  });

  it('falls back to the EA of the payload when the projection has no entry for the event', () => {
    const rate = event('rate_change', '2026-11-01', { rate: { convention: 'MV', value: 2 }, mode: 'keep_term' });
    expect(summarizeEvent(rate)).toBe('Tasa: 26,82 % E.A. desde 1 nov · mantiene plazo');
  });

  it('leaves the mode out for a card, which has none', () => {
    const rate = event('rate_change', '2026-05-01', { rate: EA(35), mode: 'keep_term' });
    expect(summarizeEvent(rate, { applied: { fromEA: 28, toEA: 35 }, card: true })).toBe('Tasa: 28,00 % → 35,00 % E.A. desde 1 may');
  });
});

describe('summarizeEvent: charge_change', () => {
  const previous = [charge('life', 'Seguro de vida'), charge('fee', 'Cuota de manejo')];
  const change = (charges) => event('charge_change', '2026-11-01', { charges });

  it('lists the labels of the added and modified charges, two at most, with a count for the rest', () => {
    const added = [...previous, charge('gps', 'GPS'), charge('inv', 'Inversión'), charge('adm', 'Administración')];
    expect(summarizeEvent(change(added), { previousCharges: previous })).toBe('Cargos: GPS, Inversión (+1)');
    expect(summarizeEvent(change([charge('life', 'Seguro de vida', 12000), previous[1], charge('gps', 'GPS')]), { previousCharges: previous })).toBe('Cargos: Seguro de vida, GPS');
  });

  it('names a removed charge and says when nothing changed', () => {
    expect(summarizeEvent(change([previous[1]]), { previousCharges: previous })).toBe('Cargos: sin Seguro de vida');
    expect(summarizeEvent(change(previous), { previousCharges: previous })).toBe('Cargos: sin cambios');
  });

  it('treats a missing previous set as no charges', () => {
    expect(summarizeEvent(change(previous))).toBe('Cargos: Seguro de vida, Cuota de manejo');
  });
});

describe('summarizeEvent: restructure and late_policy', () => {
  it('shows the carried balance and the new number of periods', () => {
    const restructure = event('restructure', '2026-11-01', { terms: { system: 'french', n: 36 } });
    expect(summarizeEvent(restructure, { applied: { carriedMinor: 9812000 } })).toBe('Reestructuración: $ 9.812.000 a 36 cuotas');
    expect(summarizeEvent(event('restructure', '2026-11-01', { terms: { system: 'bullet', n: 1 } }), { applied: { carriedMinor: 500000 } })).toBe('Reestructuración: $ 500.000 a 1 cuota');
  });

  it('degrades when the carried balance or the periods are unknown', () => {
    expect(summarizeEvent(event('restructure', '2026-11-01', { terms: { system: 'french', n: 24 } }))).toBe('Reestructuración: 24 cuotas');
    expect(summarizeEvent(event('restructure', '2026-11-01', { terms: { system: 'none' } }), { applied: { carriedMinor: 750000 } })).toBe('Reestructuración: $ 750.000');
  });

  it('describes each mora mode with its date', () => {
    const policy = (late) => summarizeEvent(event('late_policy', '2026-10-13', { late }));
    expect(policy({ mode: 'usury', graceDays: 0 })).toBe('Mora: tasa de usura desde 13 oct');
    expect(policy({ mode: 'none', graceDays: 0 })).toBe('Mora: sin mora desde 13 oct');
    expect(policy({ mode: 'fixed', rate: EA(40), graceDays: 0 })).toBe('Mora: tasa fija 40,00 % E.A. desde 13 oct');
    expect(policy({ mode: 'contract_multiple', multiple: 1.5, graceDays: 3 })).toBe('Mora: 1,5 veces la tasa del contrato desde 13 oct · gracia de 3 días');
    expect(policy({ mode: 'usury', graceDays: 1 })).toBe('Mora: tasa de usura desde 13 oct · gracia de 1 día');
  });
});

describe('summarizeEvent: other kinds', () => {
  it('has no summary for the kinds that carry an amount', () => {
    for (const kind of ['payment', 'extra_payment', 'disbursement', 'adjustment', 'charge']) {
      expect(summarizeEvent(event(kind, '2026-11-01'))).toBeNull();
    }
  });
});

describe('describeBlockers', () => {
  it('names each blocking event with its date, joined in prose', () => {
    expect(describeBlockers([{ id: 'p', kind: 'payment', effectiveOn: '2026-11-05' }])).toBe('el pago del 5 nov');
    expect(describeBlockers([
      { id: 'p', kind: 'payment', effectiveOn: '2026-11-05' },
      { id: 'r', kind: 'rate_change', effectiveOn: '2026-12-01' },
    ])).toBe('el pago del 5 nov y el cambio de tasa del 1 dic');
    expect(describeBlockers([
      { id: 'a', kind: 'extra_payment', effectiveOn: '2026-11-05' },
      { id: 'b', kind: 'charge_change', effectiveOn: '2026-11-20' },
      { id: 'c', kind: 'late_policy', effectiveOn: '2026-12-01' },
      { id: 'd', kind: 'restructure', effectiveOn: '2026-12-10' },
    ])).toBe('el abono extra del 5 nov, el cambio de cargos del 20 nov, la política de mora del 1 dic y la reestructuración del 10 dic');
  });
});
