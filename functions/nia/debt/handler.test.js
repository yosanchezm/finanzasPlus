// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXPLAIN_TOPICS, resolveLegal, restructureCarry, serializeTerms } from '../../../packages/finance-core/index.js';
import { reviewedCopy } from '../../../packages/finance-core/test/helpers/explainCopy.js';
import { pesos } from './format.js';
import { confirmDebt, debtSummaries, handleDebt, handleDebtCallback, handleExplainCallback, lastExplain, loadDebts, loadLegal } from './handler.js';

const plain = (text) => text.replace(/ /g, ' ');
const ACTOR = 'telegram:1';

// French 10,000,000 at 24% EA, 36 months; the first installment (380,381) fell due on 2026-10-10, "today" is 2026-10-13.
const loanTerms = { kind: 'vehicle', principalMinor: 10000000, openedOn: '2026-09-10', rate: { convention: 'EA', value: 24 }, system: 'french', periodicity: 'monthly', n: 36, firstDueOn: '2026-10-10' };
const debtRow = (id, name, extra = {}) => ({ $id: id, householdId: 'h1', name, kind: 'vehicle', ownerScope: 'shared', status: 'active', lender: '', termsJson: serializeTerms(loanTerms), ...extra });
const disbursement = (debtId) => ({ $id: `e-${debtId}`, debtId, householdId: 'h1', kind: 'disbursement', effectiveOn: '2026-09-10', amountMinor: 10000000, payloadJson: '{}', actorId: ACTOR, source: 'telegram', dedupeKey: `seed:${debtId}`, $createdAt: '2026-09-10T12:00:00.000Z' });

function world({ debts = [debtRow('d1', 'Crédito Vehículo')], categories = [], answers = [], cashflow = [], config = {}, legalRows = [], legalError = null, updateError = null } = {}) {
  const tables = { debts: [...debts], debt_events: debts.map((debt) => disbursement(debt.$id)), transactions: [], categories: [...categories], legal_rates: [...legalRows] };
  const sent = [];
  const sessions = [];
  const prompts = [];
  const windows = [];
  const updates = [];
  const conflict = () => Object.assign(new Error('conflict'), { status: 409 });
  const deps = {
    config: { householdId: 'h1', timezone: 'America/Bogota', currency: 'COP', ...config },
    cashflowRows: async (window) => {
      windows.push(window);
      if (cashflow instanceof Error) throw cashflow;
      return cashflow;
    },
    now: () => new Date('2026-10-13T15:00:00Z'),
    ids: { pending: () => 'p1' },
    listRows: async (table, where) => {
      if (table === 'legal_rates' && legalError) throw legalError;
      return tables[table].filter((row) => Object.entries(where).every(([key, value]) => row[key] === value));
    },
    createRow: async (table, { id, data }) => {
      if (tables[table].some((row) => row.$id === id || (table === 'debt_events' && row.dedupeKey === data.dedupeKey))) throw conflict();
      const row = { $id: id, $createdAt: '2026-10-13T15:00:00.000Z', ...data };
      tables[table].push(row);
      return row;
    },
    deleteRow: async (table, id) => { tables[table] = tables[table].filter((row) => row.$id !== id); },
    updateRow: async (table, id, data) => {
      if (updateError) throw updateError;
      const row = tables[table].find((item) => item.$id === id);
      if (!row) throw Object.assign(new Error('not found'), { status: 404 });
      updates.push({ table, id, data });
      Object.assign(row, data);
      return row;
    },
    gemini: async (prompt) => {
      prompts.push(prompt);
      const answer = answers.shift();
      if (answer instanceof Error) throw answer;
      if (typeof answer === 'function') return answer(prompt);
      return answer === 'hang' ? new Promise(() => {}) : answer;
    },
    sendMessage: async (chatId, text, keyboard) => { sent.push({ chatId, text: plain(text), keyboard }); },
    saveSession: async (chatId, actorId, status, pending, history) => { sessions.push({ status, pending, history }); },
  };
  return { deps, tables, sent, sessions, prompts, windows, updates, lastPending: () => sessions[sessions.length - 1].pending };
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

});


// Cash flow: July, August and September 2026 are the 3 full months before "today" (2026-10-13).
const flow = (type, amountMinor, month, ownerScope = 'shared') => ({ type, amountMinor, occurredAt: `2026-${month}-15T15:00:00.000Z`, ownerScope });
const quarter = (income, expense) => ['07', '08', '09'].flatMap((month) => [flow('income', income, month), flow('expense', expense, month)]);
const factsIn = (prompt) => JSON.parse(prompt.split('Hechos:\n')[1]);
const faithful = (prompt) => {
  const { text } = factsIn(prompt);
  return { reply: `Con un abono de $ ${text.amount} tu tasa es ${text.ea} y te quedarían ${text['reduceTerm.periods']} cuotas.` };
};
const invented = { reply: 'Ahorrarías un 42% de intereses.' }; // rejected by the guard: the template is sent
const asked = (extra = {}) => ({ action: 'advise', debtRef: 'vehiculo', extraMinor: 2000000, ...extra });

describe('simulate', () => {
  it('is read-only: compares the strategies, offers nia:simpay and remembers the amount and strategy', async () => {
    const w = world({ answers: [{ action: 'simulate', debtRef: 'vehiculo', extraMinor: 2000000 }] });
    await handleDebt(w.deps, ctx({ text: 'simula un abono de 2 millones al carro' }));

    expect(w.sent).toHaveLength(1);
    expect(w.sent[0].text).toContain('Simulación de abono extra a Crédito Vehículo');
    expect(w.sent[0].text).toContain('Abono: $ 2.000.000 el 2026-10-13');
    expect(w.sent[0].text).toMatch(/• Reducir plazo: \d+ cuotas de \$ [\d.]+ · ahorras/);
    expect(w.sent[0].text.length).toBeLessThanOrEqual(4096);
    expect(buttons(w.sent[0].keyboard)).toEqual(['nia:simpay']);
    expect(w.lastPending()).toEqual({ kind: 'debt', v: 1, id: 'p1', action: 'simulate', awaiting: 'simpay', debtId: 'd1', draft: { amountMinor: 2000000, strategy: 'reduce_term' } });
    expect(w.sessions[0].status).toBe('awaiting_clarification');
    expect(w.tables.debt_events).toHaveLength(1);
    expect(costRows(w)).toHaveLength(0);
    expect(w.prompts).toHaveLength(1); // the extraction only: a simulation needs no paraphrase
  });

  it('uses the strategy the user asked for, and the web link when one is configured', async () => {
    const mortgage = debtRow('d1', 'Hipoteca', { kind: 'mortgage', termsJson: serializeTerms({ ...loanTerms, kind: 'mortgage', principalMinor: 200000000, n: 360 }) });
    const w = world({ debts: [mortgage], answers: [{ action: 'simulate', extraMinor: 5000000, strategy: 'reduce_installment' }], config: { webUrl: 'https://finanzas.example.com' } });
    w.tables.debt_events = [{ ...disbursement('d1'), amountMinor: 200000000 }];
    await handleDebt(w.deps, ctx());

    expect(w.sent[0].text).toContain('Próximas cuotas (reducir cuota)');
    expect(w.sent[0].text).toMatch(/cuotas más\. Plan completo: https:\/\/finanzas\.example\.com/);
    expect(w.sent[0].text.length).toBeLessThanOrEqual(4096);
    expect(w.lastPending().draft).toEqual({ amountMinor: 5000000, strategy: 'reduce_installment' });
  });

  it('asks for the amount when it is missing', async () => {
    const w = world({ answers: [{ action: 'simulate', debtRef: 'vehiculo' }] });
    await handleDebt(w.deps, ctx());

    expect(w.sent[0].text).toContain('Cuánto quieres abonar');
    expect(w.sent[0].keyboard).toBeUndefined();
  });

  it('asks which debt first when several match, then simulates the chosen one', async () => {
    const w = world({ debts: [debtRow('d1', 'Carro', { lender: 'Banco Uno' }), debtRow('d2', 'Moto', { lender: 'Banco Dos' })], answers: [{ action: 'simulate', debtRef: 'banco', extraMinor: 2000000 }] });
    await handleDebt(w.deps, ctx());

    expect(buttons(w.sent[0].keyboard)).toEqual(['nia:pick:d1', 'nia:pick:d2']);
    expect(w.lastPending()).toMatchObject({ action: 'simulate', awaiting: 'pick', draft: { amountMinor: 2000000 } });

    await handleDebtCallback(w.deps, ctx({ pending: w.lastPending() }), 'nia:pick:d2');
    expect(w.sent[1].text).toContain('Simulación de abono extra a Moto');
    expect(w.lastPending()).toMatchObject({ action: 'simulate', awaiting: 'simpay', debtId: 'd2' });
  });

  it('says politely that cards are not simulated (nor on the web) and keeps the pending request', async () => {
    const w = world({ debts: [debtRow('d1', 'Visa', { kind: 'card' })], answers: [{ action: 'simulate', debtRef: 'visa', extraMinor: 100000 }] });
    const previous = { kind: 'debt', v: 1, id: 'old', awaiting: 'confirm' };
    await handleDebt(w.deps, ctx({ previous, sessionStatus: 'awaiting_confirmation' }));

    expect(w.sent[0].text).toMatch(/préstamos/);
    expect(w.sent[0].text).toMatch(/tarjetas/);
    expect(w.sent[0].keyboard).toBeUndefined();
    expect(w.sessions[0]).toMatchObject({ status: 'awaiting_confirmation', pending: previous });
  });

  it('reports identical strategies honestly on a debt whose system keeps its term', async () => {
    const german = debtRow('d1', 'Crédito Alemán', { termsJson: serializeTerms({ ...loanTerms, system: 'german' }) });
    const w = world({ debts: [german], answers: [{ action: 'simulate', extraMinor: 2000000 }] });
    await handleDebt(w.deps, ctx());

    expect(w.sent[0].text).toContain('Reducir plazo o cuota (mismo resultado)');
  });

  it('explains a debt whose terms cannot be read instead of failing', async () => {
    const w = world({ debts: [debtRow('d1', 'Rota', { termsJson: '{bad' })], answers: [{ action: 'simulate', extraMinor: 2000000 }] });
    await handleDebt(w.deps, ctx());

    expect(w.sent[0].text).toContain('No pude leer los términos');
  });
});

describe('nia:simpay', () => {
  const simulated = async (w) => { await handleDebt(w.deps, ctx()); return w.lastPending(); };
  const extras = (w) => w.tables.debt_events.filter((event) => event.kind === 'extra_payment');

  it('turns a simulation into a pending extra payment with the chosen strategy and writes only after Confirm', async () => {
    const w = world({ answers: [{ action: 'simulate', debtRef: 'vehiculo', extraMinor: 2000000, strategy: 'reduce_installment' }] });
    const pending = await simulated(w);
    await handleDebtCallback(w.deps, ctx({ pending }), 'nia:simpay');

    expect(w.sent[1].text).toContain('Estrategia: reducir cuota');
    expect(buttons(w.sent[1].keyboard)).toContain('nia:confirm');
    expect(w.lastPending()).toMatchObject({ action: 'pay', awaiting: 'confirm', debtId: 'd1', draft: { kind: 'extra_payment', effectiveOn: '2026-10-13', amountMinor: 2000000, strategy: 'reduce_installment' } });
    expect(extras(w)).toHaveLength(0);

    await confirmDebt(w.deps, ctx(), w.lastPending());
    await confirmDebt(w.deps, ctx(), w.lastPending());

    expect(extras(w)).toEqual([expect.objectContaining({ $id: 'dep1', debtId: 'd1', amountMinor: 2000000, dedupeKey: 'debt:p1', source: 'telegram' })]);
    expect(costRows(w)).toHaveLength(1);
    expect(w.sent[3].text).toContain('ya estaba registrado');
  });

  it('writes one event even if the button is tapped twice on the same simulation and both previews are confirmed', async () => {
    const w = world({ answers: [{ action: 'simulate', debtRef: 'vehiculo', extraMinor: 2000000 }] });
    const pending = await simulated(w);
    await handleDebtCallback(w.deps, ctx({ pending }), 'nia:simpay');
    const first = w.lastPending();
    await handleDebtCallback(w.deps, ctx({ pending }), 'nia:simpay');
    await Promise.all([confirmDebt(w.deps, ctx(), first), confirmDebt(w.deps, ctx(), w.lastPending())]);

    expect(extras(w)).toHaveLength(1);
    expect(costRows(w)).toHaveLength(1);
  });

  it('answers that the option no longer applies once the payment preview is on screen', async () => {
    const w = world({ answers: [{ action: 'simulate', debtRef: 'vehiculo', extraMinor: 2000000 }] });
    await handleDebtCallback(w.deps, ctx({ pending: await simulated(w) }), 'nia:simpay');
    await handleDebtCallback(w.deps, ctx({ pending: w.lastPending() }), 'nia:simpay');

    expect(w.sent[2].text).toContain('ya no aplica');
    expect(extras(w)).toHaveLength(0);
  });

  it('records an amount below what is due as a plain payment (no strategy needed)', async () => {
    const w = world({ answers: [{ action: 'simulate', debtRef: 'vehiculo', extraMinor: 300000 }] });
    await handleDebtCallback(w.deps, ctx({ pending: await simulated(w) }), 'nia:simpay');

    expect(w.lastPending()).toMatchObject({ awaiting: 'confirm', draft: { kind: 'payment', amountMinor: 300000 } });
  });

  it('does nothing without a simulation or after the payment was registered', async () => {
    const w = world({ answers: [] });
    await handleDebtCallback(w.deps, ctx({ pending: null }), 'nia:simpay');
    await handleDebtCallback(w.deps, ctx({ pending: { kind: 'debt', v: 1, id: 'p1', action: 'pay', done: true } }), 'nia:simpay');

    expect(w.sent.map((message) => message.text)).toEqual(['No tengo una solicitud de deuda pendiente.', 'No tengo una solicitud de deuda pendiente.']);
    expect(w.sessions).toHaveLength(0);
  });
});

describe('advise', () => {
  const adviseWorld = (answers, extra = {}) => world({ answers: [asked(), ...answers], cashflow: quarter(8000000, 3000000), ...extra });

  it('compares, reads the cash flow, decides in code and sends a faithful paraphrase of the facts', async () => {
    const previous = { kind: 'debt', v: 1, id: 'old', awaiting: 'confirm' };
    const w = adviseWorld([faithful]);
    await handleDebt(w.deps, ctx({ previous, sessionStatus: 'awaiting_confirmation' }));
    const facts = factsIn(w.prompts[1]);

    expect(w.prompts[1]).toContain('Crédito Vehículo');
    expect(facts).toMatchObject({ verdict: 'reduce_term', claimsSavings: true, text: { income: '8.000.000', expense: '3.000.000', margin: '5.000.000' } });
    expect(w.prompts[1]).not.toContain('"numbers"');
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0].text).toBe(`Con un abono de $ ${facts.text.amount} tu tasa es ${facts.text.ea} y te quedarían ${facts.text['reduceTerm.periods']} cuotas.`);
    expect(w.sent[0].keyboard).toBeUndefined();
    expect(w.sessions[0]).toMatchObject({ status: 'awaiting_confirmation', pending: previous });
    expect(w.windows).toHaveLength(1);
    expect(w.windows[0].from < '2026-07-01T05:00:00.000Z' && w.windows[0].to > '2026-10-01T05:00:00.000Z').toBe(true);
    expect(w.tables.debt_events).toHaveLength(1);
    expect(costRows(w)).toHaveLength(0);
  });

  it('sends the deterministic template when the paraphrase invents a number (42%)', async () => {
    const w = adviseWorld([{ reply: 'Ahorrarías un 42% de intereses con este abono.' }]);
    await handleDebt(w.deps, ctx());

    expect(w.sent).toHaveLength(1);
    expect(w.sent[0].text).toContain('Recomendación para un abono de $ 2.000.000');
    expect(w.sent[0].text).toContain('Te conviene reducir el plazo');
    expect(w.sent[0].text).not.toContain('42%');
  });

  it.each([
    ['Gemini fails', new Error('boom')],
    ['Gemini answers no JSON', null],
    ['the reply is not text', { reply: 12345 }],
    ['the reply is empty', { reply: '   ' }],
    ['the reply is over 1200 characters', { reply: 'a'.repeat(1201) }],
    ['the reply is far over the cap', { reply: 'a'.repeat(4097) }],
    ['the reply spells a number out', { reply: 'Pagas cuatro por mil de GMF y te quedan veintiocho cuotas.' }],
  ])('falls back to the template and still completes when %s', async (_name, answer) => {
    const w = adviseWorld([answer]);
    await handleDebt(w.deps, ctx());

    expect(w.sent).toHaveLength(1);
    expect(w.sent[0].text).toContain('Recomendación para un abono');
  });

  it('falls back to the template when Gemini does not answer in time', async () => {
    const w = adviseWorld(['hang'], { config: { paraphraseTimeoutMs: 20 } });
    await handleDebt(w.deps, ctx());

    expect(w.sent).toHaveLength(1);
    expect(w.sent[0].text).toContain('Recomendación para un abono');
  });

  it('a tight margin leads to reduce installment and the facts cite it', async () => {
    const w = adviseWorld([invented], { cashflow: quarter(6000000, 5700000) });
    await handleDebt(w.deps, ctx());

    expect(factsIn(w.prompts[1])).toMatchObject({ verdict: 'reduce_installment', reasonCodes: ['tight_margin'], text: { margin: '300.000' } });
    expect(w.sent[0].text).toContain('reducir la cuota');
  });

  it('another debt with a higher EA wins avalanche; archived, unreadable and out-of-scope debts do not count', async () => {
    const pricier = (id, name, extra = {}) => debtRow(id, name, { termsJson: serializeTerms({ ...loanTerms, rate: { convention: 'EA', value: 35 } }), ...extra });
    const debts = [debtRow('d1', 'Crédito Vehículo', { ownerScope: 'you' }), pricier('d2', 'Tarjeta Oro'), pricier('d3', 'Vieja', { status: 'archived' }), pricier('d4', 'Ajena', { ownerScope: 'partner' }), debtRow('d5', 'Rota', { termsJson: '{bad' })];
    const w = adviseWorld([invented], { debts });
    await handleDebt(w.deps, ctx());
    const facts = factsIn(w.prompts[1]);

    expect(facts).toMatchObject({ verdict: 'avalanche', targetDebt: { id: 'd2', name: 'Tarjeta Oro' }, higherRateDebt: { id: 'd2' } });
    expect(w.sent[0].text).toContain('pagar primero Tarjeta Oro');

    const alone = adviseWorld([invented], { debts: [debtRow('d1', 'Crédito Vehículo', { ownerScope: 'you' }), pricier('d4', 'Ajena', { ownerScope: 'partner' })] });
    await handleDebt(alone.deps, ctx());
    expect(factsIn(alone.prompts[1]).verdict).toBe('reduce_term');
  });

  it('treats an unavailable cash-flow query as unknown and still advises', async () => {
    const w = adviseWorld([invented], { cashflow: new Error('appwrite down') });
    await handleDebt(w.deps, ctx());

    expect(factsIn(w.prompts[1]).reasonCodes).toContain('cashflow_unknown');
    expect(w.sent[0].text).toContain('No hay suficientes ingresos registrados');
  });

  it('uses the configured thresholds', async () => {
    const w = adviseWorld([invented], { cashflow: quarter(6000000, 5000000), config: { adviceThresholds: { tightMarginRatio: 0.2 } } });
    await handleDebt(w.deps, ctx());

    expect(factsIn(w.prompts[1]).verdict).toBe('reduce_installment');
  });

  it('asks for the amount when it is missing', async () => {
    const w = world({ answers: [{ action: 'advise', debtRef: 'vehiculo' }] });
    await handleDebt(w.deps, ctx());

    expect(w.sent[0].text).toContain('Cuánto quieres abonar');
    expect(w.windows).toHaveLength(0);
  });

  it('points cards to the loans without calling Gemini again', async () => {
    const w = world({ debts: [debtRow('d1', 'Visa', { kind: 'card' })], answers: [asked({ debtRef: 'visa' })] });
    await handleDebt(w.deps, ctx());

    expect(w.sent[0].text).toMatch(/préstamos/);
    expect(w.prompts).toHaveLength(1);
  });

  it('picks the debt first when several match, then advises on the chosen one', async () => {
    const w = world({ debts: [debtRow('d1', 'Carro', { lender: 'Banco Uno' }), debtRow('d2', 'Moto', { lender: 'Banco Dos' })], answers: [asked({ debtRef: 'banco' }), invented], cashflow: quarter(8000000, 3000000) });
    await handleDebt(w.deps, ctx());
    await handleDebtCallback(w.deps, ctx({ pending: w.lastPending() }), 'nia:pick:d2');

    expect(w.sent[1].text).toContain('Recomendación para un abono de $ 2.000.000 a Moto');
  });
});

describe('debtSummaries (the code-computed figures behind the analysis snapshot)', () => {
  it('returns balance, next due and EA per debt, flags unreadable ones and skips archived ones', async () => {
    const w = world({ debts: [debtRow('d1', 'Crédito Vehículo', { ownerScope: 'you' }), debtRow('d2', 'Rota', { termsJson: '{bad' }), debtRow('d3', 'Vieja', { status: 'archived' })] });
    const items = await debtSummaries(w.deps);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ id: 'd1', name: 'Crédito Vehículo', ownerScope: 'you', balanceMinor: 10000000, pastDueMinor: 380381, nextDue: { dueOn: '2026-10-10', amountMinor: 380381 } });
    expect(items[0].eaPercent).toBeCloseTo(24, 6);
    expect(items[1]).toEqual({ id: 'd2', name: 'Rota', ownerScope: 'shared', unreadable: true });
  });
});

describe('debtSummaries for a card', () => {
  const cardTerms = { kind: 'card', principalMinor: 500000, openedOn: '2026-04-01', system: 'none', periodicity: 'monthly', rate: { value: 28, basis: 'effective', periodicity: 'annual', timing: 'arrears' }, card: { statementDay: 15, dueDay: 30, minPayment: { rule: 'interest_fees_plus_pct', pct: 5, floorMinor: 20000 } } };
  const rateChange = (id, value) => ({ $id: id, debtId: 'c1', householdId: 'h1', kind: 'rate_change', effectiveOn: '2026-05-01', amountMinor: 0, payloadJson: JSON.stringify({ rate: { value, basis: 'effective', periodicity: 'annual', timing: 'arrears' }, mode: 'keep_term' }), actorId: ACTOR, source: 'telegram', dedupeKey: `seed:${id}`, $createdAt: '2026-05-01T12:00:00.000Z' });
  const voidOf = (id, targetEventId) => ({ $id: id, debtId: 'c1', householdId: 'h1', kind: 'void', effectiveOn: '2026-05-02', amountMinor: 0, payloadJson: JSON.stringify({ targetEventId, reason: 'x' }), actorId: ACTOR, source: 'telegram', dedupeKey: `seed:${id}`, $createdAt: '2026-05-02T12:00:00.000Z' });
  const summary = async (extraEvents) => {
    const w = world({ debts: [debtRow('c1', 'Visa', { kind: 'card', termsJson: serializeTerms(cardTerms) })] });
    w.tables.debt_events.push(...extraEvents);
    return (await debtSummaries(w.deps))[0];
  };

  it('reports the rate in force after an active rate change, and the original one once it is voided', async () => {
    expect((await summary([rateChange('r1', 24)])).eaPercent).toBeCloseTo(24, 6);
    expect((await summary([rateChange('r1', 24), voidOf('v1', 'r1')])).eaPercent).toBeCloseTo(28, 6);
  });
});

describe('household legal rates (A2)', () => {
  const USURY = { $id: 'lr1', householdId: 'h1', kind: 'usury', modality: 'consumer', validFrom: '2026-10-01', validTo: '2026-10-31', value: 2900, source: 'Resolución', verified: true };
  const missingTable = () => Object.assign(new Error('GET /tables/legal_rates/rows → 404: Table not found'), { status: 404 });
  const capOf = (legal) => legal.usuryTable.find((entry) => entry.modality === 'consumer' && entry.validFrom === '2026-10-01').capEA;

  it('loadLegal resolves the household rows over the code tables', async () => {
    const legal = await loadLegal(world({ legalRows: [USURY] }).deps);

    expect(legal.status).toBe('table');
    expect(capOf(legal)).toBe(29);
  });

  it('loadLegal with an empty table resolves to the code defaults', async () => {
    const legal = await loadLegal(world().deps);

    expect(legal.status).toBe('defaults');
    expect(capOf(legal)).toBe(28.59);
  });

  it.each([
    ['a 404 (migration not run)', missingTable()],
    ['a server error', Object.assign(new Error('boom'), { status: 500 })],
    ['a failure with no status', new Error('network')],
  ])('loadLegal survives %s with the unavailable fallback and the code tables', async (_label, legalError) => {
    const legal = await loadLegal(world({ legalError }).deps);

    expect(legal.status).toBe('unavailable');
    expect(capOf(legal)).toBe(28.59);
  });

  it('loadDebts decorates every debt with the same resolved tables', async () => {
    const w = world({ debts: [debtRow('d1', 'Carro'), debtRow('d2', 'Moto')], legalRows: [USURY] });

    const debts = await loadDebts(w.deps);

    expect(debts.map((debt) => debt.$id)).toEqual(['d1', 'd2']);
    expect(debts.map((debt) => capOf(debt.legal))).toEqual([29, 29]);
    expect(debts[0].legal).toBe(debts[1].legal);
    expect(debts[0]).toMatchObject({ name: 'Carro', kind: 'vehicle' });
  });

  it('loadDebts still returns the debts, with the unavailable fallback, when legal_rates cannot be read', async () => {
    const w = world({ debts: [debtRow('d1', 'Carro')], legalError: missingTable() });

    const debts = await loadDebts(w.deps);

    expect(debts).toHaveLength(1);
    expect(debts[0].legal.status).toBe('unavailable');
    expect(capOf(debts[0].legal)).toBe(28.59);
  });

  it('only reads legal_rates for this household', async () => {
    const w = world({ legalRows: [USURY, { ...USURY, $id: 'lr2', householdId: 'other', value: 2500 }] });

    expect(capOf(await loadLegal(w.deps))).toBe(29);
  });

  it('a payment still previews and confirms when the legal rates cannot be read', async () => {
    const w = world({ answers: [payAnswer()], legalError: missingTable() });
    await handleDebt(w.deps, ctx({ text: 'pagué 380 mil al carro' }));
    await confirmDebt(w.deps, ctx(), w.lastPending());

    expect(w.sent[0].text).toContain('Abono a Crédito Vehículo');
    expect(w.tables.debt_events.filter((event) => event.kind === 'payment')).toHaveLength(1);
  });

  it('a new loan above the household cap cites 29 % and not the code 28.59 %', async () => {
    const w = world({ debts: [], answers: [loanAnswer({ rate: { value: 29.5, period: 'annual' } })], legalRows: [USURY] });
    await handleDebt(w.deps, ctx());

    expect(w.sent[0].text).toContain('tope de usura de 29% E.A.');
    expect(w.sent[0].text).not.toContain('No pude leer las tasas legales');
  });

  it('a new loan above the cap adds one line when the legal rates were unavailable, and still previews', async () => {
    const w = world({ debts: [], answers: [loanAnswer({ rate: { value: 30, period: 'annual' } })], legalError: missingTable() });
    await handleDebt(w.deps, ctx());

    expect(w.sent[0].text).toContain('tope de usura de 28.59% E.A.');
    expect(w.sent[0].text.split('No pude leer las tasas legales del hogar')).toHaveLength(2);
    expect(buttons(w.sent[0].keyboard)).toContain('nia:confirm');
  });

  it('the convention buttons keep the household cap in the preview that follows', async () => {
    const w = world({ debts: [], answers: [loanAnswer({ rate: { value: 2.5, period: 'monthly' } })], legalRows: [USURY] });
    await handleDebt(w.deps, ctx());
    await handleDebtCallback(w.deps, ctx({ pending: w.lastPending() }), 'nia:conv:MV');

    expect(w.sent[1].text).toContain('Tasa: 2.5% MV ≈ 34.49% EA');
    expect(w.sent[1].text).toContain('tope de usura de 29% E.A.');
  });
});

describe('legal_rate (E1)', () => {
  const legalAnswer = (legal = {}, extra = {}) => ({ action: 'legal_rate', legal: { kind: 'usury', modality: 'consumer', month: 'noviembre', year: null, value: 28.2, ...legal }, ...extra });
  const NOV_ID = 'lruco202611h1';
  const novRow = (extra = {}) => ({ $id: NOV_ID, householdId: 'h1', kind: 'usury', modality: 'consumer', validFrom: '2026-11-01', validTo: '2026-11-30', value: 2700, source: 'Resolución', verified: true, actorId: 'u0', ...extra });
  const preview = async (w, text = 'la usura de noviembre es 28.2') => { await handleDebt(w.deps, ctx({ text })); return w.lastPending(); };

  it('previews kind, modality, month and value, asks for Confirm and writes nothing', async () => {
    const w = world({ debts: [], answers: [legalAnswer()] });
    const pending = await preview(w);

    expect(w.sent).toHaveLength(1);
    expect(w.sent[0].text).toContain('Tasa de usura');
    expect(w.sent[0].text).toContain('Modalidad: consumo y ordinario');
    expect(w.sent[0].text).toContain('Mes: noviembre de 2026');
    expect(w.sent[0].text).toContain('Valor: 28.20% E.A.');
    expect(buttons(w.sent[0].keyboard)).toEqual(['nia:confirm', 'nia:edit', 'nia:cancel']);
    expect(w.sessions[0].status).toBe('awaiting_confirmation');
    expect(pending).toEqual({ kind: 'debt', v: 1, id: 'p1', action: 'legal_rate', awaiting: 'confirm', draft: { kind: 'usury', modality: 'consumer', validFrom: '2026-11-01', validTo: '2026-11-30', value: 2820 } });
    expect(Buffer.byteLength(JSON.stringify(pending), 'utf8')).toBeLessThan(1500);
    expect(w.tables.legal_rates).toEqual([]);
  });

  it('works without any debt', async () => {
    const w = world({ debts: [], answers: [legalAnswer()] });
    await preview(w);

    expect(w.prompts[0]).toContain('No hay deudas registradas');
    expect(w.sent[0].text).toContain('Valor: 28.20% E.A.');
  });

  it('Confirm writes one row with the deterministic id, basis points and the user as author', async () => {
    const w = world({ debts: [], answers: [legalAnswer()] });
    const pending = await preview(w);
    await confirmDebt(w.deps, ctx(), pending);

    expect(w.tables.legal_rates).toEqual([expect.objectContaining({
      $id: NOV_ID,
      householdId: 'h1',
      kind: 'usury',
      modality: 'consumer',
      validFrom: '2026-11-01',
      validTo: '2026-11-30',
      value: 2820,
      verified: false,
      actorId: ACTOR,
    })]);
    expect(w.tables.legal_rates[0].source).toContain('Nia');
    expect(w.updates).toEqual([]);
    expect(w.sent[1].text).toContain('Listo: registré la tasa de usura (consumo y ordinario) de noviembre de 2026: 28.20% E.A.');
    expect(w.sessions[1].status).toBe('completed');
    expect(w.lastPending()).toEqual({ kind: 'debt', v: 1, id: 'p1', action: 'legal_rate', done: true });
  });

  it('a second Confirm leaves one row and answers that it was already registered', async () => {
    const w = world({ debts: [], answers: [legalAnswer()] });
    const pending = await preview(w);
    await confirmDebt(w.deps, ctx(), pending);
    await confirmDebt(w.deps, ctx(), w.lastPending());

    expect(w.tables.legal_rates).toHaveLength(1);
    expect(w.sent[2].text).toContain('ya estaba registrad');
    expect(w.updates).toEqual([]);
  });

  it('even the same pending confirmed twice before the session is marked done leaves one row', async () => {
    const w = world({ debts: [], answers: [legalAnswer()] });
    const pending = await preview(w);
    await confirmDebt(w.deps, ctx(), pending);
    await confirmDebt(w.deps, ctx(), pending); // a Telegram retry that read the session before it was marked done

    expect(w.tables.legal_rates).toHaveLength(1);
    expect(w.tables.legal_rates[0]).toMatchObject({ $id: NOV_ID, value: 2820 });
  });

  it('updates the row of the same key (409, then updateRow) and says it was an update', async () => {
    const w = world({ debts: [], legalRows: [novRow()], answers: [legalAnswer()] });
    const pending = await preview(w);
    await confirmDebt(w.deps, ctx(), pending);

    expect(w.tables.legal_rates).toHaveLength(1);
    expect(w.updates).toHaveLength(1);
    expect(w.updates[0]).toMatchObject({ table: 'legal_rates', id: NOV_ID, data: { value: 2820, kind: 'usury', modality: 'consumer', verified: false, actorId: ACTOR } });
    expect(w.tables.legal_rates[0]).toMatchObject({ value: 2820, verified: false, actorId: ACTOR });
    expect(w.sent[1].text).toContain('Listo: actualicé la tasa de usura');
    expect(w.sent[1].text).not.toContain('registré');
    expect(w.lastPending()).toMatchObject({ done: true });
  });

  it('another month or another modality is another row, not an update', async () => {
    const w = world({ debts: [], legalRows: [novRow()], answers: [legalAnswer({ month: 'diciembre' }), legalAnswer({ modality: 'hipotecario' })] });
    await confirmDebt(w.deps, ctx(), await preview(w));
    await confirmDebt(w.deps, ctx(), await preview(w));

    expect(w.updates).toEqual([]);
    expect(w.tables.legal_rates.map((row) => row.$id)).toEqual([NOV_ID, 'lruco202612h1', 'lrumg202611h1']);
  });

  it('a failed update keeps the pending untouched so Confirm can be tapped again', async () => {
    const failure = Object.assign(new Error('boom'), { status: 500 });
    const w = world({ debts: [], legalRows: [novRow()], answers: [legalAnswer()], updateError: failure });
    const pending = await preview(w);

    await expect(confirmDebt(w.deps, ctx(), pending)).rejects.toBe(failure);
    expect(w.sessions).toHaveLength(1);
    expect(w.tables.legal_rates[0].value).toBe(2700);
  });

  it('an IBC shows the usury cap it implies and is stored as an IBC row only', async () => {
    const w = world({ debts: [], answers: [legalAnswer({ kind: 'ibc', value: 19.49 })] });
    const pending = await preview(w, 'el IBC de noviembre es 19.49');

    expect(w.sent[0].text).toContain('Valor: 19.49% E.A.');
    expect(w.sent[0].text).toContain('Tope de usura que resulta: 29.24% E.A.');
    await confirmDebt(w.deps, ctx(), pending);
    expect(w.tables.legal_rates).toEqual([expect.objectContaining({ $id: 'lrico202611h1', kind: 'ibc', value: 1949 })]);
    expect(w.sent[1].text).toContain('registré el IBC (consumo y ordinario) de noviembre de 2026: 19.49% E.A.');
  });

  it('the SMMLV of a year is stored in whole pesos for the whole year', async () => {
    const w = world({ debts: [], answers: [{ action: 'legal_rate', legal: { kind: 'smmlv', value: 1750905, year: 2027 } }] });
    const pending = await preview(w, 'el salario mínimo de 2027 es 1.750.905');

    expect(w.sent[0].text).toContain('Año: 2027');
    expect(w.sent[0].text).toContain('Valor: $ 1.750.905');
    await confirmDebt(w.deps, ctx(), pending);
    expect(w.tables.legal_rates).toEqual([expect.objectContaining({ $id: 'lrsal202701h1', kind: 'smmlv', modality: 'all', validFrom: '2027-01-01', validTo: '2027-12-31', value: 1750905 })]);
  });

  it('resolves a month without a year against today and previews the year it chose', async () => {
    const w = world({ debts: [], answers: [legalAnswer({ month: 'enero' }), legalAnswer({ month: 'mayo' })] });
    await preview(w);
    await preview(w);

    expect(w.sent[0].text).toContain('Mes: enero de 2027');
    expect(w.sent[1].text).toContain('Mes: mayo de 2026');
  });

  it('refuses 2.82 asking for a correction, and keeps the pending request as it was', async () => {
    const w = world({ debts: [], answers: [legalAnswer({ value: 2.82 })] });
    await handleDebt(w.deps, ctx());

    expect(w.sent).toHaveLength(1);
    expect(w.sent[0].text).toContain('entre 5 % y 100 %');
    expect(w.sent[0].keyboard).toBeUndefined();
    expect(w.sessions[0].pending).toBeNull();
    expect(w.tables.legal_rates).toEqual([]);
  });

  it('refuses an SMMLV out of range and an IBC for a mortgage, each with its own explanation', async () => {
    const w = world({ debts: [], answers: [{ action: 'legal_rate', legal: { kind: 'smmlv', value: 1750 } }, legalAnswer({ kind: 'ibc', modality: 'hipotecario', value: 19.49 })] });
    await handleDebt(w.deps, ctx());
    await handleDebt(w.deps, ctx());

    expect(w.sent[0].text).toContain('salario mínimo');
    expect(w.sent[0].text).toContain('100.000');
    expect(w.sent[1].text).toContain('hipoteca');
    expect(w.sent[1].text).toContain('tasa de usura');
    expect(w.tables.legal_rates).toEqual([]);
    expect(w.sessions.map((session) => session.pending)).toEqual([null, null]);
  });

  it('asks for what is missing: the month, or the kind and the value', async () => {
    const w = world({ debts: [], answers: [legalAnswer({ month: null }), { action: 'legal_rate', legal: null }] });
    await handleDebt(w.deps, ctx());
    await handleDebt(w.deps, ctx());

    expect(w.sent[0].text).toBe('Para registrar la tasa legal necesito: el mes.');
    expect(w.sent[1].text).toBe('Para registrar la tasa legal necesito: si es la tasa de usura, el IBC o el salario mínimo, el valor.');
    expect(w.tables.legal_rates).toEqual([]);
  });

  it('previews even when the legal rates of the household cannot be read', async () => {
    const w = world({ debts: [], answers: [legalAnswer()], legalError: Object.assign(new Error('404'), { status: 404 }) });
    await handleDebt(w.deps, ctx());

    expect(w.sent[0].text).toContain('Valor: 28.20% E.A.');
    expect(buttons(w.sent[0].keyboard)).toContain('nia:confirm');
  });

  it('does not trust a pending whose value is out of range', async () => {
    const w = world({ debts: [] });
    const pending = { kind: 'debt', v: 1, id: 'p1', action: 'legal_rate', awaiting: 'confirm', draft: { kind: 'usury', modality: 'consumer', validFrom: '2026-11-01', validTo: '2026-11-30', value: 50 } };
    await confirmDebt(w.deps, ctx(), pending);

    expect(w.tables.legal_rates).toEqual([]);
    expect(w.sent[0].text).toContain('No pude guardar esa tasa');
    expect(w.sessions).toEqual([]);
  });

  it('ignores a strategy or convention button while a legal rate waits for Confirm', async () => {
    const w = world({ debts: [], answers: [legalAnswer()] });
    await preview(w);
    await handleDebtCallback(w.deps, ctx({ pending: w.lastPending() }), 'nia:strat:reduce_term');

    expect(w.sent[1].text).toContain('ya no aplica');
    expect(w.tables.legal_rates).toEqual([]);
  });
});

describe('rate_change (E2)', () => {
  const rateAnswer = (extra = {}) => ({ action: 'rate_change', debtRef: 'vehiculo', rate: { value: 22, period: 'annual' }, planChange: { effectiveOn: null, mode: null }, ...extra });
  const planOf = (planChange) => rateAnswer({ planChange: { effectiveOn: null, mode: null, ...planChange } });
  const rateEvents = (w) => w.tables.debt_events.filter((event) => event.kind === 'rate_change');
  const cardTerms = { kind: 'card', principalMinor: 500000, openedOn: '2026-04-01', system: 'none', periodicity: 'monthly', rate: { value: 28, basis: 'effective', periodicity: 'annual', timing: 'arrears' }, card: { statementDay: 15, dueDay: 30, minPayment: { rule: 'interest_fees_plus_pct', pct: 5, floorMinor: 20000 } } };
  const cardRow = () => debtRow('c1', 'Visa', { kind: 'card', termsJson: serializeTerms(cardTerms) });

  // Starts a request for the French loan and answers the mode question: the way a user reaches the preview.
  async function previewed(w, mode = 'keep_term') {
    await handleDebt(w.deps, ctx({ text: 'bajó la tasa del carro a 22% EA' }));
    await handleDebtCallback(w.deps, ctx({ pending: w.lastPending() }), `nia:mode:${mode}`);
    return w.lastPending();
  }

  it('asks keep_term or keep_installment for a French loan, writing nothing', async () => {
    const w = world({ answers: [rateAnswer()] });
    await handleDebt(w.deps, ctx({ text: 'bajó la tasa del carro a 22% EA desde hoy' }));

    expect(w.sent).toHaveLength(1);
    expect(w.sent[0].text).toContain('Crédito Vehículo');
    expect(buttons(w.sent[0].keyboard)).toEqual(['nia:mode:keep_term', 'nia:mode:keep_installment']);
    expect(w.sessions[0].status).toBe('awaiting_clarification');
    expect(w.lastPending()).toMatchObject({ kind: 'debt', id: 'p1', action: 'rate_change', awaiting: 'mode', debtId: 'd1', draft: { effectiveOn: '2026-10-13', rate: { value: 22, basis: 'effective', periodicity: 'annual', timing: 'arrears' } } });
    expect(w.tables.debt_events).toHaveLength(1);
  });

  it('shows the preview after the mode button and waits for confirmation', async () => {
    const w = world({ answers: [rateAnswer()] });
    const pending = await previewed(w, 'keep_installment');

    expect(w.sent[1].text).toContain('Cambio de tasa en Crédito Vehículo');
    expect(w.sent[1].text).toContain('Nueva tasa: 22% EA');
    expect(w.sent[1].text).toContain('Se mantiene la cuota');
    expect(buttons(w.sent[1].keyboard)).toEqual(['nia:confirm', 'nia:edit', 'nia:cancel']);
    expect(w.sessions[1].status).toBe('awaiting_confirmation');
    expect(pending).toMatchObject({ action: 'rate_change', awaiting: 'confirm', debtId: 'd1', draft: { effectiveOn: '2026-10-13', mode: 'keep_installment', rate: { value: 22 } } });
    expect(Buffer.byteLength(JSON.stringify(pending), 'utf8')).toBeLessThanOrEqual(1500);
    expect(rateEvents(w)).toHaveLength(0);
  });

  it('goes straight to the preview when the user already said the mode, or the system has no choice', async () => {
    const said = world({ answers: [planOf({ mode: 'keep_term' })] });
    await handleDebt(said.deps, ctx());
    expect(said.sent[0].text).toContain('Se mantiene el plazo');
    expect(said.lastPending()).toMatchObject({ awaiting: 'confirm', draft: { mode: 'keep_term' } });

    const german = debtRow('d1', 'Crédito Alemán', { termsJson: serializeTerms({ ...loanTerms, system: 'german' }) });
    const fixed = world({ debts: [german], answers: [rateAnswer({ debtRef: 'aleman' })] });
    await handleDebt(fixed.deps, ctx());
    expect(buttons(fixed.sent[0].keyboard)).toEqual(['nia:confirm', 'nia:edit', 'nia:cancel']);
    expect(fixed.lastPending().draft.mode).toBe('keep_term');
  });

  it('sends keep_term for a card and never asks for a mode', async () => {
    const w = world({ debts: [cardRow()], answers: [rateAnswer({ debtRef: 'visa', rate: { value: 35, period: 'annual' } })] });
    w.tables.debt_events = [];
    await handleDebt(w.deps, ctx());

    expect(w.sent[0].text).toContain('Cambio de tasa en Visa');
    expect(w.sent[0].text).toContain('Próximo pago mínimo');
    expect(buttons(w.sent[0].keyboard)).toEqual(['nia:confirm', 'nia:edit', 'nia:cancel']);
    expect(w.lastPending()).toMatchObject({ awaiting: 'confirm', draft: { mode: 'keep_term' } });

    await confirmDebt(w.deps, ctx(), w.lastPending());
    expect(rateEvents(w)).toHaveLength(1);
    expect(JSON.parse(rateEvents(w)[0].payloadJson)).toMatchObject({ mode: 'keep_term', rate: { value: 35 } });
  });

  it('asks for the convention first when the rate is ambiguous, then continues with the mode', async () => {
    const w = world({ answers: [rateAnswer({ rate: { value: 2, period: 'monthly' } })] });
    await handleDebt(w.deps, ctx({ text: 'la tasa ahora es 2% mensual' }));

    expect(w.sent[0].text).toContain('2%');
    expect(buttons(w.sent[0].keyboard)).toEqual(['nia:conv:EA', 'nia:conv:NAMV', 'nia:conv:MV', 'nia:conv:NATV', 'nia:conv:NATA']);
    expect(w.lastPending()).toMatchObject({ action: 'rate_change', awaiting: 'convention', debtId: 'd1', draft: { rateValue: 2, effectiveOn: '2026-10-13' } });
    expect(w.lastPending().draft.rate).toBeUndefined();

    await handleDebtCallback(w.deps, ctx({ pending: w.lastPending() }), 'nia:conv:MV');
    expect(buttons(w.sent[1].keyboard)).toEqual(['nia:mode:keep_term', 'nia:mode:keep_installment']);
    expect(w.lastPending()).toMatchObject({ awaiting: 'mode', draft: { rate: { value: 2, basis: 'effective', periodicity: 'monthly', timing: 'arrears' } } });

    await handleDebtCallback(w.deps, ctx({ pending: w.lastPending() }), 'nia:mode:keep_term');
    expect(w.sent[2].text).toContain('Nueva tasa: 2% MV ≈ 26.82% EA');
    expect(rateEvents(w)).toHaveLength(0);
  });

  it('still routes a create convention to the create flow', async () => {
    const w = world({ answers: [loanAnswer({ rate: { value: 2, period: 'monthly' } })] });
    await handleDebt(w.deps, ctx());
    await handleDebtCallback(w.deps, ctx({ pending: w.lastPending() }), 'nia:conv:MV');

    expect(w.sent[1].text).toContain('Nueva deuda');
    expect(w.lastPending()).toMatchObject({ action: 'create', awaiting: 'confirm' });
  });

  it('asks which debt first when several match, then continues the change', async () => {
    const w = world({ debts: [debtRow('d1', 'Carro', { lender: 'Banco Uno' }), debtRow('d2', 'Moto', { lender: 'Banco Dos' })], answers: [rateAnswer({ debtRef: 'banco' })] });
    await handleDebt(w.deps, ctx());

    expect(buttons(w.sent[0].keyboard)).toEqual(['nia:pick:d1', 'nia:pick:d2']);
    expect(w.lastPending()).toMatchObject({ action: 'rate_change', awaiting: 'pick', candidates: ['d1', 'd2'] });

    await handleDebtCallback(w.deps, ctx({ pending: w.lastPending() }), 'nia:pick:d2');
    expect(buttons(w.sent[1].keyboard)).toEqual(['nia:mode:keep_term', 'nia:mode:keep_installment']);
    expect(w.lastPending()).toMatchObject({ awaiting: 'mode', debtId: 'd2' });
  });

  it('asks for the new rate when it is missing', async () => {
    const w = world({ answers: [rateAnswer({ rate: null })] });
    await handleDebt(w.deps, ctx());

    expect(w.sent[0].text).toContain('la tasa de interés');
    expect(w.sent[0].keyboard).toBeUndefined();
    expect(w.sessions[0].pending).toBeNull();
  });

  it('explains installment_too_low and shows the keep_term preview instead', async () => {
    const w = world({ answers: [rateAnswer({ rate: { value: 700, period: 'annual' } })] });
    await previewed(w, 'keep_installment');

    expect(w.sent[1].text).toContain('ya no cubre los intereses');
    expect(w.sent[1].text).toContain('Se mantiene el plazo');
    expect(w.lastPending().draft.mode).toBe('keep_term');
    expect(rateEvents(w)).toHaveLength(0);
  });

  it('cites the household usury cap in the preview without blocking', async () => {
    const cap = { $id: 'lr1', householdId: 'h1', kind: 'usury', modality: 'consumer', validFrom: '2026-10-01', validTo: '2026-10-31', value: 2900, source: 'Resolución', verified: true };
    const w = world({ legalRows: [cap], answers: [rateAnswer({ rate: { value: 30, period: 'annual' } })] });
    await previewed(w);

    expect(w.sent[1].text).toContain('supera el tope de usura de 29% E.A.');
    expect(buttons(w.sent[1].keyboard)).toContain('nia:confirm');
  });

  it('notes that earlier costs update on the web when a backdated change touches a recorded payment', async () => {
    const w = world({ answers: [planOf({ effectiveOn: '2026-09-10' })] });
    w.tables.debt_events.push({ ...disbursement('d1'), $id: 'pay1', kind: 'payment', effectiveOn: '2026-10-10', amountMinor: 380381, dedupeKey: 'seed:pay1' });
    await previewed(w);

    expect(w.sent[1].text).toContain('Los costos de pagos anteriores se actualizarán cuando abras la deuda en la web.');
  });

  describe('Confirm', () => {
    it('writes one rate_change event with the pending-derived ids and reports the written figures', async () => {
      const w = world({ answers: [rateAnswer()] });
      const pending = await previewed(w);
      await confirmDebt(w.deps, ctx(), pending);

      expect(rateEvents(w)).toHaveLength(1);
      expect(rateEvents(w)[0]).toMatchObject({ $id: 'dep1', dedupeKey: 'debt:p1', debtId: 'd1', effectiveOn: '2026-10-13', source: 'telegram', actorId: ACTOR });
      expect(JSON.parse(rateEvents(w)[0].payloadJson)).toEqual({ rate: { value: 22, basis: 'effective', periodicity: 'annual', timing: 'arrears' }, mode: 'keep_term' });
      expect(costRows(w)).toHaveLength(0);
      expect(w.sent[2].text).toContain('registré el cambio de tasa de Crédito Vehículo');
      expect(w.sent[2].text).toContain('22% EA');
      expect(w.sent[2].text).toContain('Cuota:');
      expect(w.sessions[2]).toMatchObject({ status: 'completed', pending: { kind: 'debt', v: 1, id: 'p1', action: 'rate_change', done: true } });
    });

    it('answers "ya estaba registrado" to a second Confirm and writes one event for a double tap', async () => {
      const w = world({ answers: [rateAnswer()] });
      const pending = await previewed(w);
      await confirmDebt(w.deps, ctx(), pending);
      await confirmDebt(w.deps, ctx(), pending); // Telegram retry that read the session before the done marker
      await confirmDebt(w.deps, ctx(), w.lastPending()); // a tap after the first one finished

      expect(rateEvents(w)).toHaveLength(1);
      expect(w.sent.slice(2).map((call) => /ya estaba registrado/.test(call.text))).toEqual([false, true, true]);
    });

    it('writes one event when two Confirms race', async () => {
      const w = world({ answers: [rateAnswer()] });
      const pending = await previewed(w);
      await Promise.all([confirmDebt(w.deps, ctx(), pending), confirmDebt(w.deps, ctx(), pending)]);

      expect(rateEvents(w)).toHaveLength(1);
    });

    it('rebuilds from the live debt: a payment recorded after the preview is part of the written figures', async () => {
      const w = world({ answers: [rateAnswer()] });
      const pending = await previewed(w);
      w.tables.debt_events.push({ ...disbursement('d1'), $id: 'pay1', kind: 'payment', effectiveOn: '2026-10-12', amountMinor: 380381, dedupeKey: 'seed:pay1' });
      await confirmDebt(w.deps, ctx(), pending);

      expect(rateEvents(w)).toHaveLength(1);
      expect(w.sent[2].text).toContain('Cuotas restantes: 35');
    });

    it('writes nothing and says so when the debt is gone', async () => {
      const w = world({ answers: [rateAnswer()] });
      const pending = await previewed(w);
      w.tables.debts = [];
      await confirmDebt(w.deps, ctx(), pending);

      expect(rateEvents(w)).toHaveLength(0);
      expect(w.sent[2].text).toContain('No encontré esa deuda');
      expect(w.sessions).toHaveLength(2);
    });

    it('writes nothing and suggests keep_term when keep_installment no longer covers the interest', async () => {
      const w = world({ answers: [rateAnswer()] });
      const pending = await previewed(w, 'keep_installment');
      const forged = { ...pending, draft: { ...pending.draft, rate: { value: 700, basis: 'effective', periodicity: 'annual', timing: 'arrears' } } };
      await confirmDebt(w.deps, ctx(), forged);

      expect(rateEvents(w)).toHaveLength(0);
      expect(w.sent[2].text).toContain('mantener el plazo');
      expect(w.sessions).toHaveLength(2);
    });

    it('does not confirm while the mode or the convention is still pending', async () => {
      const w = world({ answers: [rateAnswer()] });
      await handleDebt(w.deps, ctx());
      await confirmDebt(w.deps, ctx(), w.lastPending());

      expect(rateEvents(w)).toHaveLength(0);
      expect(w.sent[1].text).toContain('Antes de confirmar');
    });
  });

  describe('stale buttons', () => {
    it('ignores a mode button when the pending is already waiting for confirmation, with a short message and no write', async () => {
      const w = world({ answers: [rateAnswer()] });
      const pending = await previewed(w);
      const before = w.sessions.length;
      await handleDebtCallback(w.deps, ctx({ pending }), 'nia:mode:keep_installment');

      expect(w.sent[2].text).toContain('ya no aplica');
      expect(w.sessions).toHaveLength(before);
      expect(rateEvents(w)).toHaveLength(0);
    });

    it('ignores a mode button from a confirmed pending and from another action', async () => {
      const w = world({ answers: [rateAnswer(), payAnswer({ amountMinor: 1000000 })] });
      const pending = await previewed(w);
      await confirmDebt(w.deps, ctx(), pending);
      await handleDebtCallback(w.deps, ctx({ pending: w.lastPending() }), 'nia:mode:keep_term');
      expect(w.sent[3].text).toContain('No tengo una solicitud');

      await handleDebt(w.deps, ctx());
      await handleDebtCallback(w.deps, ctx({ pending: w.lastPending() }), 'nia:mode:keep_term'); // a payment waiting for its strategy
      expect(w.sent[w.sent.length - 1].text).toContain('ya no aplica');
      expect(rateEvents(w)).toHaveLength(1);
    });

    it('ignores a convention button for an action that takes no convention', async () => {
      const w = world({ answers: [payAnswer({ amountMinor: 1000000 })] });
      await handleDebt(w.deps, ctx());
      await handleDebtCallback(w.deps, ctx({ pending: w.lastPending() }), 'nia:conv:EA');

      expect(w.sent[1].text).toContain('ya no aplica');
      expect(w.tables.debt_events).toHaveLength(1);
    });
  });
});

describe('charge_change (E2)', () => {
  const CHARGES = [
    { id: 'life', kind: 'insurance', label: 'Seguro de vida', basis: 'pctOutstanding', value: 0.05, cadence: 'per_installment' },
    { id: 'fee', kind: 'fee', label: 'Cuota de manejo', basis: 'fixed', value: 10000, cadence: 'per_installment' },
    { id: 'iva', kind: 'tax', label: 'IVA', basis: 'pctOfCharge', refId: 'fee', value: 19, cadence: 'per_installment' },
  ];
  const chargedRow = (id = 'd1', name = 'Crédito Vehículo', extra = {}) => debtRow(id, name, { termsJson: serializeTerms({ ...loanTerms, charges: CHARGES }), ...extra });
  const changeAnswer = (planChange = {}, extra = {}) => ({ action: 'charge_change', debtRef: 'vehiculo', planChange: { effectiveOn: null, mode: null, chargeRef: 'seguro de vida', op: 'remove', newValue: null, ...planChange }, ...extra });
  const chargeEvents = (w) => w.tables.debt_events.filter((event) => event.kind === 'charge_change');
  const chargeWorld = (answers, extra = {}) => world({ debts: [chargedRow()], answers, ...extra });

  it('previews the removal of an insurance with the new installment, writes nothing, and keeps a tiny pending', async () => {
    const w = chargeWorld([changeAnswer()]);
    await handleDebt(w.deps, ctx({ text: 'quita el seguro de vida del carro' }));

    expect(w.sent).toHaveLength(1);
    expect(w.sent[0].text).toContain('Cambio de cargos en Crédito Vehículo');
    expect(w.sent[0].text).toContain('Se quita: Seguro de vida');
    expect(w.sent[0].text).toContain('Próxima cuota (con cargos)');
    expect(buttons(w.sent[0].keyboard)).toEqual(['nia:confirm', 'nia:edit', 'nia:cancel']);
    expect(w.sessions[0].status).toBe('awaiting_confirmation');
    expect(w.lastPending()).toMatchObject({ kind: 'debt', action: 'charge_change', awaiting: 'confirm', debtId: 'd1', draft: { effectiveOn: '2026-10-13', chargeId: 'life', op: 'remove', newValue: null } });
    expect(Buffer.byteLength(JSON.stringify(w.lastPending()), 'utf8')).toBeLessThan(400);
    expect(chargeEvents(w)).toHaveLength(0);
  });

  it('refuses to add a charge, pointing to the web, without even looking for a debt', async () => {
    const w = chargeWorld([changeAnswer({ op: 'add', chargeRef: 'seguro de desempleo', newValue: 20000 })]);
    await handleDebt(w.deps, ctx({ text: 'agrega un seguro de desempleo al carro' }));

    expect(w.sent).toHaveLength(1);
    expect(w.sent[0].text).toContain('web');
    expect(w.sent[0].text).toContain('Cambiar seguros y cargos');
    expect(w.sent[0].keyboard).toBeUndefined();
    expect(w.sessions[0].pending).toBeNull();
    expect(chargeEvents(w)).toHaveLength(0);
  });

  it('asks for what is missing', async () => {
    const w = chargeWorld([changeAnswer({ chargeRef: null })]);
    await handleDebt(w.deps, ctx());

    expect(w.sent[0].text).toContain('el seguro o cargo');
    expect(w.sessions[0].pending).toBeNull();
  });

  it('answers when no charge looks like the one named, listing the ones the debt has', async () => {
    const w = chargeWorld([changeAnswer({ chargeRef: 'gps' })]);
    await handleDebt(w.deps, ctx());

    expect(w.sent[0].text).toContain('No encontré');
    expect(w.sent[0].text).toContain('Seguro de vida');
    expect(w.sent[0].keyboard).toBeUndefined();
  });

  it('asks which charge when several match, with charge buttons, then previews the chosen one', async () => {
    const many = [...CHARGES, { id: 'all', kind: 'insurance', label: 'Seguro todo riesgo', basis: 'fixed', value: 5000, cadence: 'per_installment' }];
    const w = world({ debts: [debtRow('d1', 'Crédito Vehículo', { termsJson: serializeTerms({ ...loanTerms, charges: many }) })], answers: [changeAnswer({ chargeRef: 'seguro', op: 'set', newValue: 7000 })] });
    await handleDebt(w.deps, ctx());

    expect(buttons(w.sent[0].keyboard)).toEqual(['nia:chg:0', 'nia:chg:1']);
    expect(w.sent[0].keyboard.flat().map((item) => item.text)).toEqual(['Seguro de vida', 'Seguro todo riesgo']);
    expect(w.lastPending()).toMatchObject({ action: 'charge_change', awaiting: 'charge', debtId: 'd1', candidates: ['life', 'all'] });

    await handleDebtCallback(w.deps, ctx({ pending: w.lastPending() }), 'nia:chg:1');
    expect(w.sent[1].text).toContain('Seguro todo riesgo: $ 5.000 → $ 7.000');
    expect(w.lastPending()).toMatchObject({ awaiting: 'confirm', draft: { chargeId: 'all', op: 'set', newValue: 7000 } });
    expect(chargeEvents(w)).toHaveLength(0);
  });

  it('ignores a charge button that is not one of the offered, and one that arrives out of turn', async () => {
    const many = [...CHARGES, { id: 'all', kind: 'insurance', label: 'Seguro todo riesgo', basis: 'fixed', value: 5000, cadence: 'per_installment' }];
    const w = world({ debts: [debtRow('d1', 'Crédito Vehículo', { termsJson: serializeTerms({ ...loanTerms, charges: many }) })], answers: [changeAnswer({ chargeRef: 'seguro', op: 'remove' })] });
    await handleDebt(w.deps, ctx());
    const picking = w.lastPending();

    await handleDebtCallback(w.deps, ctx({ pending: picking }), 'nia:chg:5');
    expect(w.sent[1].text).toContain('no es una de las opciones');

    await handleDebtCallback(w.deps, ctx({ pending: picking }), 'nia:chg:1');
    const sessions = w.sessions.length;
    await handleDebtCallback(w.deps, ctx({ pending: w.lastPending() }), 'nia:chg:0');
    expect(w.sent[w.sent.length - 1].text).toContain('ya no aplica');
    expect(w.sessions).toHaveLength(sessions);
    expect(chargeEvents(w)).toHaveLength(0);
  });

  it('asks which debt first when several match, then continues the charge change', async () => {
    const w = world({ debts: [chargedRow('d1', 'Carro', { lender: 'Banco Uno' }), chargedRow('d2', 'Moto', { lender: 'Banco Dos' })], answers: [changeAnswer({}, { debtRef: 'banco' })] });
    await handleDebt(w.deps, ctx());

    expect(buttons(w.sent[0].keyboard)).toEqual(['nia:pick:d1', 'nia:pick:d2']);
    expect(w.lastPending()).toMatchObject({ action: 'charge_change', awaiting: 'pick', draft: { chargeRef: 'seguro de vida', op: 'remove' } });

    await handleDebtCallback(w.deps, ctx({ pending: w.lastPending() }), 'nia:pick:d2');
    expect(w.sent[1].text).toContain('Cambio de cargos en Moto');
    expect(w.lastPending()).toMatchObject({ awaiting: 'confirm', debtId: 'd2' });
  });

  it('adds the backdated note when the change is effective before a recorded payment', async () => {
    const w = chargeWorld([changeAnswer({ effectiveOn: '2026-09-10' })]);
    w.tables.debt_events.push({ ...disbursement('d1'), $id: 'pay1', kind: 'payment', effectiveOn: '2026-10-10', amountMinor: 390381, dedupeKey: 'seed:pay1' });
    await handleDebt(w.deps, ctx());

    expect(w.sent[0].text).toContain('Los costos de pagos anteriores se actualizarán cuando abras la deuda en la web.');
  });

  it('works on a card, showing the next minimum payment', async () => {
    const cardTerms = { kind: 'card', principalMinor: 500000, openedOn: '2026-04-01', system: 'none', periodicity: 'monthly', rate: { value: 28, basis: 'effective', periodicity: 'annual', timing: 'arrears' }, charges: CHARGES, card: { statementDay: 15, dueDay: 30, minPayment: { rule: 'interest_fees_plus_pct', pct: 5, floorMinor: 20000 } } };
    const w = world({ debts: [debtRow('c1', 'Visa', { kind: 'card', termsJson: serializeTerms(cardTerms) })], answers: [changeAnswer({ chargeRef: 'cuota de manejo', op: 'set', newValue: 20000 }, { debtRef: 'visa' })] });
    w.tables.debt_events = [];
    await handleDebt(w.deps, ctx());

    expect(w.sent[0].text).toContain('Próximo pago mínimo');
    await confirmDebt(w.deps, ctx(), w.lastPending());
    expect(chargeEvents(w)).toHaveLength(1);
  });

  describe('Confirm', () => {
    it('writes one charge_change event with the whole set rebuilt from the live debt', async () => {
      const w = chargeWorld([changeAnswer()]);
      await handleDebt(w.deps, ctx());
      await confirmDebt(w.deps, ctx(), w.lastPending());

      expect(chargeEvents(w)).toHaveLength(1);
      expect(chargeEvents(w)[0]).toMatchObject({ $id: 'dep1', dedupeKey: 'debt:p1', debtId: 'd1', effectiveOn: '2026-10-13', source: 'telegram', actorId: ACTOR });
      expect(JSON.parse(chargeEvents(w)[0].payloadJson).charges.map((charge) => charge.id)).toEqual(['fee', 'iva']);
      expect(w.sent[1].text).toContain('registré el cambio de cargos de Crédito Vehículo');
      expect(w.sent[1].text).toContain('quité Seguro de vida');
      expect(w.sessions[1]).toMatchObject({ status: 'completed', pending: { kind: 'debt', v: 1, id: 'p1', action: 'charge_change', done: true } });
      expect(costRows(w)).toHaveLength(0);
    });

    it('removes the charges that depend on a removed one (IVA goes with the fee) and says so in the preview', async () => {
      const w = chargeWorld([changeAnswer({ chargeRef: 'cuota de manejo' })]);
      await handleDebt(w.deps, ctx());
      expect(w.sent[0].text).toContain('También se quita lo que depende de él: IVA');

      await confirmDebt(w.deps, ctx(), w.lastPending());
      expect(JSON.parse(chargeEvents(w)[0].payloadJson).charges.map((charge) => charge.id)).toEqual(['life']);
    });

    it('answers "ya estaba registrado" to a repeated Confirm and writes one event for a double tap or a race', async () => {
      const w = chargeWorld([changeAnswer({ op: 'set', newValue: 0.1 })]);
      await handleDebt(w.deps, ctx());
      const pending = w.lastPending();
      await Promise.all([confirmDebt(w.deps, ctx(), pending), confirmDebt(w.deps, ctx(), pending)]);
      await confirmDebt(w.deps, ctx(), pending);
      await confirmDebt(w.deps, ctx(), w.lastPending());

      expect(chargeEvents(w)).toHaveLength(1);
      expect(w.sent.slice(1).filter((call) => /ya estaba registrado/.test(call.text)).length).toBeGreaterThanOrEqual(2);
    });

    it('answers "ya estaba registrado" to a repeated Confirm of a removal, even though the charge is no longer there to rebuild from', async () => {
      const w = chargeWorld([changeAnswer()]);
      await handleDebt(w.deps, ctx());
      const pending = w.lastPending();
      await confirmDebt(w.deps, ctx(), pending);
      await confirmDebt(w.deps, ctx(), pending); // Telegram retry that read the session before the done marker

      expect(chargeEvents(w)).toHaveLength(1);
      expect(w.sent[2].text).toContain('ya estaba registrado');
      expect(w.sent[2].text).not.toContain('ya no existe');
    });

    it('rebuilds from the live debt: a charge changed on the web in the meantime is kept', async () => {
      const w = chargeWorld([changeAnswer({ chargeRef: 'cuota de manejo', op: 'set', newValue: 12000 })]);
      await handleDebt(w.deps, ctx());
      const pending = w.lastPending();
      // The web changed the insurance after the preview was shown.
      const changed = CHARGES.map((charge) => (charge.id === 'life' ? { ...charge, value: 0.2 } : charge));
      w.tables.debt_events.push({ ...disbursement('d1'), $id: 'web1', kind: 'charge_change', effectiveOn: '2026-10-01', amountMinor: 0, payloadJson: JSON.stringify({ charges: changed }), dedupeKey: 'seed:web1' });
      await confirmDebt(w.deps, ctx(), pending);

      const written = JSON.parse(chargeEvents(w).find((event) => event.$id === 'dep1').payloadJson).charges;
      expect(written.map((charge) => [charge.id, charge.value])).toEqual([['life', 0.2], ['fee', 12000], ['iva', 19]]);
    });

    it('writes nothing and says so when the charge is gone or the debt is gone', async () => {
      const w = chargeWorld([changeAnswer()]);
      await handleDebt(w.deps, ctx());
      const pending = w.lastPending();
      w.tables.debts = [chargedRow('d1', 'Crédito Vehículo', { termsJson: serializeTerms({ ...loanTerms, charges: CHARGES.slice(1) }) })];
      await confirmDebt(w.deps, ctx(), pending);
      expect(w.sent[1].text).toContain('ya no existe');

      w.tables.debts = [];
      await confirmDebt(w.deps, ctx(), pending);
      expect(w.sent[2].text).toContain('No encontré esa deuda');
      expect(chargeEvents(w)).toHaveLength(0);
      expect(w.sessions).toHaveLength(1);
    });
  });
});

describe('restructure (F1)', () => {
  const answer = (planChange = {}, extra = {}) => ({ action: 'restructure', debtRef: 'vehiculo', rate: { value: null }, charges: [], planChange: { effectiveOn: null, n: 48, system: null, periodicity: null, firstDueOn: '2026-12-05', waiveLate: false, ...planChange }, ...extra });
  const restructures = (w) => w.tables.debt_events.filter((event) => event.kind === 'restructure');
  const payload = (w) => JSON.parse(restructures(w)[0].payloadJson);
  const money = (value) => plain(pesos(value));
  const TODAY = '2026-10-13';
  const MORA = { $id: 'lr1', householdId: 'h1', kind: 'usury', modality: 'consumer', validFrom: '2026-10-01', validTo: '2026-10-31', value: 2859, source: 'Resolución', verified: true };
  const moraRow = () => debtRow('d1', 'Crédito Vehículo', { termsJson: serializeTerms({ ...loanTerms, late: { mode: 'usury' } }) });
  const moraWorld = (answers) => world({ debts: [moraRow()], legalRows: [MORA], answers });
  const cardTerms = { kind: 'card', principalMinor: 500000, openedOn: '2026-04-01', system: 'none', periodicity: 'monthly', rate: { value: 28, basis: 'effective', periodicity: 'annual', timing: 'arrears' }, card: { statementDay: 15, dueDay: 30, minPayment: { rule: 'interest_fees_plus_pct', pct: 5, floorMinor: 20000 } } };
  const cardRow = () => debtRow('c1', 'Visa', { kind: 'card', termsJson: serializeTerms(cardTerms) });
  const payAt = (w, id, on, amountMinor) => w.tables.debt_events.push({ ...disbursement('d1'), $id: id, kind: 'payment', effectiveOn: on, amountMinor, dedupeKey: `seed:${id}` });
  // What the core says the restructure refinances for the live events, to compare with what Nia shows and writes.
  const carryOf = (w, waive = false) => {
    const debt = { ...w.tables.debts[0], legal: resolveLegal(w.tables.legal_rates) };
    const carry = restructureCarry(debt, w.tables.debt_events, TODAY);
    return { carry, carried: carry.carriedMinor - (waive ? carry.waivableLateMinor : 0) };
  };

  it('previews the arrears, the carried balance, the new installment and the term, and writes nothing', async () => {
    const w = world({ answers: [answer()] });
    await handleDebt(w.deps, ctx({ text: 'reestructura a 48 cuotas, primera cuota 2026-12-05' }));
    const { carried } = carryOf(w);

    expect(carried).toBe(10180876);
    expect(w.sent).toHaveLength(1);
    const text = w.sent[0].text;
    expect(text).toContain('Reestructuración de Crédito Vehículo');
    expect(text).toContain(`Saldo de capital: ${money(10000000)}`);
    expect(text).toContain(`Intereses vencidos: ${money(180876)}`);
    expect(text).toContain(`Cuotas vencidas que se refinancian: ${money(380381)}`);
    expect(text).toContain(`Saldo que pasa al nuevo plan: ${money(10180876)}`);
    expect(text).toContain('48 cuotas mensuales');
    expect(text).toContain('Primera cuota: 2026-12-05');
    expect(text).toMatch(/Cuota: .* → .*/);
    expect(text).toContain('Costo restante');
    expect(buttons(w.sent[0].keyboard)).toEqual(['nia:confirm', 'nia:edit', 'nia:cancel']);
    expect(w.sessions[0].status).toBe('awaiting_confirmation');
    expect(w.lastPending()).toEqual({ kind: 'debt', v: 1, id: 'p1', action: 'restructure', awaiting: 'confirm', debtId: 'd1', draft: { effectiveOn: TODAY, n: 48, firstDueOn: '2026-12-05' } });
    expect(Buffer.byteLength(JSON.stringify(w.lastPending()), 'utf8')).toBeLessThan(300);
    expect(restructures(w)).toHaveLength(0);
  });

  it('shows the mora as part of what is refinanced, and forgives it with waiveLate (391,756 against 390,381 in the golden case)', async () => {
    const keep = moraWorld([answer()]);
    await handleDebt(keep.deps, ctx());
    const waive = moraWorld([answer({ waiveLate: true })]);
    await handleDebt(waive.deps, ctx());
    const { carry } = carryOf(keep);

    expect(carry.arrears.lateInterest).toBeGreaterThan(0);
    expect(keep.sent[0].text).toContain(`Mora: ${money(carry.arrears.lateInterest)}`);
    expect(keep.sent[0].text).toContain(`Saldo que pasa al nuevo plan: ${money(carryOf(keep).carried)}`);
    expect(waive.sent[0].text).toContain(`Mora condonada: ${money(carry.waivableLateMinor)}`);
    expect(waive.sent[0].text).toContain(`Saldo que pasa al nuevo plan: ${money(carryOf(waive, true).carried)}`);
    expect(carryOf(waive, true).carried).toBe(carryOf(keep).carried - carry.waivableLateMinor);
    expect(waive.lastPending().draft).toMatchObject({ waiveLate: true });
    expect(keep.lastPending().draft).not.toHaveProperty('waiveLate');
  });

  it('echoes the rate with its EA and cites the usury cap without blocking', async () => {
    const w = world({ answers: [answer({}, { rate: { value: 30, period: 'annual' } })] });
    await handleDebt(w.deps, ctx());

    expect(w.sent[0].text).toContain('Tasa: 30% EA');
    expect(w.sent[0].text).toContain('supera el tope de usura de 28.59% E.A.');
    expect(buttons(w.sent[0].keyboard)).toContain('nia:confirm');
    expect(w.lastPending().draft.rate).toEqual({ value: 30, basis: 'effective', periodicity: 'annual', timing: 'arrears' });
  });

  it('asks for the convention of an ambiguous rate with the convention buttons, then previews', async () => {
    const w = world({ answers: [answer({}, { rate: { value: 2, period: 'monthly' } })] });
    await handleDebt(w.deps, ctx({ text: 'reestructura a 48 cuotas con tasa de 2% mensual' }));

    expect(buttons(w.sent[0].keyboard)).toEqual(['nia:conv:EA', 'nia:conv:NAMV', 'nia:conv:MV', 'nia:conv:NATV', 'nia:conv:NATA']);
    expect(w.lastPending()).toMatchObject({ action: 'restructure', awaiting: 'convention', debtId: 'd1', draft: { effectiveOn: TODAY, n: 48, rateValue: 2 } });
    expect(w.lastPending().draft.rate).toBeUndefined();

    await handleDebtCallback(w.deps, ctx({ pending: w.lastPending() }), 'nia:conv:MV');
    expect(w.sent[1].text).toContain('Reestructuración de Crédito Vehículo');
    expect(w.sent[1].text).toContain('Tasa: 2% MV ≈ 26.82% EA');
    expect(w.lastPending()).toMatchObject({ awaiting: 'confirm', draft: { n: 48, rate: { value: 2, basis: 'effective', periodicity: 'monthly', timing: 'arrears' } } });
    expect(w.lastPending().draft.rateValue).toBeUndefined();
    expect(restructures(w)).toHaveLength(0);
  });

  it('asks for the number of installments when it is missing', async () => {
    const w = world({ answers: [answer({ n: null })] });
    await handleDebt(w.deps, ctx());

    expect(w.sent[0].text).toContain('el número de cuotas');
    expect(w.sent[0].keyboard).toBeUndefined();
    expect(w.sessions[0].pending).toBeNull();
  });

  it('explains a first installment on or before the effective date, without a pending', async () => {
    const w = world({ answers: [answer({ firstDueOn: TODAY })] });
    await handleDebt(w.deps, ctx());

    expect(w.sent[0].text).toContain('primera cuota');
    expect(w.sent[0].keyboard).toBeUndefined();
    expect(w.sessions[0].pending).toBeNull();
    expect(restructures(w)).toHaveLength(0);
  });

  it('refuses a card and writes nothing', async () => {
    const w = world({ debts: [cardRow()], answers: [answer({}, { debtRef: 'visa' })] });
    w.tables.debt_events = [];
    await handleDebt(w.deps, ctx());

    expect(w.sent[0].text).toContain('tarjeta');
    expect(w.sent[0].keyboard).toBeUndefined();
    expect(w.sessions[0].pending).toBeNull();
    expect(restructures(w)).toHaveLength(0);
  });

  it('asks which debt first when several match, then previews the chosen one', async () => {
    const w = world({ debts: [debtRow('d1', 'Carro', { lender: 'Banco Uno' }), debtRow('d2', 'Moto', { lender: 'Banco Dos' })], answers: [answer({}, { debtRef: 'banco' })] });
    await handleDebt(w.deps, ctx());

    expect(buttons(w.sent[0].keyboard)).toEqual(['nia:pick:d1', 'nia:pick:d2']);
    expect(w.lastPending()).toMatchObject({ action: 'restructure', awaiting: 'pick', draft: { n: 48, firstDueOn: '2026-12-05' } });

    await handleDebtCallback(w.deps, ctx({ pending: w.lastPending() }), 'nia:pick:d2');
    expect(w.sent[1].text).toContain('Reestructuración de Moto');
    expect(w.lastPending()).toMatchObject({ awaiting: 'confirm', debtId: 'd2' });
  });

  it('keeps the charges the user stated in the pending and shows them in the new plan', async () => {
    const charges = [{ kind: 'insurance', label: 'Seguro de vida', basis: 'pctOutstanding', value: 0.05 }];
    const w = world({ answers: [answer({}, { charges })] });
    await handleDebt(w.deps, ctx());

    expect(w.lastPending().draft.charges).toEqual([{ id: 'c1', kind: 'insurance', label: 'Seguro de vida', basis: 'pctOutstanding', value: 0.05, cadence: 'per_installment' }]);

    await confirmDebt(w.deps, ctx(), w.lastPending());
    expect(payload(w).terms.charges.map((charge) => charge.label)).toEqual(['Seguro de vida']);
  });

  async function previewed(w, text = 'reestructura a 48 cuotas') {
    await handleDebt(w.deps, ctx({ text }));
    return w.lastPending();
  }

  describe('Confirm', () => {
    it('writes one restructure event with the carried balance, the new terms and the ids of the pending, and reports the written figures', async () => {
      const w = world({ answers: [answer()] });
      const pending = await previewed(w);
      await confirmDebt(w.deps, ctx(), pending);

      expect(restructures(w)).toHaveLength(1);
      expect(restructures(w)[0]).toMatchObject({ $id: 'dep1', dedupeKey: 'debt:p1', debtId: 'd1', effectiveOn: TODAY, source: 'telegram', actorId: ACTOR });
      expect(payload(w).terms).toMatchObject({ principalMinor: 10180876, n: 48, firstDueOn: '2026-12-05', openedOn: TODAY, system: 'french', periodicity: 'monthly', rate: { value: 24 } });
      expect(payload(w)).not.toHaveProperty('waiveLate');
      expect(costRows(w)).toHaveLength(0);
      expect(w.sent[1].text).toContain('registré la reestructuración de Crédito Vehículo');
      expect(w.sent[1].text).toContain(`Saldo refinanciado: ${money(10180876)}`);
      expect(w.sent[1].text).toContain('Cuotas restantes: 48');
      expect(w.sent[1].text).toContain('Primera cuota: 2026-12-05');
      expect(w.sessions[1]).toMatchObject({ status: 'completed', pending: { kind: 'debt', v: 1, id: 'p1', action: 'restructure', done: true } });
    });

    it('writes waiveLate with the mora left out of the carried balance', async () => {
      const w = moraWorld([answer({ waiveLate: true })]);
      const pending = await previewed(w);
      const expected = carryOf(w, true);
      await confirmDebt(w.deps, ctx(), pending);

      expect(payload(w)).toMatchObject({ waiveLate: true });
      expect(payload(w).terms.principalMinor).toBe(expected.carried);
      expect(expected.carry.waivableLateMinor).toBeGreaterThan(0);
      expect(w.sent[1].text).toContain(`Saldo refinanciado: ${money(expected.carried)}`);
      expect(w.sent[1].text).toContain(`Mora condonada: ${money(expected.carry.waivableLateMinor)}`);
    });

    it('rebuilds from the live debt: a payment recorded after the preview changes the written carried balance', async () => {
      const w = world({ answers: [answer()] });
      const pending = await previewed(w);
      payAt(w, 'pay1', '2026-10-12', 380381);
      await confirmDebt(w.deps, ctx(), pending);
      const written = payload(w).terms.principalMinor;

      expect(w.sent[0].text).toContain(`Saldo que pasa al nuevo plan: ${money(10180876)}`);
      expect(written).toBe(9800495);
      expect(w.sent[1].text).toContain(`Saldo refinanciado: ${money(9800495)}`);
      expect(restructures(w)).toHaveLength(1);
    });

    it('answers "ya estaba registrado" to a second Confirm, writes one event for a double tap and for a race', async () => {
      const w = world({ answers: [answer()] });
      const pending = await previewed(w);
      await confirmDebt(w.deps, ctx(), pending);
      await confirmDebt(w.deps, ctx(), pending); // Telegram retry that read the session before the done marker
      await confirmDebt(w.deps, ctx(), w.lastPending()); // a tap after the first one finished

      expect(restructures(w)).toHaveLength(1);
      expect(w.sent.slice(1).map((call) => /ya estaba registrad/.test(call.text))).toEqual([false, true, true]);

      const race = world({ answers: [answer()] });
      const racing = await previewed(race);
      await Promise.all([confirmDebt(race.deps, ctx(), racing), confirmDebt(race.deps, ctx(), racing)]);
      expect(restructures(race)).toHaveLength(1);
    });

    it('checks the dedupe key before rebuilding: a repeated Confirm says it was recorded even when the debt can no longer be rebuilt', async () => {
      const w = world({ answers: [answer()] });
      const pending = await previewed(w);
      await confirmDebt(w.deps, ctx(), pending);
      w.tables.debts = [];
      await confirmDebt(w.deps, ctx(), pending);

      expect(restructures(w)).toHaveLength(1);
      expect(w.sent[2].text).toContain('ya estaba registrad');
      expect(w.sent[2].text).not.toContain('No encontré');
    });

    it('writes nothing and explains when the rebuilt terms are invalid', async () => {
      const w = world({ answers: [answer()] });
      const pending = await previewed(w);
      const forged = { ...pending, draft: { ...pending.draft, firstDueOn: '2026-10-01' } };
      await confirmDebt(w.deps, ctx(), forged);

      expect(restructures(w)).toHaveLength(0);
      expect(w.sent[1].text).toContain('primera cuota');
      expect(w.sessions).toHaveLength(1);
    });

    it('writes nothing and explains when the event would pass 8000 characters', async () => {
      const w = world({ answers: [answer()] });
      const pending = await previewed(w);
      const charges = Array.from({ length: 90 }, (_, index) => ({ id: `c${index + 1}`, kind: 'fee', label: `Cargo número ${index + 1}`, basis: 'fixed', value: 1000, cadence: 'per_installment' }));
      await confirmDebt(w.deps, ctx(), { ...pending, draft: { ...pending.draft, charges } });

      expect(restructures(w)).toHaveLength(0);
      expect(w.sent[1].text).toContain('demasiado grande');
      expect(w.sessions).toHaveLength(1);
    });

    it('writes nothing when the debt became a card or is gone', async () => {
      const card = world({ debts: [cardRow()], answers: [answer()] });
      card.tables.debt_events = [];
      const pending = { kind: 'debt', v: 1, id: 'p1', action: 'restructure', awaiting: 'confirm', debtId: 'c1', draft: { effectiveOn: TODAY, n: 48, firstDueOn: '2026-12-05' } };
      await confirmDebt(card.deps, ctx(), pending);
      expect(restructures(card)).toHaveLength(0);
      expect(card.sent[0].text).toContain('tarjeta');

      const gone = world({ answers: [answer()] });
      const live = await previewed(gone);
      gone.tables.debts = [];
      await confirmDebt(gone.deps, ctx(), live);
      expect(restructures(gone)).toHaveLength(0);
      expect(gone.sent[1].text).toContain('No encontré esa deuda');
    });

    it('does not confirm while the convention is still pending', async () => {
      const w = world({ answers: [answer({}, { rate: { value: 2, period: 'monthly' } })] });
      await handleDebt(w.deps, ctx());
      await confirmDebt(w.deps, ctx(), w.lastPending());

      expect(restructures(w)).toHaveLength(0);
      expect(w.sent[1].text).toContain('Antes de confirmar');
    });

    it('adds the backdated note to the preview and the reply when a recorded payment changes cost', async () => {
      const w = world({ answers: [answer({ effectiveOn: '2026-10-11' })] });
      payAt(w, 'pay1', '2026-10-12', 380381);
      const pending = await previewed(w);
      await confirmDebt(w.deps, ctx(), pending);

      expect(w.sent[0].text).toContain('Los costos de pagos anteriores se actualizarán cuando abras la deuda en la web.');
      expect(w.sent[1].text).toContain('Los costos de pagos anteriores se actualizarán cuando abras la deuda en la web.');
      expect(restructures(w)).toHaveLength(1);
    });
  });

  describe('stale buttons', () => {
    it('ignores a convention button and a mode button while the preview waits for confirmation', async () => {
      const w = world({ answers: [answer()] });
      const pending = await previewed(w);
      const before = w.sessions.length;
      await handleDebtCallback(w.deps, ctx({ pending }), 'nia:conv:EA');
      await handleDebtCallback(w.deps, ctx({ pending }), 'nia:mode:keep_term');

      expect(w.sent[1].text).toContain('ya no aplica');
      expect(w.sent[2].text).toContain('ya no aplica');
      expect(w.sessions).toHaveLength(before);
      expect(restructures(w)).toHaveLength(0);
    });
  });
});

describe('late_policy (F2)', () => {
  const lateAnswer = (late = {}, extra = {}) => ({ action: 'late_policy', debtRef: 'vehiculo', late: { mode: 'usury', ...late }, ...extra });
  const lateEvents = (w) => w.tables.debt_events.filter((event) => event.kind === 'late_policy');
  const money = (value) => plain(pesos(value));
  // The card golden of the core, five months later: statement on the 20th, due on the 10th. The first minimum (due 2026-10-10) is 146,102,
  // 21,102 of it interest, fees and taxes, so 125,000 of capital is unmet; ten days of it at the 28.59% cap are 861 of mora.
  const fixture = JSON.parse(readFileSync(new URL('../../../packages/finance-core/test/fixtures/card-statement-independent.json', import.meta.url), 'utf8'));
  const cardTerms = { ...fixture.terms, openedOn: '2026-09-01', card: { ...fixture.terms.card, statementDay: 20, dueDay: 10 } };
  const cardRow = () => debtRow('c1', 'Visa', { kind: 'card', termsJson: serializeTerms(cardTerms) });
  const cardWorld = (late = {}) => {
    const w = tenDaysLate(world({ debts: [cardRow()], answers: [lateAnswer({ effectiveOn: '2026-10-10', ...late }, { debtRef: 'visa' })] }));
    w.tables.debt_events = [];
    return w;
  };
  // Ten days after the first installment (due 2026-10-10): 199,505 of principal overdue at the 28.59% cap is 1,375 of mora.
  const tenDaysLate = (w) => { w.deps.now = () => new Date('2026-10-20T15:00:00Z'); return w; };

  async function previewed(w) {
    await handleDebt(w.deps, ctx({ text: 'activa mora a la usura en el crédito del banco' }));
    return w.lastPending();
  }

  it('previews the usury mode effective today with the cap in force, and writes nothing until confirmed', async () => {
    const w = world({ answers: [lateAnswer()] });
    const pending = await previewed(w);

    expect(w.sent).toHaveLength(1);
    expect(w.sent[0].text).toContain('Mora de Crédito Vehículo');
    expect(w.sent[0].text).toContain('Modo: tasa de usura');
    expect(w.sent[0].text).toContain('Desde: 2026-10-13');
    expect(w.sent[0].text).toContain('Tope de usura vigente: 28.59% E.A.');
    expect(w.sent[0].text).toContain(`Mora acumulada al 2026-10-13: ${money(0)} → ${money(0)}`);
    expect(w.sent[0].text).toContain('La mora no es retroactiva');
    expect(buttons(w.sent[0].keyboard)).toEqual(['nia:confirm', 'nia:edit', 'nia:cancel']);
    expect(w.sessions[0].status).toBe('awaiting_confirmation');
    expect(pending).toMatchObject({ kind: 'debt', id: 'p1', action: 'late_policy', awaiting: 'confirm', debtId: 'd1', draft: { effectiveOn: '2026-10-13', late: { mode: 'usury', graceDays: 0 } } });
    expect(Buffer.byteLength(JSON.stringify(pending), 'utf8')).toBeLessThanOrEqual(1500);
    expect(lateEvents(w)).toHaveLength(0);
  });

  it('previews the mora of a policy that reaches back to the due date: 1,375 after ten days', async () => {
    const w = tenDaysLate(world({ answers: [lateAnswer({ effectiveOn: '2026-10-10' })] }));
    await previewed(w);

    expect(w.sent[0].text).toContain('Desde: 2026-10-10');
    expect(w.sent[0].text).toContain(`Mora acumulada al 2026-10-20: ${money(0)} → ${money(1375)}`);
    expect(lateEvents(w)).toHaveLength(0);
  });

  describe('Confirm', () => {
    it('writes one late_policy event with the pending-derived ids and reports the written figures', async () => {
      const w = tenDaysLate(world({ answers: [lateAnswer({ effectiveOn: '2026-10-10', graceDays: 0 })] }));
      const pending = await previewed(w);
      await confirmDebt(w.deps, ctx(), pending);

      expect(lateEvents(w)).toHaveLength(1);
      expect(lateEvents(w)[0]).toMatchObject({ $id: 'dep1', dedupeKey: 'debt:p1', debtId: 'd1', effectiveOn: '2026-10-10', amountMinor: 0, source: 'telegram', actorId: ACTOR });
      expect(JSON.parse(lateEvents(w)[0].payloadJson)).toEqual({ late: { mode: 'usury', graceDays: 0 } });
      expect(costRows(w)).toHaveLength(0);
      expect(w.sent[1].text).toContain('registré la mora de Crédito Vehículo');
      expect(w.sent[1].text).toContain(`Mora acumulada al 2026-10-20: ${money(1375)}`);
      expect(w.sessions[1]).toMatchObject({ status: 'completed', pending: { kind: 'debt', v: 1, id: 'p1', action: 'late_policy', done: true } });
    });

    it('answers "ya estaba registrado" to a second Confirm and writes one event for a double tap', async () => {
      const w = world({ answers: [lateAnswer()] });
      const pending = await previewed(w);
      await confirmDebt(w.deps, ctx(), pending);
      await confirmDebt(w.deps, ctx(), pending); // Telegram retry that read the session before the done marker
      await confirmDebt(w.deps, ctx(), w.lastPending()); // a tap after the first one finished

      expect(lateEvents(w)).toHaveLength(1);
      expect(w.sent.slice(1).map((call) => /ya estaba registrad/.test(call.text))).toEqual([false, true, true]);
      expect(w.sent[2].text).toContain('Esta mora ya estaba registrada');
    });

    it('writes one event when two Confirms race, and finds it by the dedupe key even when the debt is gone', async () => {
      const w = world({ answers: [lateAnswer()] });
      const pending = await previewed(w);
      await Promise.all([confirmDebt(w.deps, ctx(), pending), confirmDebt(w.deps, ctx(), pending)]);
      w.tables.debts = [];
      await confirmDebt(w.deps, ctx(), pending);

      expect(lateEvents(w)).toHaveLength(1);
      expect(w.sent[w.sent.length - 1].text).toContain('ya estaba registrada');
    });

    it('rebuilds from the live debt: a payment recorded after the preview is part of the written figures', async () => {
      const w = tenDaysLate(world({ answers: [lateAnswer({ effectiveOn: '2026-10-10' })] }));
      const pending = await previewed(w);
      w.tables.debt_events.push({ ...disbursement('d1'), $id: 'pay1', kind: 'payment', effectiveOn: '2026-10-15', amountMinor: 380381, dedupeKey: 'seed:pay1' });
      await confirmDebt(w.deps, ctx(), pending);

      expect(lateEvents(w)).toHaveLength(1);
      // The payment (made on 10-15) settled the 687 accrued so far, but 687 of principal stayed unpaid and went on accruing: 3 left, against 1,375 without it.
      expect(w.sent[1].text).toContain(`Mora acumulada al 2026-10-20: ${money(3)}`);
      expect(w.sent[1].text).toContain('Los costos de pagos anteriores se actualizarán');
    });

    it('writes nothing and says so when the debt is gone', async () => {
      const w = world({ answers: [lateAnswer()] });
      const pending = await previewed(w);
      w.tables.debts = [];
      await confirmDebt(w.deps, ctx(), pending);

      expect(lateEvents(w)).toHaveLength(0);
      expect(w.sent[1].text).toContain('No encontré esa deuda');
      expect(w.sessions).toHaveLength(1);
    });

    it('does not confirm while the convention is still pending', async () => {
      const w = world({ answers: [lateAnswer({ mode: 'fixed', rate: { value: 3, period: 'monthly' } })] });
      await handleDebt(w.deps, ctx());
      await confirmDebt(w.deps, ctx(), w.lastPending());

      expect(lateEvents(w)).toHaveLength(0);
      expect(w.sent[1].text).toContain('Antes de confirmar');
    });
  });

  it('states that the cap applies to a fixed 40% and still writes the rate the user asked for', async () => {
    const w = world({ answers: [lateAnswer({ mode: 'fixed', rate: { value: 40, period: 'annual' } })] });
    const pending = await previewed(w);

    expect(w.sent[0].text).toContain('Modo: tasa fija 40% EA');
    expect(w.sent[0].text).toContain('se aplicará 28.59% E.A.');
    await confirmDebt(w.deps, ctx(), pending);
    expect(JSON.parse(lateEvents(w)[0].payloadJson)).toEqual({ late: { mode: 'fixed', graceDays: 0, rate: { value: 40, basis: 'effective', periodicity: 'annual', timing: 'arrears' } } });
  });

  it('reaches a confirmable preview in each of the four modes, with grace days', async () => {
    const modes = [
      [lateAnswer({ mode: 'none' }), 'Modo: sin mora', { mode: 'none', graceDays: 0 }],
      [lateAnswer({ mode: 'usury', graceDays: 5 }), 'Días de gracia: 5', { mode: 'usury', graceDays: 5 }],
      [lateAnswer({ mode: 'fixed', rate: { value: 20, period: 'annual' } }), 'Tasa de mora: 20% E.A.', { mode: 'fixed', graceDays: 0, rate: { value: 20, basis: 'effective', periodicity: 'annual', timing: 'arrears' } }],
      [lateAnswer({ mode: 'contract_multiple', multiple: 1.5 }), 'Modo: 1.5 veces la tasa del contrato', { mode: 'contract_multiple', graceDays: 0, multiple: 1.5 }],
    ];
    for (const [answer, shown, late] of modes) {
      const w = world({ answers: [answer] });
      const pending = await previewed(w);

      expect(w.sent[0].text).toContain(shown);
      expect(pending).toMatchObject({ awaiting: 'confirm', draft: { late } });
      await confirmDebt(w.deps, ctx(), pending);
      expect(JSON.parse(lateEvents(w)[0].payloadJson)).toEqual({ late });
    }
  });

  it('asks for the convention of a fixed rate with buttons, then previews with the rate it makes', async () => {
    const w = world({ answers: [lateAnswer({ mode: 'fixed', rate: { value: 3, period: 'monthly' } })] });
    await handleDebt(w.deps, ctx({ text: 'mora fija del 3% mensual' }));

    expect(buttons(w.sent[0].keyboard)).toEqual(['nia:conv:EA', 'nia:conv:NAMV', 'nia:conv:MV', 'nia:conv:NATV', 'nia:conv:NATA']);
    expect(w.lastPending()).toMatchObject({ action: 'late_policy', awaiting: 'convention', debtId: 'd1', draft: { rateValue: 3, effectiveOn: '2026-10-13', late: { mode: 'fixed', graceDays: 0 } } });
    expect(w.lastPending().draft.late.rate).toBeUndefined();

    await handleDebtCallback(w.deps, ctx({ pending: w.lastPending() }), 'nia:conv:MV');
    expect(w.sent[1].text).toContain('Modo: tasa fija 3% MV');
    expect(w.sent[1].text).toContain('Pediste 42.58% E.A., pero el tope de usura es 28.59% E.A.');
    expect(w.lastPending()).toMatchObject({ awaiting: 'confirm', draft: { late: { mode: 'fixed', rate: { value: 3, basis: 'effective', periodicity: 'monthly', timing: 'arrears' } } } });
    expect(w.lastPending().draft.rateValue).toBeUndefined();
    expect(lateEvents(w)).toHaveLength(0);
  });

  it('asks for what is missing: the mode, the fixed rate or the multiple', async () => {
    const w = world({ answers: [lateAnswer({ mode: null }), lateAnswer({ mode: 'fixed' }), lateAnswer({ mode: 'contract_multiple' })] });
    await handleDebt(w.deps, ctx());
    await handleDebt(w.deps, ctx());
    await handleDebt(w.deps, ctx());

    expect(w.sent[0].text).toContain('Para configurar la mora necesito: si quieres mora a la tasa de usura');
    expect(w.sent[1].text).toContain('la tasa de la mora');
    expect(w.sent[2].text).toContain('cuántas veces la tasa del contrato');
    expect(w.sessions.map((session) => session.pending)).toEqual([null, null, null]);
  });

  it('asks for a correction on a multiple above 3 or grace days above 90, writing nothing', async () => {
    const w = world({ answers: [lateAnswer({ mode: 'contract_multiple', multiple: 5 }), lateAnswer({ graceDays: 120 })] });
    await handleDebt(w.deps, ctx());
    await handleDebt(w.deps, ctx());

    expect(w.sent[0].text).toContain('mayor que 0 y de hasta 3');
    expect(w.sent[1].text).toContain('días de gracia');
    expect(lateEvents(w)).toHaveLength(0);
  });

  describe('a card', () => {
    it('previews the mode, the date, the cap and the 861 of mora billed at the next statement, and writes nothing until confirmed', async () => {
      const w = cardWorld();
      const pending = await previewed(w);

      expect(w.sent).toHaveLength(1);
      expect(w.sent[0].text).toContain('Mora de Visa');
      expect(w.sent[0].text).toContain('Modo: tasa de usura');
      expect(w.sent[0].text).toContain('Desde: 2026-10-10');
      expect(w.sent[0].text).toContain('Tope de usura vigente: 28.59% E.A.');
      expect(w.sent[0].text).toContain(`Mora acumulada al 2026-10-20: ${money(0)} → ${money(861)}`);
      expect(w.sent[0].text).toContain('próximo extracto');
      expect(buttons(w.sent[0].keyboard)).toEqual(['nia:confirm', 'nia:edit', 'nia:cancel']);
      expect(w.sessions[0].status).toBe('awaiting_confirmation');
      expect(pending).toMatchObject({ kind: 'debt', id: 'p1', action: 'late_policy', awaiting: 'confirm', debtId: 'c1', draft: { effectiveOn: '2026-10-10', late: { mode: 'usury', graceDays: 0 } } });
      expect(lateEvents(w)).toHaveLength(0);
    });

    it('Confirm writes exactly one late_policy event and reports the mora; a repeated Confirm says it was already recorded', async () => {
      const w = cardWorld();
      const pending = await previewed(w);
      await confirmDebt(w.deps, ctx(), pending);
      await confirmDebt(w.deps, ctx(), pending); // Telegram retry that read the session before the done marker
      await confirmDebt(w.deps, ctx(), w.lastPending()); // a tap after the first one finished

      expect(lateEvents(w)).toHaveLength(1);
      expect(lateEvents(w)[0]).toMatchObject({ $id: 'dep1', dedupeKey: 'debt:p1', debtId: 'c1', effectiveOn: '2026-10-10', amountMinor: 0, source: 'telegram', actorId: ACTOR });
      expect(JSON.parse(lateEvents(w)[0].payloadJson)).toEqual({ late: { mode: 'usury', graceDays: 0 } });
      expect(costRows(w)).toHaveLength(0);
      expect(w.sent[1].text).toContain('registré la mora de Visa');
      expect(w.sent[1].text).toContain(`Mora acumulada al 2026-10-20: ${money(861)}`);
      expect(w.sent.slice(1).map((call) => /ya estaba registrad/.test(call.text))).toEqual([false, true, true]);
      expect(w.sent[2].text).toContain('Esta mora ya estaba registrada');
    });
  });

  it('asks which debt first when several match, then previews the chosen one', async () => {
    const w = world({ debts: [debtRow('d1', 'Carro', { lender: 'Banco Uno' }), debtRow('d2', 'Moto', { lender: 'Banco Dos' })], answers: [lateAnswer({}, { debtRef: 'banco' })] });
    await handleDebt(w.deps, ctx());

    expect(buttons(w.sent[0].keyboard)).toEqual(['nia:pick:d1', 'nia:pick:d2']);
    expect(w.lastPending()).toMatchObject({ action: 'late_policy', awaiting: 'pick', candidates: ['d1', 'd2'] });

    await handleDebtCallback(w.deps, ctx({ pending: w.lastPending() }), 'nia:pick:d2');
    expect(w.sent[1].text).toContain('Mora de Moto');
    expect(w.lastPending()).toMatchObject({ awaiting: 'confirm', debtId: 'd2' });
  });

  it('ignores a mode button on a mora pending as stale, with no write', async () => {
    const w = world({ answers: [lateAnswer()] });
    await previewed(w);
    await handleDebtCallback(w.deps, ctx({ pending: w.lastPending() }), 'nia:mode:keep_term');

    expect(w.sent[1].text).toContain('ya no aplica');
    expect(lateEvents(w)).toHaveLength(0);
  });
});

describe('create: mora default by kind (F2)', () => {
  const termsOf = (w) => JSON.parse(w.tables.debts[0].termsJson);

  it('previews and writes the usury mora for a bank kind, as the web wizard does', async () => {
    const w = world({ debts: [], answers: [loanAnswer()] });
    await handleDebt(w.deps, ctx());
    await confirmDebt(w.deps, ctx(), w.lastPending());

    expect(w.sent[0].text).toContain('Mora: si una cuota se vence, cobra la tasa de usura vigente');
    expect(termsOf(w).late).toEqual({ mode: 'usury', graceDays: 0 });
  });

  it('writes the usury mora for a mortgage too, and no mora for a family loan', async () => {
    const mortgage = world({ debts: [], answers: [loanAnswer({ kind: 'mortgage', name: 'Casa' })] });
    await handleDebt(mortgage.deps, ctx());
    await confirmDebt(mortgage.deps, ctx(), mortgage.lastPending());
    const family = world({ debts: [], answers: [loanAnswer({ kind: 'family', name: 'Tío', rate: null })] });
    await handleDebt(family.deps, ctx());
    await confirmDebt(family.deps, ctx(), family.lastPending());

    expect(termsOf(mortgage).late).toEqual({ mode: 'usury', graceDays: 0 });
    expect(termsOf(family).late).toBeUndefined();
    expect(family.sent[0].text).not.toContain('Mora');
  });
});

describe('mora in the list and the advice (F2)', () => {
  const lateRow = (id, name) => debtRow(id, name, { termsJson: serializeTerms({ ...loanTerms, late: { mode: 'usury', graceDays: 0 } }) });
  const tenDaysLate = (w) => { w.deps.now = () => new Date('2026-10-20T15:00:00Z'); return w; };
  const money = (value) => plain(pesos(value));

  it('the list shows the accrued mora of a debt with a policy, and none for a debt without one', async () => {
    const w = tenDaysLate(world({ debts: [lateRow('d1', 'Crédito A'), debtRow('d2', 'Crédito B')], answers: [{ action: 'list' }] }));
    await handleDebt(w.deps, ctx());
    const lines = w.sent[0].text.split('\n');

    expect(lines.find((line) => line.includes('Crédito A'))).toContain(`mora ${money(1375)}`);
    expect(lines.find((line) => line.includes('Crédito B'))).not.toContain(' · mora ');
  });

  it('debtSummaries carries the mora of every readable debt', async () => {
    const w = tenDaysLate(world({ debts: [lateRow('d1', 'Crédito A'), debtRow('d2', 'Crédito B')] }));
    const items = await debtSummaries(w.deps);

    expect(items.map((item) => item.lateInterestMinor)).toEqual([1375, 0]);
  });

  describe('advise', () => {
    const adviseOnLate = (answer) => tenDaysLate(world({ debts: [lateRow('d1', 'Crédito Vehículo')], answers: [asked(), answer], cashflow: quarter(8000000, 3000000) }));

    it('accepts a paraphrase that quotes the mora figure the code computed', async () => {
      const w = adviseOnLate((prompt) => ({ reply: `Hoy llevas ${factsIn(prompt).lateInterest} de mora y un abono de $ ${factsIn(prompt).text.amount}.` }));
      await handleDebt(w.deps, ctx());

      expect(factsIn(w.prompts[1]).lateInterest).toBe(pesos(1375));
      expect(w.sent[0].text).toBe(`Hoy llevas ${plain(pesos(1375))} de mora y un abono de $ 2.000.000.`);
    });

    it('rejects a paraphrase with a mora figure of its own and sends the template with the real one', async () => {
      const w = adviseOnLate({ reply: 'Llevas $ 9.999 de mora acumulada.' });
      await handleDebt(w.deps, ctx());

      expect(w.sent[0].text).toContain('Recomendación para un abono');
      expect(w.sent[0].text).toContain(`Mora acumulada hoy: ${money(1375)}.`);
      expect(w.sent[0].text).not.toContain('9.999');
    });
  });
});

describe('explain (read-only, session-safe)', () => {
  const explainAnswer = (extra = {}) => ({ action: 'explain', topic: 'mora', ...extra });
  const REVIEW = 'Este tema está en revisión';
  // Counts every write the flow could make through the injected deps.
  const watched = (w) => {
    const writes = [];
    for (const name of ['createRow', 'updateRow', 'deleteRow']) {
      const original = w.deps[name];
      w.deps[name] = async (...args) => { writes.push(name); return original(...args); };
    }
    return writes;
  };
  const marker = (topic, debtId) => [{ role: 'user', content: 'qué es la mora' }, { role: 'assistant', content: 'respuesta', explain: { topic, debtId } }];
  const lastEntry = (w, index = 0) => w.sessions[index].history[w.sessions[index].history.length - 1];
  const payments = (w) => w.tables.debt_events.filter((event) => event.kind === 'payment');

  it('shows the topic menu, one button per topic, and writes nothing when the topic is missing or unknown', async () => {
    for (const answer of [{ action: 'explain' }, { action: 'explain', topic: 'tax_returns' }, { action: 'explain', topic: null }]) {
      const w = world({ answers: [answer] });
      const writes = watched(w);
      await handleDebt(w.deps, ctx({ text: 'explícame mi deuda' }));

      expect(w.sent).toHaveLength(1);
      expect(buttons(w.sent[0].keyboard)).toEqual(EXPLAIN_TOPICS.map((topic) => `nia:exp:${topic}:d1`));
      expect(writes).toEqual([]);
      expect(w.sessions[0].pending).toBeNull();
      expect(lastEntry(w).explain).toBeUndefined();
      expect(w.tables.debt_events).toHaveLength(1);
      expect(costRows(w)).toHaveLength(0);
    }
  });

  it('keeps the menu generic (no debt id on the buttons) when there are several debts and none was named', async () => {
    const w = world({ debts: [debtRow('d1', 'Carro'), debtRow('d2', 'Moto')], answers: [{ action: 'explain' }] });
    await handleDebt(w.deps, ctx());

    expect(buttons(w.sent[0].keyboard)).toEqual(EXPLAIN_TOPICS.map((topic) => `nia:exp:${topic}`));
  });

  it('answers «Este tema está en revisión» for a topic whose copy is not reviewed, with no figures, and nothing written', async () => {
    for (const topic of EXPLAIN_TOPICS) {
      const w = world({ answers: [explainAnswer({ topic })] });
      const writes = watched(w);
      await handleDebt(w.deps, ctx({ text: 'qué es esto' }));

      if (['card_statement', 'card_interest_drop'].includes(topic)) {
        expect(w.sent[0].text).toMatch(/solo a tarjetas/); // the debt is a loan
      } else {
        expect(w.sent[0].text).toContain(REVIEW);
      }
      expect(w.sent[0].text).not.toMatch(/\d/);
      expect(writes).toEqual([]);
      expect(w.sent).toHaveLength(1);
    }
  });

  it('writes the {topic, debtId} marker in the last assistant history entry and nowhere else', async () => {
    const w = world({ answers: [explainAnswer()] });
    await handleDebt(w.deps, ctx({ text: '¿qué es la mora?', history: [{ role: 'user', content: 'hola' }, { role: 'assistant', content: 'hola, soy Nia' }] }));
    const { history } = w.sessions[0];

    expect(history).toHaveLength(4);
    expect(history[history.length - 1]).toEqual({ role: 'assistant', content: w.sent[0].text, explain: { topic: 'mora', debtId: 'd1' } });
    expect(history.slice(0, -1).some((item) => item.explain)).toBe(false);
    expect(lastExplain(history)).toEqual({ topic: 'mora', debtId: 'd1' });
  });

  it('lastExplain reads only the last entry, and only a well formed assistant marker', () => {
    expect(lastExplain([{ role: 'assistant', content: 'a', explain: { topic: 'mora', debtId: 'd1' } }, { role: 'user', content: 'gracias' }])).toBeNull();
    expect(lastExplain([{ role: 'assistant', content: 'a', explain: { topic: 'mora', debtId: 'd1' } }, { role: 'assistant', content: 'b' }])).toBeNull();
    expect(lastExplain([{ role: 'assistant', content: 'a', explain: { topic: 'charges', debtId: null } }])).toEqual({ topic: 'charges', debtId: null });
    expect(lastExplain([{ role: 'user', content: 'a', explain: { topic: 'mora', debtId: 'd1' } }])).toBeNull();
    expect(lastExplain([{ role: 'assistant', content: 'a', explain: { topic: 'tax_returns', debtId: 'd1' } }])).toBeNull();
    expect(lastExplain([{ role: 'assistant', content: 'a', explain: { topic: 'mora', debtId: 42 } }])).toBeNull();
    expect(lastExplain([])).toBeNull();
    expect(lastExplain(undefined)).toBeNull();
  });

  it('keeps a pending payment: the same pending is saved and the later Confirm writes once', async () => {
    const w = world({ answers: [payAnswer(), explainAnswer({ topic: 'usury_ibc' })] });
    await handleDebt(w.deps, ctx({ text: 'pagué 380 mil al carro' }));
    const pending = w.lastPending();
    const writes = watched(w);

    await handleDebt(w.deps, ctx({ text: '¿qué es la usura?', previous: pending, sessionStatus: 'awaiting_confirmation', history: w.sessions[0].history }));

    expect(writes).toEqual([]);
    expect(w.sessions).toHaveLength(2);
    expect(w.sessions[1].pending).toBe(pending);
    expect(w.sessions[1].status).toBe('awaiting_confirmation');
    expect(w.sent[1].text).toContain(REVIEW);
    expect(payments(w)).toHaveLength(0);

    await confirmDebt(w.deps, ctx(), w.sessions[1].pending);
    expect(payments(w)).toHaveLength(1);
    expect(costRows(w)).toHaveLength(1);
  });

  it('renders the marker topic for the marker debt on a follow-up like «¿y con ejemplo?»', async () => {
    const w = world({ debts: [debtRow('d1', 'Carro'), debtRow('d2', 'Moto')], answers: [{ action: 'explain', topic: null }] });
    await handleDebt(w.deps, ctx({ text: '¿y con ejemplo?', history: marker('mora', 'd2'), explainHint: { topic: 'mora', fromMarker: true } }));

    expect(w.sent[0].text).toContain(REVIEW);
    expect(lastEntry(w).explain).toEqual({ topic: 'mora', debtId: 'd2' });
  });

  it('lets the marker topic win over a topic the model guessed on a marker follow-up', async () => {
    const w = world({ answers: [explainAnswer({ topic: 'charges' })] });
    await handleDebt(w.deps, ctx({ text: '¿y con ejemplo?', history: marker('mora', 'd1'), explainHint: { topic: 'mora', fromMarker: true } }));

    expect(lastEntry(w).explain.topic).toBe('mora');
  });

  it('uses the topic of the keyword hint when the extraction gives none, and the extraction topic when it is valid', async () => {
    const hinted = world({ answers: [{ action: 'explain', topic: null }] });
    await handleDebt(hinted.deps, ctx({ explainHint: { topic: 'usury_ibc' } }));
    expect(lastEntry(hinted).explain.topic).toBe('usury_ibc');

    const extracted = world({ answers: [explainAnswer({ topic: 'charges' })] });
    await handleDebt(extracted.deps, ctx({ explainHint: { topic: 'usury_ibc' } }));
    expect(lastEntry(extracted).explain.topic).toBe('charges');
  });

  it('lets a write action of the extraction win over the explain hint (G3)', async () => {
    const w = world({ answers: [payAnswer()] });
    await handleDebt(w.deps, ctx({ text: 'pagué 380 mil, ¿y qué es la mora?', explainHint: { topic: 'mora' } }));

    expect(w.sent[0].text).toContain('Abono a Crédito Vehículo');
    expect(buttons(w.sent[0].keyboard)).toContain('nia:confirm');
    expect(w.lastPending()).toMatchObject({ action: 'pay', awaiting: 'confirm' });
  });

  it('turns a read-only action (list, advise) with the hint into the explanation', async () => {
    for (const action of ['list', 'advise']) {
      const w = world({ answers: [{ action, debtRef: null }] });
      await handleDebt(w.deps, ctx({ explainHint: { topic: 'mora' } }));

      expect(w.sent[0].text).toContain(REVIEW);
      expect(lastEntry(w).explain).toEqual({ topic: 'mora', debtId: 'd1' });
    }
    const plainList = world({ answers: [{ action: 'list' }] });
    await handleDebt(plainList.deps, ctx());
    expect(plainList.sent[0].text).not.toContain(REVIEW); // without the hint a list stays a list
  });

  it('asks which debt with stateless explain buttons when the reference matches several, and creates no pending', async () => {
    const w = world({ debts: [debtRow('d1', 'Carro', { lender: 'Banco Uno' }), debtRow('d2', 'Moto', { lender: 'Banco Dos' })], answers: [explainAnswer({ debtRef: 'banco' })] });
    const writes = watched(w);
    await handleDebt(w.deps, ctx());

    expect(buttons(w.sent[0].keyboard)).toEqual(['nia:exp:mora:d1', 'nia:exp:mora:d2']);
    expect(w.sessions[0].pending).toBeNull();
    expect(writes).toEqual([]);
  });

  it('does not use a debt of another member personal scope', async () => {
    const w = world({ debts: [debtRow('d1', 'Carro de ella', { ownerScope: 'partner' }), debtRow('d2', 'Moto')], answers: [explainAnswer({ debtRef: 'carro' })] });
    await handleDebt(w.deps, ctx());

    expect(lastEntry(w).explain.debtId).not.toBe('d1');
  });

  it('spends no Gemini call beyond the extraction', async () => {
    const w = world({ answers: [explainAnswer()] });
    await handleDebt(w.deps, ctx());

    expect(w.prompts).toHaveLength(1);
    expect(w.prompts[0]).toContain('explain');
  });

  describe('nia:exp: buttons', () => {
    it('explains with no pending at all, without a stage check, and keeps the saved status', async () => {
      const w = world({ answers: [] });
      const writes = watched(w);
      await handleExplainCallback(w.deps, ctx({ previous: null, history: [] }), 'nia:exp:mora:d1');

      expect(w.sent).toHaveLength(1);
      expect(w.sent[0].text).toContain(REVIEW);
      expect(writes).toEqual([]);
      expect(w.sessions[0].pending).toBeNull();
      expect(w.prompts).toHaveLength(0);
      expect(lastEntry(w).explain).toEqual({ topic: 'mora', debtId: 'd1' });
    });

    it('keeps the pending that was waiting', async () => {
      const w = world({ answers: [] });
      const previous = { kind: 'debt', v: 1, id: 'p9', action: 'pay', awaiting: 'confirm', debtId: 'd1', draft: { kind: 'payment', effectiveOn: '2026-10-13', amountMinor: 1000 } };
      await handleExplainCallback(w.deps, ctx({ previous, sessionStatus: 'awaiting_confirmation' }), 'nia:exp:charges:d1');

      expect(w.sessions[0].pending).toBe(previous);
      expect(w.sessions[0].status).toBe('awaiting_confirmation');
    });

    it('answers a deleted debt with a short safe reply, no session save and zero writes', async () => {
      const w = world({ answers: [] });
      const writes = watched(w);
      await handleExplainCallback(w.deps, ctx(), 'nia:exp:mora:deleted-debt');

      expect(w.sent).toHaveLength(1);
      expect(w.sent[0].text).toMatch(/ya no está disponible/);
      expect(w.sent[0].keyboard).toBeUndefined();
      expect(writes).toEqual([]);
      expect(w.sessions).toHaveLength(0);
    });

    it('answers the debt of another member personal scope as no longer available', async () => {
      const w = world({ debts: [debtRow('d1', 'Carro de ella', { ownerScope: 'partner' })], answers: [] });
      const writes = watched(w);
      await handleExplainCallback(w.deps, ctx(), 'nia:exp:mora:d1');

      expect(w.sent[0].text).toMatch(/ya no está disponible/);
      expect(w.sent[0].text).not.toContain('Carro de ella');
      expect(writes).toEqual([]);
      expect(w.sessions).toHaveLength(0);
    });

    it('lets a debt of the same member through', async () => {
      const w = world({ debts: [debtRow('d1', 'Mi carro', { ownerScope: 'you' })], answers: [] });
      await handleExplainCallback(w.deps, ctx(), 'nia:exp:mora:d1');

      expect(w.sent[0].text).toContain(REVIEW);
    });

    it('answers an unknown topic and a malformed callback with a short safe reply and zero writes', async () => {
      for (const data of ['nia:exp:tax_returns', 'nia:exp:mora:d1:1', 'nia:exp:']) {
        const w = world({ answers: [] });
        const writes = watched(w);
        await handleExplainCallback(w.deps, ctx(), data);

        expect(w.sent).toHaveLength(1);
        expect(w.sent[0].text).toMatch(/ya no está disponible/);
        expect(writes).toEqual([]);
        expect(w.sessions).toHaveLength(0);
      }
    });

    it('resolves the debt from the marker when the page form dropped the id', async () => {
      const w = world({ debts: [debtRow('d1', 'Carro'), debtRow('d2', 'Moto')], answers: [] });
      await handleExplainCallback(w.deps, ctx({ history: marker('mora', 'd2') }), 'nia:exp:mora:-:2');

      expect(lastEntry(w).explain).toEqual({ topic: 'mora', debtId: 'd2' });
    });

    it('explains generically (no debt) when a topic button carries no id and there are several debts', async () => {
      const w = world({ debts: [debtRow('d1', 'Carro'), debtRow('d2', 'Moto')], answers: [] });
      await handleExplainCallback(w.deps, ctx(), 'nia:exp:mora');

      expect(w.sent[0].text).toContain(REVIEW);
      expect(lastEntry(w).explain).toEqual({ topic: 'mora', debtId: null });
    });
  });

  describe('released topics (injected reviewed copy)', () => {
    const DISCLAIMER = 'Información educativa con tus datos; no es asesoría financiera.';
    const released = (options) => {
      const w = world(options);
      w.deps.explainCopy = reviewedCopy();
      return w;
    };
    const labels = (message) => (message.keyboard || []).flat().map((button) => [button.text, button.callback_data]);

    it('answers part 1 with the source footer, «Ver más» and the related topics, writes nothing and sets the marker', async () => {
      const w = released({ answers: [explainAnswer({ topic: 'usury_ibc' })] });
      const writes = watched(w);
      await handleDebt(w.deps, ctx({ text: '¿qué es la usura?' }));

      expect(w.sent).toHaveLength(1);
      expect(w.sent[0].text).toContain('Fuente: Crédito Vehículo · tasas de usura e IBC');
      expect(w.sent[0].text).toContain(DISCLAIMER);
      expect(w.sent[0].text.length).toBeLessThanOrEqual(1200);
      expect(labels(w.sent[0])[0]).toEqual(['Ver más', 'nia:exp:usury_ibc:d1:2']);
      expect(labels(w.sent[0]).slice(1).map(([, data]) => data)).toEqual(['nia:exp:rate_conventions:d1', 'nia:exp:mora:d1']);
      expect(writes).toEqual([]);
      expect(w.sessions[0].pending).toBeNull();
      expect(lastEntry(w).explain).toEqual({ topic: 'usury_ibc', debtId: 'd1' });
    });

    it('sends part 2 with its own footer when «Ver más» is tapped, and leaves the marker for the next tap', async () => {
      const w = released({ answers: [] });
      const writes = watched(w);
      await handleExplainCallback(w.deps, ctx({ history: marker('usury_ibc', 'd1') }), 'nia:exp:usury_ibc:d1:2');

      expect(w.sent[0].text).toContain('El interés bancario corriente (IBC) es la tasa promedio');
      expect(w.sent[0].text).toContain('Fuente: Crédito Vehículo · tasas de usura e IBC');
      expect(labels(w.sent[0]).map(([label]) => label)).not.toContain('Ver más');
      expect(writes).toEqual([]);
      expect(lastEntry(w).explain).toEqual({ topic: 'usury_ibc', debtId: 'd1' });
    });

    it('resolves the debt of «Ver más» from the marker when the page form dropped the id', async () => {
      const w = released({ debts: [debtRow('d1', 'Carro'), debtRow('d2', 'Moto')], answers: [] });
      await handleExplainCallback(w.deps, ctx({ history: marker('usury_ibc', 'd2') }), 'nia:exp:usury_ibc:-:2');

      expect(w.sent[0].text).toContain('El interés bancario corriente (IBC) es la tasa promedio');
      expect(w.sent[0].text).toContain('Fuente: Moto · tasas de usura e IBC');
      expect(lastEntry(w).explain).toEqual({ topic: 'usury_ibc', debtId: 'd2' });
    });

    it('keeps the rate the user stated in the marker, so «Ver más» continues the same explanation', async () => {
      const rate = { value: 35, period: 'annual', compounding: 'effective', timing: 'arrears' };
      const w = released({ answers: [explainAnswer({ topic: 'usury_ibc', rate })] });
      await handleDebt(w.deps, ctx({ text: '¿qué pasa si me cobran 35 % efectivo anual?' }));

      expect(w.sent[0].text).toContain('La tasa que me diste es 35 % E.A. y supera ese tope');
      expect(lastEntry(w).explain).toMatchObject({ topic: 'usury_ibc', debtId: 'd1', stated: { value: 35 } });

      await handleExplainCallback(w.deps, ctx({ history: w.sessions[0].history }), 'nia:exp:usury_ibc:d1:2');

      expect(w.sent[1].text).toContain('Fuente: tasa que me diste · tasas de usura e IBC');
      expect(lastEntry(w, 1).explain).toMatchObject({ stated: { value: 35 } });
    });

    it('does not carry a stated rate over to another topic or another debt', async () => {
      const w = released({ debts: [debtRow('d1', 'Carro'), debtRow('d2', 'Moto')], answers: [] });
      const history = [{ role: 'user', content: 'x' }, { role: 'assistant', content: 'respuesta', explain: { topic: 'usury_ibc', debtId: 'd1', stated: { value: 35, basis: 'effective', periodicity: 'annual', timing: 'arrears' } } }];
      await handleExplainCallback(w.deps, ctx({ history }), 'nia:exp:usury_ibc:d2:2');
      await handleExplainCallback(w.deps, ctx({ history }), 'nia:exp:mora:d1:2');

      expect(w.sent[0].text).toContain('Fuente: Moto');
      expect(w.sent[0].text).not.toContain('tasa que me diste');
      expect(w.sent[1].text).toContain('Fuente: Carro');
      expect(lastEntry(w, 0).explain).toEqual({ topic: 'usury_ibc', debtId: 'd2' });
      expect(lastEntry(w, 1).explain).toEqual({ topic: 'mora', debtId: 'd1' });
    });

    describe('card topics', () => {
      const CARD_TERMS = { kind: 'card', principalMinor: 500000, openedOn: '2026-04-01', system: 'none', periodicity: 'monthly', rate: { value: 28, basis: 'effective', periodicity: 'annual', timing: 'arrears' }, card: { statementDay: 15, dueDay: 30, minPayment: { rule: 'interest_fees_plus_pct', pct: 5, floorMinor: 20000 } } };
      const visa = (id = 'c1', name = 'Visa') => debtRow(id, name, { kind: 'card', termsJson: serializeTerms(CARD_TERMS) });

      it('explains the only card by itself when the member also has a loan and names no debt', async () => {
        const w = released({ debts: [debtRow('d1', 'Carro'), visa()], answers: [explainAnswer({ topic: 'card_statement' })] });
        const writes = watched(w);
        await handleDebt(w.deps, ctx({ text: '¿cómo funciona el pago mínimo?' }));

        expect(w.sent).toHaveLength(1);
        expect(w.sent[0].text).toContain('Fuente: Visa · extractos de tarjeta');
        expect(w.sent[0].text).toContain('Tu último extracto cortó el 15 de septiembre de 2026');
        expect(w.sent[0].text).toContain('Pago mínimo: $');
        expect(writes).toEqual([]);
        expect(lastEntry(w).explain).toEqual({ topic: 'card_statement', debtId: 'c1' });
      });

      it('asks which card, offering only the cards, when there are several', async () => {
        const w = released({ debts: [debtRow('d1', 'Carro'), visa('c1', 'Visa'), visa('c2', 'Mastercard')], answers: [explainAnswer({ topic: 'card_interest_drop' })] });
        const writes = watched(w);
        await handleDebt(w.deps, ctx({ text: '¿por qué bajaron los intereses?' }));

        expect(labels(w.sent[0]).map(([, data]) => data)).toEqual(['nia:exp:card_interest_drop:c1', 'nia:exp:card_interest_drop:c2']);
        expect(writes).toEqual([]);
        expect(w.sessions[0].pending).toBeNull();
      });

      it('says there is no card when the member has none, and shows no keyboard', async () => {
        const w = released({ debts: [debtRow('d1', 'Carro'), debtRow('d2', 'Moto')], answers: [explainAnswer({ topic: 'card_statement' })] });
        const writes = watched(w);
        await handleDebt(w.deps, ctx({ text: '¿cómo funciona el extracto?' }));

        expect(w.sent[0].text).toBe('No encuentro una tarjeta de crédito registrada, y ese tema aplica solo a tarjetas.');
        expect(w.sent[0].keyboard).toBeUndefined();
        expect(writes).toEqual([]);
      });

      it('still answers a named loan with the not applicable text', async () => {
        const w = released({ debts: [debtRow('d1', 'Carro'), visa()], answers: [explainAnswer({ topic: 'card_statement', debtRef: 'carro' })] });
        await handleDebt(w.deps, ctx({ text: '¿cómo funciona el extracto de mi carro?' }));

        expect(w.sent[0].text).toMatch(/solo a tarjetas/);
        expect(w.sent[0].text).not.toContain('Carro');
      });
    });

    it('reads a stated rate and amount from the marker only when they are valid', () => {
      const entry = (explain) => [{ role: 'assistant', content: 'a', explain }];

      expect(lastExplain(entry({ topic: 'payment_allocation', debtId: 'd1', amountMinor: 100000 }))).toEqual({ topic: 'payment_allocation', debtId: 'd1', amountMinor: 100000 });
      expect(lastExplain(entry({ topic: 'usury_ibc', debtId: null, stated: { value: 20 } }))).toEqual({ topic: 'usury_ibc', debtId: null, stated: { value: 20 } });
      expect(lastExplain(entry({ topic: 'mora', debtId: 'd1', amountMinor: -5, stated: 'rápido' }))).toEqual({ topic: 'mora', debtId: 'd1' });
    });
  });
});
