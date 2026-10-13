// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { serializeTerms } from '../../../packages/finance-core/index.js';
import { confirmDebt, handleDebt, handleDebtCallback } from './handler.js';

const plain = (text) => text.replace(/ /g, ' ');
const ACTOR = 'telegram:1';

// French 10,000,000 at 24% EA, 36 months; the first installment (380,381) fell due on 2026-10-10, "today" is 2026-10-13.
const loanTerms = { kind: 'vehicle', principalMinor: 10000000, openedOn: '2026-09-10', rate: { convention: 'EA', value: 24 }, system: 'french', periodicity: 'monthly', n: 36, firstDueOn: '2026-10-10' };
const debtRow = (id, name, extra = {}) => ({ $id: id, householdId: 'h1', name, kind: 'vehicle', ownerScope: 'shared', status: 'active', lender: '', termsJson: serializeTerms(loanTerms), ...extra });
const disbursement = (debtId) => ({ $id: `e-${debtId}`, debtId, householdId: 'h1', kind: 'disbursement', effectiveOn: '2026-09-10', amountMinor: 10000000, payloadJson: '{}', actorId: ACTOR, source: 'telegram', dedupeKey: `seed:${debtId}`, $createdAt: '2026-09-10T12:00:00.000Z' });

function world({ debts = [debtRow('d1', 'Crédito Vehículo')], categories = [], answers = [] } = {}) {
  const tables = { debts: [...debts], debt_events: debts.map((debt) => disbursement(debt.$id)), transactions: [], categories: [...categories] };
  const sent = [];
  const sessions = [];
  const prompts = [];
  const conflict = () => Object.assign(new Error('conflict'), { status: 409 });
  const deps = {
    config: { householdId: 'h1', timezone: 'America/Bogota', currency: 'COP' },
    now: () => new Date('2026-10-13T15:00:00Z'),
    ids: { pending: () => 'p1' },
    listRows: async (table, where) => tables[table].filter((row) => Object.entries(where).every(([key, value]) => row[key] === value)),
    createRow: async (table, { id, data }) => {
      if (tables[table].some((row) => row.$id === id || (table === 'debt_events' && row.dedupeKey === data.dedupeKey))) throw conflict();
      const row = { $id: id, $createdAt: '2026-10-13T15:00:00.000Z', ...data };
      tables[table].push(row);
      return row;
    },
    deleteRow: async (table, id) => { tables[table] = tables[table].filter((row) => row.$id !== id); },
    gemini: async (prompt) => { prompts.push(prompt); return answers.shift(); },
    sendMessage: async (chatId, text, keyboard) => { sent.push({ chatId, text: plain(text), keyboard }); },
    saveSession: async (chatId, actorId, status, pending, history) => { sessions.push({ status, pending, history }); },
  };
  return { deps, tables, sent, sessions, prompts, lastPending: () => sessions[sessions.length - 1].pending };
}

const profile = { ownerScope: 'you', appwriteUserId: ACTOR, alias: 'Camilo' };
const ctx = (extra = {}) => ({ chatId: 'c1', actorId: '1', profile, text: 'mensaje', history: [], previous: null, sessionStatus: 'conversation', ...extra });
const buttons = (keyboard) => keyboard.flat().map((item) => item.callback_data);
const costRows = (w) => w.tables.transactions;

const payAnswer = (extra = {}) => ({ action: 'pay', debtRef: 'vehiculo', amountMinor: 380381, ...extra });
const loanAnswer = (extra = {}) => ({ action: 'create', kind: 'vehicle', name: 'Moto', principalMinor: 10000000, rate: { value: 24, period: 'annual' }, n: 36, ...extra });

describe('pay', () => {
  it('shows a preview with the split and writes nothing until confirmed', async () => {
    const w = world({ answers: [payAnswer()] });
    await handleDebt(w.deps, ctx({ text: 'pagué 380 mil al carro' }));

    expect(w.prompts[0]).toContain('Crédito Vehículo');
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0].text).toContain('Abono a Crédito Vehículo');
    expect(w.sent[0].text).toContain('Intereses: $ 180.876');
    expect(w.sent[0].text).toContain('Capital: $ 199.505');
    expect(buttons(w.sent[0].keyboard)).toEqual(['nia:confirm', 'nia:edit', 'nia:cancel']);
    expect(w.sessions[0].status).toBe('awaiting_confirmation');
    expect(w.lastPending()).toMatchObject({ kind: 'debt', id: 'p1', action: 'pay', awaiting: 'confirm', debtId: 'd1', draft: { kind: 'payment', effectiveOn: '2026-10-13', amountMinor: 380381 }, preview: { interest: 180876, principal: 199505 } });
    expect(w.tables.debt_events).toHaveLength(1);
    expect(costRows(w)).toHaveLength(0);
  });

  it('asks for a correction on a negative amount and writes nothing', async () => {
    const w = world({ answers: [payAnswer({ amountMinor: -500000 })] });
    await handleDebt(w.deps, ctx());

    expect(w.sent).toHaveLength(1);
    expect(w.sent[0].text).toContain('negativo');
    expect(w.sent[0].keyboard).toBeUndefined();
    expect(w.sessions[0].pending).toBeNull();
    expect(w.tables.debt_events).toHaveLength(1);
  });

  it('asks for the amount when it is missing', async () => {
    const w = world({ answers: [payAnswer({ amountMinor: null })] });
    await handleDebt(w.deps, ctx());

    expect(w.sent[0].text).toContain('monto');
  });

  it('shows the pick keyboard when two debts match, then previews the chosen one', async () => {
    const w = world({ debts: [debtRow('d1', 'Carro', { lender: 'Banco Uno' }), debtRow('d2', 'Moto', { lender: 'Banco Dos' })], answers: [payAnswer({ debtRef: 'banco' })] });
    await handleDebt(w.deps, ctx());

    expect(buttons(w.sent[0].keyboard)).toEqual(['nia:pick:d1', 'nia:pick:d2']);
    expect(w.lastPending()).toMatchObject({ awaiting: 'pick', candidates: ['d1', 'd2'], draft: { amountMinor: 380381, effectiveOn: '2026-10-13' } });
    expect(w.tables.debt_events).toHaveLength(2);

    await handleDebtCallback(w.deps, ctx({ pending: w.lastPending() }), 'nia:pick:d2');
    expect(w.sent[1].text).toContain('Abono a Moto');
    expect(w.lastPending()).toMatchObject({ awaiting: 'confirm', debtId: 'd2' });
  });

  it('asks which debt when nothing matches and several are active, and ignores a debt that was not offered', async () => {
    const w = world({ debts: [debtRow('d1', 'Carro'), debtRow('d2', 'Moto')], answers: [payAnswer({ debtRef: 'la deuda de mi hermano' })] });
    await handleDebt(w.deps, ctx());
    const pending = w.lastPending();

    expect(buttons(w.sent[0].keyboard)).toEqual(['nia:pick:d1', 'nia:pick:d2']);
    await handleDebtCallback(w.deps, ctx({ pending }), 'nia:pick:other');
    expect(w.sent[1].text).toContain('no es una de las opciones');
    expect(w.sessions).toHaveLength(1);
  });

  it('asks for a strategy before previewing an amount above the installment', async () => {
    const w = world({ answers: [payAnswer({ amountMinor: 1000000 })] });
    await handleDebt(w.deps, ctx());

    expect(buttons(w.sent[0].keyboard)).toEqual(['nia:strat:reduce_term', 'nia:strat:reduce_installment', 'nia:strat:advance_installments']);
    expect(w.lastPending()).toMatchObject({ awaiting: 'strategy', debtId: 'd1' });

    await handleDebtCallback(w.deps, ctx({ pending: w.lastPending() }), 'nia:strat:reduce_term');
    expect(w.sent[1].text).toContain('Estrategia: reducir plazo');
    expect(buttons(w.sent[1].keyboard)).toContain('nia:confirm');
    expect(w.lastPending()).toMatchObject({ awaiting: 'confirm', draft: { kind: 'extra_payment', amountMinor: 1000000, strategy: 'reduce_term' } });
    expect(w.tables.debt_events).toHaveLength(1);
  });

  it('refuses to confirm while the flow still waits for a choice', async () => {
    const w = world({ answers: [payAnswer({ amountMinor: 1000000 })] });
    await handleDebt(w.deps, ctx());
    await confirmDebt(w.deps, ctx(), w.lastPending());

    expect(w.sent[1].text).toContain('Antes de confirmar');
    expect(w.tables.debt_events).toHaveLength(1);
  });
});

describe('confirm a payment (exactly once)', () => {
  const previewed = async (w) => { await handleDebt(w.deps, ctx()); return w.lastPending(); };

  it('writes one event and one cost row with the debt owner scope and the cost category', async () => {
    const w = world({ answers: [payAnswer()] });
    await confirmDebt(w.deps, ctx(), await previewed(w));

    expect(w.tables.debt_events.filter((event) => event.kind === 'payment')).toEqual([expect.objectContaining({ $id: 'dep1', debtId: 'd1', amountMinor: 380381, dedupeKey: 'debt:p1', source: 'telegram', actorId: ACTOR })]);
    expect(costRows(w)).toEqual([expect.objectContaining({ $id: 'dcdep1', debtId: 'd1', type: 'expense', amountMinor: 180876, ownerScope: 'shared', source: 'debt', categoryId: 'cfh1', dedupeKey: 'debt:dep1' })]);
    expect(w.tables.categories).toEqual([expect.objectContaining({ $id: 'cfh1', name: 'Costos financieros' })]);
    expect(w.sent[1].text).toContain('registré');
    expect(w.sessions[w.sessions.length - 1]).toMatchObject({ status: 'completed', pending: { kind: 'debt', id: 'p1', done: true } });
  });

  it('answers "ya registrado" on a double Confirm, whether the session still holds the pending or already the done marker', async () => {
    const w = world({ answers: [payAnswer()] });
    const pending = await previewed(w);
    await confirmDebt(w.deps, ctx(), pending);
    await confirmDebt(w.deps, ctx(), pending); // Telegram retry: same callback, the session was not updated yet
    await confirmDebt(w.deps, ctx(), w.lastPending()); // second tap after the first one finished

    expect(w.tables.debt_events.filter((event) => event.kind === 'payment')).toHaveLength(1);
    expect(costRows(w)).toHaveLength(1);
    expect(w.sent.slice(2).map((message) => message.text.includes('ya estaba registrado'))).toEqual([true, true]);
  });

  it('stays at one event and one cost row when two confirmations race', async () => {
    const w = world({ answers: [payAnswer()] });
    const pending = await previewed(w);
    await Promise.all([confirmDebt(w.deps, ctx(), pending), confirmDebt(w.deps, ctx(), pending)]);

    expect(w.tables.debt_events.filter((event) => event.kind === 'payment')).toHaveLength(1);
    expect(costRows(w)).toHaveLength(1);
    expect(w.tables.categories).toHaveLength(1);
  });

  it('keeps the pending after a half-saved payment and completes the cost row on retry with the same amount', async () => {
    const w = world({ answers: [payAnswer()] });
    const pending = await previewed(w);
    const createRow = w.deps.createRow;
    let failOnce = true;
    w.deps.createRow = async (table, row) => {
      if (table === 'transactions' && failOnce) { failOnce = false; throw new Error('boom'); }
      return createRow(table, row);
    };

    await expect(confirmDebt(w.deps, ctx(), pending)).rejects.toMatchObject({ code: 'cost_row_failed' });
    expect(w.sessions.some((session) => session.status === 'completed')).toBe(false);
    expect(costRows(w)).toHaveLength(0);

    await confirmDebt(w.deps, ctx(), pending);
    expect(costRows(w)).toEqual([expect.objectContaining({ $id: 'dcdep1', amountMinor: 180876 })]);
    expect(w.tables.debt_events.filter((event) => event.kind === 'payment')).toHaveLength(1);
  });

  it('reuses an existing cost category found by folded name and writes no cost row for an interest-free debt', async () => {
    const w = world({ categories: [{ $id: 'cat9', householdId: 'h1', name: 'COSTOS Financieros' }], answers: [payAnswer()] });
    await confirmDebt(w.deps, ctx(), await previewed(w));

    expect(costRows(w)[0].categoryId).toBe('cat9');
    expect(w.tables.categories).toHaveLength(1);

    const free = world({ debts: [debtRow('d1', 'Préstamo Juan', { termsJson: serializeTerms({ ...loanTerms, kind: 'family', rate: { convention: 'ZERO' }, principalMinor: 1200000, n: 12 }) })], answers: [payAnswer({ debtRef: 'juan', amountMinor: 100000 })] });
    free.tables.debt_events = [{ ...disbursement('d1'), amountMinor: 1200000 }];
    await confirmDebt(free.deps, ctx(), await previewed(free));
    expect(free.tables.debt_events.filter((event) => event.kind === 'payment')).toHaveLength(1);
    expect(costRows(free)).toHaveLength(0);
  });
});

describe('create', () => {
  it('previews a new loan, writes nothing, and on Confirm writes the debt db{id} and its disbursement once', async () => {
    const w = world({ debts: [], answers: [loanAnswer()] });
    await handleDebt(w.deps, ctx());

    expect(w.sent[0].text).toContain('Nueva deuda');
    expect(w.sent[0].text).toContain('36 cuotas mensuales');
    expect(buttons(w.sent[0].keyboard)).toContain('nia:confirm');
    expect(w.tables.debts).toHaveLength(0);
    expect(w.tables.debt_events).toHaveLength(0);

    const pending = w.lastPending();
    await confirmDebt(w.deps, ctx(), pending);
    await confirmDebt(w.deps, ctx(), pending);

    expect(w.tables.debts).toEqual([expect.objectContaining({ $id: 'dbp1', householdId: 'h1', name: 'Moto', ownerScope: 'you', status: 'active', principalMinor: 10000000, actorId: ACTOR })]);
    expect(JSON.parse(w.tables.debts[0].termsJson)).toMatchObject({ kind: 'vehicle', n: 36, system: 'french' });
    expect(w.tables.debt_events).toEqual([expect.objectContaining({ $id: 'dep1', debtId: 'dbp1', kind: 'disbursement', amountMinor: 10000000, dedupeKey: 'debt:p1' })]);
    expect(costRows(w)).toHaveLength(0);
    expect(w.sent[1].text).toContain('registré');
    expect(w.sent[2].text).toContain('ya estaba registrada');
  });

  it('completes a creation whose debt row was never written (event saved, row missing)', async () => {
    const w = world({ debts: [], answers: [loanAnswer()] });
    await handleDebt(w.deps, ctx());
    await w.deps.createRow('debt_events', { id: 'dep1', data: { householdId: 'h1', debtId: 'dbp1', kind: 'disbursement', dedupeKey: 'debt:p1' } });
    await confirmDebt(w.deps, ctx(), w.lastPending());

    expect(w.tables.debts).toHaveLength(1);
    expect(w.tables.debt_events).toHaveLength(1);
    expect(w.sent[1].text).toContain('registré');
  });

  it('asks for the convention with buttons before any preview, then previews with the echo', async () => {
    const w = world({ debts: [], answers: [loanAnswer({ rate: { value: 2, period: 'monthly' } })] });
    await handleDebt(w.deps, ctx({ text: 'préstamo al 2% mensual' }));

    expect(buttons(w.sent[0].keyboard)).toEqual(['nia:conv:EA', 'nia:conv:NAMV', 'nia:conv:MV', 'nia:conv:NATV', 'nia:conv:NATA']);
    expect(w.lastPending()).toMatchObject({ awaiting: 'convention' });
    expect(w.tables.debts).toHaveLength(0);

    await handleDebtCallback(w.deps, ctx({ pending: w.lastPending() }), 'nia:conv:MV');
    expect(w.sent[1].text).toMatch(/Tasa: 2% MV ≈ 26\.82% EA/);
    expect(w.lastPending()).toMatchObject({ awaiting: 'confirm' });
  });

  it('asks for what is missing and points cards to the web', async () => {
    const w = world({ debts: [], answers: [{ action: 'create', kind: 'consumer', name: 'Libre' }, loanAnswer({ kind: 'card' })] });
    await handleDebt(w.deps, ctx());
    await handleDebt(w.deps, ctx());

    expect(w.sent[0].text).toContain('monto del préstamo');
    expect(w.sent[0].text).toContain('tasa');
    expect(w.sent[1].text).toContain('web');
    expect(w.tables.debts).toHaveLength(0);
  });
});

describe('list and later actions', () => {
  it('lists the debts with code-computed figures and keeps the pending request untouched', async () => {
    const w = world({ answers: [{ action: 'list' }] });
    const previous = { kind: 'debt', v: 1, id: 'old', awaiting: 'confirm' };
    await handleDebt(w.deps, ctx({ previous, sessionStatus: 'awaiting_confirmation' }));

    expect(w.sent[0].text).toContain('Crédito Vehículo');
    expect(w.sent[0].text).toContain('saldo $ 10.000.000');
    expect(w.sessions[0]).toMatchObject({ status: 'awaiting_confirmation', pending: previous });
    expect(w.tables.debt_events).toHaveLength(1);
  });

  it('sends simulate and advise to the web for now', async () => {
    const w = world({ answers: [{ action: 'simulate', extraMinor: 2000000 }, { action: 'advise' }] });
    await handleDebt(w.deps, ctx());
    await handleDebt(w.deps, ctx());
    await handleDebtCallback(w.deps, ctx(), 'nia:simpay');

    expect(w.sent.map((message) => message.text.includes('web'))).toEqual([true, true, true]);
  });
});
