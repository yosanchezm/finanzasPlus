import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../../appwrite';
import { saveLoan } from './saveLoan';
import { evaluate, initialWizard, wizardReducer } from './wizard/wizardModel';

vi.mock('../../appwrite', () => ({ createDebt: vi.fn(), debtPort: vi.fn() }));

const port = { ensureCostCategory: vi.fn(), createEvent: vi.fn(), findEventByDedupe: vi.fn(), createCostRow: vi.fn(), deleteCostRow: vi.fn() };
const cardDraft = (principal = '') => {
  const state = [
    { type: 'kind', kind: 'card' },
    { type: 'set', patch: { name: 'Visa', principal } },
    { type: 'rate', patch: { value: '28' } },
    { type: 'card', patch: { statementDay: '15', dueDay: '30' } },
  ].reduce(wizardReducer, initialWizard('2026-10-12'));
  return { name: 'Visa', lender: 'Banco', terms: evaluate(state).terms };
};

describe('saveLoan for a credit card', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes only the debt row: a card has no disbursement event, expense or income', async () => {
    api.debtPort.mockReturnValue(port);
    api.createDebt.mockResolvedValue({});
    await saveLoan({ draft: cardDraft('500000'), ownerScope: 'shared', nonce: 'n1', householdId: 'h1', actorId: 'u1' });

    expect(api.createDebt).toHaveBeenCalledTimes(1);
    const { id, data } = api.createDebt.mock.calls[0][0];
    expect(id).toBe('dbn1');
    expect(data).toMatchObject({ householdId: 'h1', name: 'Visa', kind: 'card', lender: 'Banco', ownerScope: 'shared', status: 'active', principalMinor: 500000, termsVersion: 1, actorId: 'u1' });
    expect(JSON.parse(data.termsJson).card).toMatchObject({ statementDay: 15, dueDay: 30 });
    expect(port.createEvent).not.toHaveBeenCalled();
    expect(port.createCostRow).not.toHaveBeenCalled();
  });

  it('accepts a card without an opening balance, and treats an existing row (409) as saved', async () => {
    api.createDebt.mockRejectedValueOnce(Object.assign(new Error('exists'), { code: 409 }));
    await expect(saveLoan({ draft: cardDraft(''), ownerScope: 'you', nonce: 'n2', householdId: 'h1', actorId: 'u1' })).resolves.toBeUndefined();

    expect(api.createDebt.mock.calls[0][0].data.principalMinor).toBe(0);
  });
});
