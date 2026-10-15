// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PENDING_MAX_BYTES, buildPending, confirmKeyboard, withChain } from '../pending.js';
import { STEP_RECORDED, advanceChain, chainReport, checklistText, planChain } from './chain.js';

const plain = (text) => text.replace(/ /g, ' ');
const step = (action, label, draft = {}) => ({ action, draft, label });
const THREE = [
  step('terms_correction', 'Corregir el día de corte a 20', { card: { statementDay: 20 } }),
  step('charge_change', 'Agregar GMF (4 x 1000)', { effectiveOn: '2026-10-13', op: 'add', add: { presets: { gmf: true }, charge: null } }),
  step('late_policy', 'Quitar la mora', { effectiveOn: '2026-10-13', late: { mode: 'none', graceDays: 0 } }),
];

describe('planChain', () => {
  it('runs the first step now and keeps the rest, compact, in the chain', () => {
    const planned = planChain('c1', THREE);

    expect(planned.step).toEqual({ a: 'terms_correction', d: { card: { statementDay: 20 } } });
    expect(planned.chain).toEqual({
      debtId: 'c1',
      now: 'Corregir el día de corte a 20',
      done: [],
      rest: [{ a: 'charge_change', d: THREE[1].draft, l: 'Agregar GMF (4 x 1000)' }, { a: 'late_policy', d: THREE[2].draft, l: 'Quitar la mora' }],
    });
  });

  it('refuses a plan whose chain would not leave room in a pending of 1.5 KB', () => {
    const big = Array.from({ length: 6 }, (_, index) => step('charge_change', `Agregar un cargo con un nombre largo número ${index}`, { effectiveOn: '2026-10-13', op: 'add', add: { presets: {}, charge: { kind: 'other', label: `Cargo ${index} con nombre largo`, basis: 'fixed', value: 1000 + index, cadence: 'per_installment' } } }));

    expect(planChain('c1', big)).toBeNull();
    expect(planChain('c1', THREE)).not.toBeNull();
  });

  it('keeps a pending with the chain attached within 1.5 KB, and says so when it would not', () => {
    const { chain } = planChain('c1', THREE);
    const pending = buildPending({ id: 'p1', action: 'terms_correction', awaiting: 'confirm', debtId: 'c1', draft: { card: { statementDay: 20 } } });

    expect(Buffer.byteLength(JSON.stringify(withChain(pending, chain)), 'utf8')).toBeLessThan(PENDING_MAX_BYTES);
    expect(() => withChain(pending, { ...chain, now: 'x'.repeat(PENDING_MAX_BYTES) })).toThrow(expect.objectContaining({ code: 'pending_too_large' }));
  });
});

describe('advanceChain', () => {
  it('moves the step that finished to done and hands over the next one, until none is left', () => {
    const first = planChain('c1', THREE).chain;
    const second = advanceChain(first);
    const third = advanceChain(second.chain);

    expect(second.step).toEqual({ a: 'charge_change', d: THREE[1].draft });
    expect(second.chain).toEqual({ debtId: 'c1', now: 'Agregar GMF (4 x 1000)', done: ['Corregir el día de corte a 20'], rest: [{ a: 'late_policy', d: THREE[2].draft, l: 'Quitar la mora' }] });
    expect(third.chain).toMatchObject({ now: 'Quitar la mora', done: ['Corregir el día de corte a 20', 'Agregar GMF (4 x 1000)'], rest: [] });
    expect(advanceChain(third.chain)).toBeNull();
  });
});

describe('chainReport', () => {
  const second = advanceChain(planChain('c1', THREE).chain).chain;

  it('after a cancel at step 2 of 3 lists step 1 as done and the other two as not run', () => {
    const text = chainReport(second, { cancelled: true });

    expect(text).toContain('Cancelado');
    expect(text).toMatch(/Hecho:\n1\. Corregir el día de corte a 20/);
    expect(text).toMatch(/No se ejecutó:\n1\. Agregar GMF \(4 x 1000\)\n2\. Quitar la mora/);
  });

  it('after a failure gives the reason first, and says nothing was done when the first step fails', () => {
    const text = chainReport(planChain('c1', THREE).chain, { issue: 'Ese cargo ya existe en la deuda.' });

    expect(text).toContain('Me detengo aquí: Ese cargo ya existe en la deuda.');
    expect(text).toContain('Hecho: nada todavía.');
    expect(text).toMatch(/No se ejecutó:\n1\. Corregir el día de corte a 20\n2\. Agregar GMF \(4 x 1000\)\n3\. Quitar la mora/);
  });
});

describe('checklistText and the buttons of a step', () => {
  it('lists the steps in order with the assumptions and what is not supported, and says each one waits for its Confirm', () => {
    const text = plain(checklistText('Visa', { steps: THREE, assumptions: [{ code: 'x', text: 'Ya tiene ese cargo.' }], unsupported: [{ code: 'card_limit', text: 'El cupo: no soportado aún.' }] }));

    expect(text).toContain('Esto es lo que veo para Visa:');
    expect(text).toMatch(/1\. Corregir el día de corte a 20\n2\. Agregar GMF \(4 x 1000\)\n3\. Quitar la mora/);
    expect(text).toContain('Ya tiene ese cargo.');
    expect(text).toContain('no soportado aún');
    expect(text).toContain('solo se guarda lo que confirmes');
  });

  it('binds the Confirm button to the id of the step, and keeps the plain one for every other flow', () => {
    expect(confirmKeyboard('p2')[0][0]).toEqual({ text: 'Confirmar', callback_data: 'nia:confirm:p2' });
    expect(confirmKeyboard()[0][0].callback_data).toBe('nia:confirm');
    expect(Buffer.byteLength(confirmKeyboard('x'.repeat(24))[0][0].callback_data, 'utf8')).toBeLessThanOrEqual(64);
    expect(STEP_RECORDED).toBe('Ese paso ya quedó registrado.');
  });
});
