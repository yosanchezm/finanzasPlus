// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  PENDING_MAX_BYTES,
  buildPending,
  conventionKeyboard,
  debtRowId,
  dedupeKeyOf,
  eventIdOf,
  parseCallback,
  pickKeyboard,
  simulateKeyboard,
  strategyKeyboard,
} from './pending.js';

const bytes = (value) => Buffer.byteLength(value, 'utf8');
const allButtons = (keyboard) => keyboard.flat();

describe('buildPending', () => {
  it('accepts a simulation that waits for the simpay button, still compact', () => {
    const pending = buildPending({ id: 'p1', action: 'simulate', awaiting: 'simpay', debtId: 'd1', draft: { amountMinor: 2000000, strategy: 'reduce_term' } });

    expect(pending).toEqual({ kind: 'debt', v: 1, id: 'p1', action: 'simulate', awaiting: 'simpay', debtId: 'd1', draft: { amountMinor: 2000000, strategy: 'reduce_term' } });
    expect(bytes(JSON.stringify(pending))).toBeLessThan(300);
  });

  const pay = {
    id: 'a1b2c3d4e5f6a7b8c9d0e1f2',
    action: 'pay',
    awaiting: 'confirm',
    debtId: 'db0123456789abcdef0123456789abcdef01',
    draft: { kind: 'payment', effectiveOn: '2026-10-13', amountMinor: 380381 },
    preview: { interest: 180876, charges: 0, principal: 199505, balanceAfter: 9800495 },
  };

  it('builds the compact payload of a payment and stays far below 1.5 KB', () => {
    const pending = buildPending(pay);

    expect(pending).toEqual({ kind: 'debt', v: 1, ...pay });
    expect(bytes(JSON.stringify(pending))).toBeLessThan(PENDING_MAX_BYTES);
  });

  it('keeps a picker payload with 6 candidates under the limit', () => {
    const candidates = Array.from({ length: 6 }, (_, index) => `db${String(index).padStart(34, 'x')}`);
    const pending = buildPending({ id: pay.id, action: 'pay', awaiting: 'pick', candidates, draft: pay.draft });

    expect(pending.candidates).toHaveLength(6);
    expect(bytes(JSON.stringify(pending))).toBeLessThanOrEqual(PENDING_MAX_BYTES);
  });

  it('rejects a payload over 1.5 KB with a typed error (a create draft with long charges)', () => {
    const charges = Array.from({ length: 6 }, (_, index) => ({ id: `c${index}`, kind: 'fee', label: 'L'.repeat(40), basis: 'fixed', value: 123456, cadence: 'per_installment' }));
    const draft = { name: 'Moto', ownerScope: 'you', terms: { kind: 'vehicle', charges, notes: 'x'.repeat(900) } };

    expect(() => buildPending({ id: pay.id, action: 'create', awaiting: 'confirm', draft })).toThrow(expect.objectContaining({ code: 'pending_too_large' }));
  });

  it('requires an id of at most 24 characters so db{id}, de{id} and the dedupe key stay valid', () => {
    expect(() => buildPending({ ...pay, id: 'x'.repeat(25) })).toThrow(expect.objectContaining({ code: 'invalid_pending' }));
    expect(() => buildPending({ ...pay, id: '' })).toThrow(expect.objectContaining({ code: 'invalid_pending' }));
  });

  it('derives the dedupe key and the deterministic row ids from the pending id', () => {
    const pending = buildPending(pay);

    expect(dedupeKeyOf(pending)).toBe('debt:a1b2c3d4e5f6a7b8c9d0e1f2');
    expect(eventIdOf(pending)).toBe('dea1b2c3d4e5f6a7b8c9d0e1f2');
    expect(debtRowId(pending)).toBe('dba1b2c3d4e5f6a7b8c9d0e1f2');
    expect(eventIdOf({ id: 'z9' })).toBe('dez9');
  });
});

describe('keyboards', () => {
  const debts = Array.from({ length: 8 }, (_, index) => ({ $id: `d${String(index).padStart(35, '0')}`, name: `Deuda ${index} ${'larga '.repeat(12)}` }));

  it('lists at most 6 debts, one per row, with callback_data under 64 bytes', () => {
    const keyboard = pickKeyboard(debts);

    expect(keyboard).toHaveLength(6);
    expect(keyboard.every((row) => row.length === 1)).toBe(true);
    expect(allButtons(keyboard)[0].callback_data).toBe(`nia:pick:${debts[0].$id}`);
    for (const button of allButtons(keyboard)) {
      expect(bytes(button.callback_data)).toBeLessThanOrEqual(64);
      expect(button.text.length).toBeLessThanOrEqual(40);
    }
  });

  it('refuses an id that would overflow the 64 byte limit', () => {
    expect(() => pickKeyboard([{ $id: 'x'.repeat(60), name: 'Larga' }])).toThrow(expect.objectContaining({ code: 'callback_too_long' }));
  });

  it('offers the three strategies', () => {
    const data = allButtons(strategyKeyboard()).map((button) => button.callback_data);

    expect(data).toEqual(['nia:strat:reduce_term', 'nia:strat:reduce_installment', 'nia:strat:advance_installments']);
    for (const item of data) expect(bytes(item)).toBeLessThanOrEqual(64);
  });

  it('offers the rate conventions', () => {
    const data = allButtons(conventionKeyboard()).map((button) => button.callback_data);

    expect(data).toEqual(['nia:conv:EA', 'nia:conv:NAMV', 'nia:conv:MV', 'nia:conv:NATV', 'nia:conv:NATA']);
  });

  it('offers one button to turn a simulation into a payment', () => {
    expect(allButtons(simulateKeyboard())).toEqual([{ text: 'Registrar este abono', callback_data: 'nia:simpay' }]);
  });
});

describe('parseCallback', () => {
  it('reads each debt callback', () => {
    expect(parseCallback('nia:pick:dbabc')).toEqual({ type: 'pick', value: 'dbabc' });
    expect(parseCallback('nia:strat:reduce_term')).toEqual({ type: 'strategy', value: 'reduce_term' });
    expect(parseCallback('nia:conv:NAMV')).toEqual({ type: 'convention', value: 'NAMV' });
    expect(parseCallback('nia:simpay')).toEqual({ type: 'simpay', value: null });
  });

  it('rejects unknown strategies, conventions and other bot callbacks', () => {
    expect(parseCallback('nia:strat:pay_all')).toBeNull();
    expect(parseCallback('nia:conv:ZERO')).toBeNull();
    expect(parseCallback('nia:pick:')).toBeNull();
    expect(parseCallback('nia:confirm')).toBeNull();
    expect(parseCallback(undefined)).toBeNull();
  });
});
