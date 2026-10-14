// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { serializeTerms } from '../../../packages/finance-core/index.js';
import { confirmDebt, debtSummaries, handleDebt, handleDebtCallback, loadDebts, loadLegal } from './handler.js';

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
    ['the reply is over 4096 characters', { reply: 'a'.repeat(4097) }],
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
