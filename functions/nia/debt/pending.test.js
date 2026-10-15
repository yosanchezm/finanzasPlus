// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EXPLAIN_TOPICS } from '../../../packages/finance-core/index.js';
import {
  CALLBACK_MAX_BYTES,
  PENDING_MAX_BYTES,
  buildPending,
  chargeKeyboard,
  conventionKeyboard,
  debtRowId,
  dedupeKeyOf,
  eventIdOf,
  explainButton,
  modeKeyboard,
  parseExplainCallback,
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

  it('keeps a legal rate pending (the whole draft row) a few hundred bytes long, whatever the kind', () => {
    const month = { kind: 'usury', modality: 'productive_urban', validFrom: '2026-11-01', validTo: '2026-11-30', value: 10000 };
    const year = { kind: 'smmlv', modality: 'all', validFrom: '2027-01-01', validTo: '2027-12-31', value: 100000000 };

    for (const draft of [month, year]) {
      const pending = buildPending({ ...pay, action: 'legal_rate', debtId: undefined, preview: undefined, draft });

      expect(pending).toMatchObject({ kind: 'debt', v: 1, action: 'legal_rate', awaiting: 'confirm', draft });
      expect(bytes(JSON.stringify(pending))).toBeLessThan(300);
    }
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

describe('plan change callbacks (E2)', () => {
  it('offers keep_term and keep_installment, each callback at most 25 bytes', () => {
    const data = allButtons(modeKeyboard()).map((button) => button.callback_data);

    expect(data).toEqual(['nia:mode:keep_term', 'nia:mode:keep_installment']);
    for (const item of data) expect(bytes(item)).toBeLessThanOrEqual(25);
  });

  it('offers keep_installment only when the debt allows it (French loans)', () => {
    expect(allButtons(modeKeyboard(['keep_term'])).map((button) => button.callback_data)).toEqual(['nia:mode:keep_term']);
    expect(allButtons(modeKeyboard([]))).toEqual([]);
  });

  it('reads the two mode callbacks and refuses any other mode', () => {
    expect(parseCallback('nia:mode:keep_term')).toEqual({ type: 'mode', value: 'keep_term' });
    expect(parseCallback('nia:mode:keep_installment')).toEqual({ type: 'mode', value: 'keep_installment' });
    expect(parseCallback('nia:mode:shorten')).toBeNull();
    expect(parseCallback('nia:mode:')).toBeNull();
  });

  it('keeps a rate change pending, with the picker candidates or the full draft, under 1.5 KB', () => {
    const rate = { value: 2.125, basis: 'nominal', periodicity: 'monthly', timing: 'advance' };
    const candidates = Array.from({ length: 6 }, (_, index) => `db${String(index).padStart(34, 'x')}`);
    const picking = buildPending({ id: 'a1b2c3d4e5f6a7b8c9d0e1f2', action: 'rate_change', awaiting: 'pick', candidates, draft: { effectiveOn: '2026-10-13', rate, mode: 'keep_installment' } });
    const confirm = buildPending({ id: 'a1b2c3d4e5f6a7b8c9d0e1f2', action: 'rate_change', awaiting: 'confirm', debtId: candidates[0], draft: { effectiveOn: '2026-10-13', rate, mode: 'keep_installment' } });

    for (const pending of [picking, confirm]) expect(bytes(JSON.stringify(pending))).toBeLessThanOrEqual(PENDING_MAX_BYTES);
  });
});

describe('charge change callbacks (E2c)', () => {
  const charges = [{ id: 'life', label: 'Seguro de vida' }, { id: 'all', label: 'L'.repeat(60) }];

  it('offers one button per charge by position (the ids can be long), with the label cut to 40 characters', () => {
    const buttons = allButtons(chargeKeyboard(charges));

    expect(buttons.map((item) => item.callback_data)).toEqual(['nia:chg:0', 'nia:chg:1']);
    expect(buttons[1].text).toHaveLength(40);
    for (const item of buttons) expect(bytes(item.callback_data)).toBeLessThanOrEqual(64);
  });

  it('offers at most 6 charges', () => {
    const many = Array.from({ length: 9 }, (_, index) => ({ id: `c${index}`, label: `Cargo ${index}` }));

    expect(chargeKeyboard(many)).toHaveLength(6);
  });

  it('reads the position and refuses anything that is not a small number', () => {
    expect(parseCallback('nia:chg:0')).toEqual({ type: 'charge', value: 0 });
    expect(parseCallback('nia:chg:5')).toEqual({ type: 'charge', value: 5 });
    expect(parseCallback('nia:chg:')).toBeNull();
    expect(parseCallback('nia:chg:x')).toBeNull();
    expect(parseCallback('nia:chg:12')).toBeNull();
  });

  it('keeps a charge change pending under 1.5 KB with the candidate charge ids', () => {
    const candidates = Array.from({ length: 6 }, (_, index) => `charge-${index}-${'x'.repeat(20)}`);
    const pending = buildPending({ id: 'a1b2c3d4e5f6a7b8c9d0e1f2', action: 'charge_change', awaiting: 'charge', debtId: 'db0123456789abcdef0123456789abcdef01', candidates, draft: { effectiveOn: '2026-10-13', chargeRef: 'seguro de vida', op: 'set', newValue: 0.125 } });

    expect(bytes(JSON.stringify(pending))).toBeLessThanOrEqual(PENDING_MAX_BYTES);
  });
});

describe('explainButton and parseExplainCallback (stateless nia:exp: buttons)', () => {
  const ID36 = 'db0123456789abcdef0123456789abcdef01';

  it('fits the longest topic and a 36 character debt id in 64 bytes', () => {
    const button = explainButton('card_interest_drop', ID36);

    expect(button.callback_data).toBe(`nia:exp:card_interest_drop:${ID36}`);
    expect(bytes(button.callback_data)).toBeLessThanOrEqual(CALLBACK_MAX_BYTES);
  });

  it('keeps every topic with a 36 character id within 64 bytes, with and without a page', () => {
    for (const topic of EXPLAIN_TOPICS) {
      for (const page of [undefined, 2, 3]) {
        expect(bytes(explainButton(topic, ID36, page).callback_data)).toBeLessThanOrEqual(CALLBACK_MAX_BYTES);
      }
      expect(bytes(explainButton(topic).callback_data)).toBeLessThanOrEqual(CALLBACK_MAX_BYTES);
    }
  });

  it('drops the debt id to "-" in the page form when the full form would pass 64 bytes', () => {
    const page = explainButton('card_interest_drop', ID36, 2);

    expect(page.callback_data).toBe('nia:exp:card_interest_drop:-:2');
    expect(bytes(page.callback_data)).toBeLessThanOrEqual(CALLBACK_MAX_BYTES);
    // a shorter topic still fits the id and the page: no need to drop it
    expect(explainButton('mora', ID36, 2).callback_data).toBe(`nia:exp:mora:${ID36}:2`);
  });

  it('writes the topic alone when there is no debt, and uses the label as the button text', () => {
    expect(explainButton('mora').callback_data).toBe('nia:exp:mora');
    expect(explainButton('mora', null, 1, 'La mora')).toEqual({ text: 'La mora', callback_data: 'nia:exp:mora' });
    expect(explainButton('mora', 'd1', 1, 'La mora').callback_data).toBe('nia:exp:mora:d1');
  });

  it('round trips every form', () => {
    expect(parseExplainCallback('nia:exp:mora')).toEqual({ topic: 'mora', debtId: null, page: 1 });
    expect(parseExplainCallback(explainButton('mora', 'd1').callback_data)).toEqual({ topic: 'mora', debtId: 'd1', page: 1 });
    expect(parseExplainCallback(explainButton('charges', ID36, 2).callback_data)).toEqual({ topic: 'charges', debtId: ID36, page: 2 });
    expect(parseExplainCallback(explainButton('card_interest_drop', ID36, 3).callback_data)).toEqual({ topic: 'card_interest_drop', debtId: null, page: 3 });
    for (const topic of EXPLAIN_TOPICS) expect(parseExplainCallback(explainButton(topic, 'd1').callback_data)).toEqual({ topic, debtId: 'd1', page: 1 });
  });

  it('returns null for an unknown topic and for any malformed callback', () => {
    expect(parseExplainCallback('nia:exp:tax_returns')).toBeNull();
    expect(parseExplainCallback('nia:exp:')).toBeNull();
    expect(parseExplainCallback('nia:exp')).toBeNull();
    expect(parseExplainCallback('nia:exp:mora:d1:1')).toBeNull();
    expect(parseExplainCallback('nia:exp:mora:d1:x')).toBeNull();
    expect(parseExplainCallback('nia:exp:mora:d1:2:3')).toBeNull();
    expect(parseExplainCallback('nia:exp:mora:bad id')).toBeNull();
    expect(parseExplainCallback('nia:pick:d1')).toBeNull();
    expect(parseExplainCallback(undefined)).toBeNull();
    expect(parseExplainCallback(null)).toBeNull();
  });

  it('is not a stage callback: parseCallback ignores it', () => {
    expect(parseCallback('nia:exp:mora')).toBeNull();
  });

  it('refuses to build a button for an unknown topic or an over-long callback', () => {
    expect(() => explainButton('tax_returns')).toThrow(expect.objectContaining({ code: 'unknown_topic' }));
    expect(() => explainButton('card_interest_drop', 'x'.repeat(60))).toThrow(expect.objectContaining({ code: 'callback_too_long' }));
  });

  it('makes the shared button() assert the 64 byte limit for any callback', () => {
    expect(() => pickKeyboard([{ $id: 'x'.repeat(80), name: 'Larga' }])).toThrow(expect.objectContaining({ code: 'callback_too_long' }));
  });
});
