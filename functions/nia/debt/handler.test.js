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

function world({ debts = [debtRow('d1', 'Crédito Vehículo')], categories = [], answers = [], cashflow = [], config = {}, legalRows = [], legalError = null } = {}) {
  const tables = { debts: [...debts], debt_events: debts.map((debt) => disbursement(debt.$id)), transactions: [], categories: [...categories], legal_rates: [...legalRows] };
  const sent = [];
  const sessions = [];
  const prompts = [];
  const windows = [];
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
  return { deps, tables, sent, sessions, prompts, windows, lastPending: () => sessions[sessions.length - 1].pending };
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
