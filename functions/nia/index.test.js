// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serializeTerms } from '../../packages/finance-core/index.js';

// Wiring test: runs the real Function entry point against an in-memory Appwrite, Telegram and Gemini
// (a fake `undici.fetch`). No network is ever touched.
const net = vi.hoisted(() => ({ fetch: null }));
vi.mock('undici', () => ({ default: { FormData: class FormData {}, fetch: (...args) => net.fetch(...args) } }));
// The explain section of this file exercises the unreviewed state, where an empty copy releases no topic: the shipped copy was
// approved on 2026-10-15 (gate G), so it is replaced here. The reviewed answers are covered by the handler and render tests.
vi.mock('../../packages/finance-core/src/explain/copy.js', async (importOriginal) => ({ ...(await importOriginal()), EXPLAIN_COPY: {} }));

const loanTerms = { kind: 'vehicle', principalMinor: 10000000, openedOn: '2026-09-10', rate: { convention: 'EA', value: 24 }, system: 'french', periodicity: 'monthly', n: 36, firstDueOn: '2026-10-10' };
const plain = (text) => text.replace(/ /g, ' ');

function makeNet(answers) {
  const tables = { bot_sessions: [], ai_events: [], categories: [], transactions: [], budgets: [], goals: [], debts: [], debt_events: [] };
  const telegram = [];
  const prompts = [];
  const gets = [];
  const posts = [];
  const patches = [];
  let counter = 0;
  const reply = (status, body) => ({ ok: status < 400, status, statusText: String(status), text: async () => JSON.stringify(body), json: async () => body });
  const matches = (row, queries) => queries.every((q) => {
    if (q.method === 'equal') return String(row[q.attribute]) === q.values[0];
    if (q.method === 'greaterThanEqual') return String(row[q.attribute]) >= q.values[0];
    if (q.method === 'lessThan') return String(row[q.attribute]) < q.values[0];
    return true;
  });
  net.fetch = async (url, init = {}) => {
    const target = new URL(url);
    if (target.host === 'api.telegram.org') {
      telegram.push({ method: target.pathname.split('/').pop(), payload: JSON.parse(init.body) });
      return reply(200, { ok: true, result: {} });
    }
    if (target.host.startsWith('generativelanguage')) {
      const prompt = JSON.parse(init.body).contents[0].parts[0].text;
      prompts.push(prompt);
      const next = answers.shift();
      return reply(200, { candidates: [{ content: { parts: [{ text: JSON.stringify(typeof next === 'function' ? next(prompt) : next) }] } }] });
    }
    const [, table, id] = target.pathname.match(/tables\/([^/]+)\/rows(?:\/([^/]+))?$/);
    const rows = tables[table];
    if (!rows) return reply(404, { message: 'table not found' });
    const method = init.method || 'GET';
    if (method === 'GET') {
      const queries = target.searchParams.getAll('queries[]').map((q) => JSON.parse(q));
      gets.push({ table, queries });
      const offset = (queries.find((q) => q.method === 'offset') || { values: [0] }).values[0];
      const limit = (queries.find((q) => q.method === 'limit') || { values: [25] }).values[0];
      const found = rows.filter((row) => matches(row, queries));
      const cursor = queries.find((q) => q.method === 'cursorAfter');
      const start = cursor ? found.findIndex((row) => row.$id === cursor.values[0]) + 1 : offset;
      return reply(200, { rows: found.slice(start, start + limit) });
    }
    const body = init.body ? JSON.parse(init.body) : {};
    if (method === 'POST') {
      const rowId = body.rowId;
      posts.push({ table, rowId, permissions: body.permissions }); // every attempt, including the ones answered with a 409
      if (rows.some((row) => row.$id === rowId || (table === 'debt_events' && row.dedupeKey === body.data.dedupeKey))) return reply(409, { message: 'exists' });
      counter += 1;
      const row = { $id: rowId, $createdAt: `2026-10-13T15:00:0${counter % 10}.000Z`, ...body.data };
      rows.push(row);
      return reply(201, row);
    }
    if (method === 'DELETE') {
      tables[table] = rows.filter((row) => row.$id !== id);
      return reply(204, {});
    }
    if (method === 'PATCH') patches.push({ table, id, data: body.data });
    const found = rows.find((row) => row.$id === id);
    if (found) Object.assign(found, body.data);
    else rows.push({ $id: id, ...body.data });
    return reply(200, found || {});
  };
  return { tables, telegram, prompts, answers, gets, posts, patches };
}

let run;
let fake;
const debtRow = (id, name, extra = {}) => ({ $id: id, householdId: 'h1', name, kind: 'vehicle', ownerScope: 'shared', status: 'active', lender: '', termsJson: serializeTerms(loanTerms), ...extra });

// (Re)loads the entry point: the environment is read once, when the module loads.
const boot = async () => {
  vi.resetModules();
  const { default: handler } = await import('./index.js');
  run = (update) => handler({ req: { method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'secret' }, bodyJson: update }, res: { json: (value) => value }, log: () => {}, error: () => {} });
};

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-13T15:00:00Z'));
  vi.resetModules();
  vi.stubEnv('APPWRITE_ENDPOINT', 'https://appwrite.test/v1');
  Object.entries({ APPWRITE_PROJECT_ID: 'p', APPWRITE_API_KEY: 'k', APPWRITE_DATABASE_ID: 'db', HOUSEHOLD_TEAM_ID: 't1', HOUSEHOLD_ID: 'h1', TELEGRAM_BOT_TOKEN: 'tok', TELEGRAM_WEBHOOK_SECRET: 'secret', GEMINI_API_KEY: 'g' })
    .forEach(([name, value]) => vi.stubEnv(name, value));
  vi.stubEnv('TELEGRAM_USER_MAP', JSON.stringify({ 7: { ownerScope: 'you', appwriteUserId: 'u7', alias: 'Camilo' } }));
  await boot();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

let updateId = 0;
const message = (text) => ({ update_id: ++updateId, message: { text, from: { id: 7 }, chat: { id: 70 }, date: 1 } });
const press = (data) => ({ update_id: ++updateId, callback_query: { id: `cb${updateId}`, data, from: { id: 7 }, message: { chat: { id: 70 } } } });
const sent = () => fake.telegram.filter((call) => call.method === 'sendMessage').map((call) => ({ ...call.payload, text: plain(call.payload.text) }));
const buttons = (call) => call.reply_markup.inline_keyboard.flat().map((button) => button.callback_data);
const seed = (debts) => {
  fake.tables.debts.push(...debts);
  fake.tables.debt_events.push(...debts.map((debt) => ({ $id: `e-${debt.$id}`, householdId: 'h1', debtId: debt.$id, kind: 'disbursement', effectiveOn: '2026-09-10', amountMinor: 10000000, payloadJson: '{}', actorId: 'u7', source: 'telegram', dedupeKey: `seed:${debt.$id}`, $createdAt: '2026-09-10T12:00:00.000Z' })));
};
const payments = () => fake.tables.debt_events.filter((event) => event.kind === 'payment');

describe('debt wiring in the Nia entry point', () => {
  it('routes a debt message to the debt flow and a double Confirm writes one event and one cost row', async () => {
    fake = makeNet([{ intent: 'debt', action: 'pay' }, { action: 'pay', debtRef: 'vehiculo', amountMinor: 380381 }]);
    seed([debtRow('d1', 'Crédito Vehículo')]);

    await run(message('pagué 380 mil al carro'));
    expect(fake.prompts[0]).toContain('debt');
    expect(fake.prompts[1]).toContain('Crédito Vehículo');
    expect(sent()[0].text).toContain('Abono a Crédito Vehículo');
    expect(buttons(sent()[0])).toContain('nia:confirm');
    expect(payments()).toHaveLength(0);
    expect(JSON.parse(fake.tables.bot_sessions[0].pendingJson).pending).toMatchObject({ kind: 'debt', awaiting: 'confirm', debtId: 'd1' });

    const confirm = press('nia:confirm');
    await run(confirm);
    await run(confirm); // Telegram delivers the same update again
    await run(press('nia:confirm')); // and the user taps once more

    expect(payments()).toHaveLength(1);
    expect(fake.tables.transactions).toEqual([expect.objectContaining({ debtId: 'd1', amountMinor: 180876, ownerScope: 'shared' })]);
    expect(sent().slice(1).map((call) => /ya estaba registrado/.test(call.text))).toEqual([false, true, true]);
  });

  it('routes the strategy and pick buttons', async () => {
    fake = makeNet([{ intent: 'debt', action: 'pay' }, { action: 'pay', debtRef: 'banco', amountMinor: 1000000 }]);
    seed([debtRow('d1', 'Carro', { lender: 'Banco Uno' }), debtRow('d2', 'Moto', { lender: 'Banco Dos' })]);

    await run(message('abono de un millón al banco'));
    expect(buttons(sent()[0])).toEqual(['nia:pick:d1', 'nia:pick:d2']);
    await run(press('nia:pick:d2'));
    expect(buttons(sent()[1])).toContain('nia:strat:reduce_term');
    await run(press('nia:strat:advance_installments'));
    expect(sent()[2].text).toContain('Estrategia: adelantar cuotas');
    expect(buttons(sent()[2])).toContain('nia:confirm');
    expect(payments()).toHaveLength(0);
  });

  it('routes the convention buttons of a new loan and creates it on Confirm', async () => {
    fake = makeNet([{ intent: 'debt', action: 'create' }, { action: 'create', kind: 'consumer', name: 'Libre', principalMinor: 5000000, rate: { value: 2, period: 'monthly' }, n: 12 }]);

    await run(message('préstamo de 5 millones al 2% mensual a 12 meses'));
    expect(buttons(sent()[0])).toContain('nia:conv:NAMV');
    await run(press('nia:conv:MV'));
    expect(sent()[1].text).toContain('Tasa: 2% MV ≈ 26.82% EA');
    expect(fake.tables.debts).toHaveLength(0);
    await run(press('nia:confirm'));

    expect(fake.tables.debts).toEqual([expect.objectContaining({ name: 'Libre', ownerScope: 'you', actorId: 'u7' })]);
    expect(fake.tables.debt_events).toEqual([expect.objectContaining({ kind: 'disbursement', debtId: fake.tables.debts[0].$id })]);
  });

  it('keeps the other intents working', async () => {
    fake = makeNet([{ intent: 'conversation', action: 'none', reply: 'Hola, soy Nia' }]);

    await run(message('hola'));

    expect(sent()).toEqual([expect.objectContaining({ text: 'Hola, soy Nia' })]);
    expect(fake.tables.debt_events).toHaveLength(0);
  });
});

describe('simulate, advise and the analysis snapshot in the Nia entry point', () => {
  const transaction = (id, type, amountMinor, occurredAt) => ({ $id: id, householdId: 'h1', type, amountMinor, occurredAt, ownerScope: 'shared', status: 'confirmed' });
  // 3 full months before 2026-10-13 (July to September): income 6,000,000 and 45 expenses of 100,000 each, i.e. 138 rows (more than one page).
  // Decoys outside the window (June, October) must not count.
  const seedCashflow = () => {
    for (const month of ['07', '08', '09']) {
      fake.tables.transactions.push(transaction(`in${month}`, 'income', 6000000, `2026-${month}-05T15:00:00.000Z`));
      for (let index = 0; index < 45; index += 1) fake.tables.transactions.push(transaction(`ex${month}${index}`, 'expense', 100000, `2026-${month}-10T15:00:00.000Z`));
    }
    fake.tables.transactions.push(transaction('inJune', 'income', 90000000, '2026-06-20T15:00:00.000Z'), transaction('exOctober', 'expense', 90000000, '2026-10-02T15:00:00.000Z'));
  };
  const factsOf = (prompt) => JSON.parse(prompt.split('Hechos:\n')[1]);

  it('simulates read-only, and the simpay button becomes a payment confirmed exactly once', async () => {
    fake = makeNet([{ intent: 'debt', action: 'advise' }, { action: 'simulate', debtRef: 'vehiculo', extraMinor: 2000000, strategy: 'reduce_term' }]);
    seed([debtRow('d1', 'Crédito Vehículo')]);

    await run(message('simula abonar 2 millones al carro'));
    expect(sent()[0].text).toContain('Simulación de abono extra a Crédito Vehículo');
    expect(buttons(sent()[0])).toEqual(['nia:simpay']);
    expect(JSON.parse(fake.tables.bot_sessions[0].pendingJson).pending).toMatchObject({ action: 'simulate', awaiting: 'simpay', debtId: 'd1' });
    expect(fake.tables.debt_events).toHaveLength(1);

    await run(press('nia:simpay'));
    expect(sent()[1].text).toContain('Estrategia: reducir plazo');
    expect(buttons(sent()[1])).toContain('nia:confirm');
    const confirm = press('nia:confirm');
    await run(confirm);
    await run(confirm);

    expect(fake.tables.debt_events.filter((event) => event.kind === 'extra_payment')).toHaveLength(1);
    expect(fake.tables.transactions.filter((row) => row.debtId === 'd1')).toHaveLength(1);
    expect(sent()[3].text).toContain('ya estaba registrado');
  });

  it('advises with the 3 full months read from Appwrite page by page and a faithful paraphrase of the facts', async () => {
    fake = makeNet([
      { intent: 'debt', action: 'advise' },
      { action: 'advise', debtRef: 'vehiculo', extraMinor: 2000000 },
      (prompt) => ({ reply: `Tu margen promedio es de $ ${factsOf(prompt).text.margin} al mes.` }),
    ]);
    seed([debtRow('d1', 'Crédito Vehículo')]);
    seedCashflow();

    await run(message('qué me recomiendas si abono 2 millones al carro'));
    const facts = factsOf(fake.prompts[2]);
    const reads = fake.gets.filter((get) => get.table === 'transactions');

    expect(facts).toMatchObject({ verdict: 'reduce_term', text: { income: '6.000.000', expense: '4.500.000', margin: '1.500.000' } });
    expect(sent()).toEqual([expect.objectContaining({ text: 'Tu margen promedio es de $ 1.500.000 al mes.' })]);
    expect(reads.length).toBeGreaterThanOrEqual(2);
    expect(reads.some((get) => get.queries.some((q) => q.method === 'cursorAfter'))).toBe(true);
    expect(reads[0].queries.map((q) => `${q.method}:${q.attribute}`)).toEqual(expect.arrayContaining(['greaterThanEqual:occurredAt', 'lessThan:occurredAt']));
    expect(fake.tables.debt_events).toHaveLength(1);
  });

  it('falls back to the template when Gemini fails, and honours DEBT_ADVICE_THRESHOLDS and NIA_WEB_URL', async () => {
    vi.stubEnv('DEBT_ADVICE_THRESHOLDS', '{"tightMarginRatio":0.5}');
    vi.stubEnv('NIA_WEB_URL', 'https://finanzas.example.com/');
    await boot();
    fake = makeNet([
      { intent: 'debt', action: 'advise' },
      { action: 'advise', debtRef: 'vehiculo', extraMinor: 2000000 },
      () => { throw new Error('gemini down'); },
      { intent: 'debt', action: 'simulate' },
      { action: 'simulate', debtRef: 'hipoteca', extraMinor: 5000000 },
    ]);
    seed([debtRow('d1', 'Crédito Vehículo'), debtRow('d2', 'Hipoteca', { termsJson: serializeTerms({ ...loanTerms, kind: 'mortgage', principalMinor: 200000000, n: 360 }) })]);
    fake.tables.debt_events = fake.tables.debt_events.map((event) => (event.debtId === 'd2' ? { ...event, amountMinor: 200000000 } : event));
    seedCashflow(); // margin 25% of the income: tight only with the 50% threshold from the environment

    await run(message('recomiéndame abonar 2 millones al carro'));
    expect(sent()[0].text).toContain('Recomendación para un abono de $ 2.000.000');
    expect(sent()[0].text).toContain('reducir la cuota');

    await run(message('simula 5 millones a la hipoteca'));
    expect(sent()[1].text).toMatch(/Plan completo: https:\/\/finanzas\.example\.com(\s|$)/);
  });

  it('feeds code-computed debt summaries to the analysis intent and tells the model not to do debt math', async () => {
    fake = makeNet([{ intent: 'analysis', action: 'none' }, { reply: 'Todo en orden' }]);
    seed([debtRow('d1', 'Crédito Vehículo')]);

    await run(message('cómo van mis finanzas'));
    const prompt = fake.prompts[1];
    const snapshot = JSON.parse(prompt.split('Datos actuales del hogar:\n')[1]);

    expect(snapshot.debts).toEqual([expect.objectContaining({ name: 'Crédito Vehículo', balanceMinor: 10000000, pastDueMinor: 380381, nextDue: { dueOn: '2026-10-10', amountMinor: 380381 } })]);
    expect(prompt).toMatch(/no calcules saldos, cuotas, intereses ni plazos de deudas/i);
    expect(sent()).toEqual([expect.objectContaining({ text: 'Todo en orden' })]);
  });

  it('still analyses when the debt tables cannot be read', async () => {
    fake = makeNet([{ intent: 'analysis', action: 'none' }, { reply: 'Sin deudas a la vista' }]);
    delete fake.tables.debts;

    await run(message('cómo van mis finanzas'));

    expect(JSON.parse(fake.prompts[1].split('Datos actuales del hogar:\n')[1])).not.toHaveProperty('debts');
    expect(sent()).toEqual([expect.objectContaining({ text: 'Sin deudas a la vista' })]);
  });
});

describe('legal_rate in the Nia entry point', () => {
  const legalAnswers = (legal = {}) => [
    { intent: 'debt', action: 'create' },
    { action: 'legal_rate', legal: { kind: 'usury', modality: 'consumer', month: 'noviembre', year: null, value: 28.2, ...legal } },
  ];
  const NOV_ID = 'lruco202611h1';
  const novRow = (extra = {}) => ({ $id: NOV_ID, householdId: 'h1', kind: 'usury', modality: 'consumer', validFrom: '2026-11-01', validTo: '2026-11-30', value: 2700, source: 'Resolución', verified: true, actorId: 'u0', ...extra });
  const legalWrites = () => fake.posts.filter((post) => post.table === 'legal_rates');
  const legalPatches = () => fake.patches.filter((patch) => patch.table === 'legal_rates');

  it('tells the classifier that a legal rate is a debt-flow request', async () => {
    fake = makeNet(legalAnswers());
    fake.tables.legal_rates = [];

    await run(message('la usura de noviembre es 28.2'));

    expect(fake.prompts[0]).toContain('tasa legal');
    expect(fake.prompts[1]).toContain('legal_rate');
  });

  it('previews first, then Confirm writes one row with team read + update only, and repeated Confirms keep one', async () => {
    fake = makeNet(legalAnswers());
    fake.tables.legal_rates = [];

    await run(message('la usura de noviembre es 28.2'));
    expect(sent()[0].text).toContain('Valor: 28.20% E.A.');
    expect(sent()[0].text).toContain('Mes: noviembre de 2026');
    expect(buttons(sent()[0])).toContain('nia:confirm');
    expect(fake.tables.legal_rates).toEqual([]);
    expect(JSON.parse(fake.tables.bot_sessions[0].pendingJson).pending).toMatchObject({ kind: 'debt', action: 'legal_rate', awaiting: 'confirm', draft: { kind: 'usury', value: 2820 } });

    const confirm = press('nia:confirm');
    await run(confirm);
    await run(confirm); // Telegram delivers the same update again
    await run(press('nia:confirm')); // and the user taps once more

    expect(fake.tables.legal_rates).toEqual([expect.objectContaining({ $id: NOV_ID, householdId: 'h1', kind: 'usury', modality: 'consumer', validFrom: '2026-11-01', validTo: '2026-11-30', value: 2820, verified: false, actorId: 'u7' })]);
    expect(legalWrites()).toEqual([{ table: 'legal_rates', rowId: NOV_ID, permissions: ['read("team:t1")', 'update("team:t1")'] }]);
    expect(legalPatches()).toEqual([]);
    expect(sent().slice(1).map((call) => /ya estaba registrad/.test(call.text))).toEqual([false, true, true]);
  });

  it('updates an existing key through PATCH /rows/{id} and reports an update', async () => {
    fake = makeNet(legalAnswers());
    fake.tables.legal_rates = [novRow()];

    await run(message('la usura de noviembre es 28.2'));
    await run(press('nia:confirm'));

    expect(legalPatches()).toEqual([{ table: 'legal_rates', id: NOV_ID, data: expect.objectContaining({ kind: 'usury', modality: 'consumer', value: 2820, verified: false, actorId: 'u7' }) }]);
    expect(fake.tables.legal_rates).toEqual([expect.objectContaining({ $id: NOV_ID, value: 2820, verified: false })]);
    expect(legalWrites()).toEqual([{ table: 'legal_rates', rowId: NOV_ID, permissions: ['read("team:t1")', 'update("team:t1")'] }]);
    expect(sent()[1].text).toContain('actualicé la tasa de usura');
  });

  it('refuses a rate outside 5-100 before anything is written', async () => {
    fake = makeNet(legalAnswers({ value: 2.82 }));
    fake.tables.legal_rates = [];

    await run(message('la usura de noviembre es 2.82'));

    expect(sent()[0].text).toContain('entre 5 % y 100 %');
    expect(legalWrites()).toEqual([]);
    expect(legalPatches()).toEqual([]);
  });
});

describe('rate_change in the Nia entry point', () => {
  const rateAnswers = (extra = {}) => [
    { intent: 'debt', action: 'create' },
    { action: 'rate_change', debtRef: 'vehiculo', rate: { value: 22, period: 'annual' }, planChange: { effectiveOn: null, mode: null }, ...extra },
  ];
  const rateEvents = () => fake.tables.debt_events.filter((event) => event.kind === 'rate_change');

  it('tells the classifier and the extractor about the rate change', async () => {
    fake = makeNet(rateAnswers());
    seed([debtRow('d1', 'Crédito Vehículo')]);

    await run(message('bajó la tasa del carro a 22% EA'));

    expect(fake.prompts[0]).toContain('cambiar la tasa');
    expect(fake.prompts[1]).toContain('rate_change');
  });

  it('asks the mode with the nia:mode buttons, previews, and writes one event however many times Confirm arrives', async () => {
    fake = makeNet(rateAnswers());
    seed([debtRow('d1', 'Crédito Vehículo')]);

    await run(message('bajó la tasa del carro a 22% EA'));
    expect(buttons(sent()[0])).toEqual(['nia:mode:keep_term', 'nia:mode:keep_installment']);
    expect(JSON.parse(fake.tables.bot_sessions[0].pendingJson).pending).toMatchObject({ action: 'rate_change', awaiting: 'mode', debtId: 'd1' });

    await run(press('nia:mode:keep_term'));
    expect(sent()[1].text).toContain('Cambio de tasa en Crédito Vehículo');
    expect(buttons(sent()[1])).toContain('nia:confirm');
    expect(rateEvents()).toHaveLength(0);

    const confirm = press('nia:confirm');
    await run(confirm);
    await run(confirm); // Telegram delivers the same update again
    await run(press('nia:confirm')); // and the user taps once more

    expect(rateEvents()).toEqual([expect.objectContaining({ effectiveOn: '2026-10-13', dedupeKey: expect.stringMatching(/^debt:/), actorId: 'u7', source: 'telegram' })]);
    expect(sent().slice(2).map((call) => /ya estaba registrado/.test(call.text))).toEqual([false, true, true]);
  });

  it('ignores a mode button that arrives after the request was confirmed', async () => {
    fake = makeNet(rateAnswers());
    seed([debtRow('d1', 'Crédito Vehículo')]);

    await run(message('bajó la tasa del carro a 22% EA'));
    await run(press('nia:mode:keep_term'));
    await run(press('nia:confirm'));
    await run(press('nia:mode:keep_installment'));

    expect(rateEvents()).toHaveLength(1);
    expect(sent()[sent().length - 1].text).toContain('No tengo una solicitud');
  });
});

describe('charge_change in the Nia entry point', () => {
  const charges = [
    { id: 'life', kind: 'insurance', label: 'Seguro de vida', basis: 'pctOutstanding', value: 0.05, cadence: 'per_installment' },
    { id: 'all', kind: 'insurance', label: 'Seguro todo riesgo', basis: 'fixed', value: 5000, cadence: 'per_installment' },
    { id: 'fee', kind: 'fee', label: 'Cuota de manejo', basis: 'fixed', value: 10000, cadence: 'per_installment' },
  ];
  const chargeAnswers = (planChange) => [
    { intent: 'debt', action: 'create' },
    { action: 'charge_change', debtRef: 'vehiculo', planChange: { effectiveOn: null, mode: null, chargeRef: 'seguro', op: 'remove', newValue: null, ...planChange } },
  ];
  const chargeEvents = () => fake.tables.debt_events.filter((event) => event.kind === 'charge_change');
  const seedCharged = () => seed([debtRow('d1', 'Crédito Vehículo', { termsJson: serializeTerms({ ...loanTerms, charges }) })]);

  it('tells the classifier and the extractor about the charge change', async () => {
    fake = makeNet(chargeAnswers({}));
    seedCharged();

    await run(message('quita el seguro del carro'));

    expect(fake.prompts[0]).toContain('seguro o cargo');
    expect(fake.prompts[1]).toContain('charge_change');
  });

  it('asks which insurance with nia:chg buttons, previews the removal, and a repeated Confirm writes one event', async () => {
    fake = makeNet(chargeAnswers({}));
    seedCharged();

    await run(message('quita el seguro del carro'));
    expect(buttons(sent()[0])).toEqual(['nia:chg:0', 'nia:chg:1']);
    expect(JSON.parse(fake.tables.bot_sessions[0].pendingJson).pending).toMatchObject({ action: 'charge_change', awaiting: 'charge', candidates: ['life', 'all'] });

    await run(press('nia:chg:1'));
    expect(sent()[1].text).toContain('Se quita: Seguro todo riesgo');
    expect(chargeEvents()).toHaveLength(0);

    const confirm = press('nia:confirm');
    await run(confirm);
    await run(confirm); // Telegram delivers the same update again
    await run(press('nia:chg:0')); // a stale button after the request was confirmed

    expect(chargeEvents()).toEqual([expect.objectContaining({ dedupeKey: expect.stringMatching(/^debt:/), actorId: 'u7', source: 'telegram' })]);
    expect(JSON.parse(chargeEvents()[0].payloadJson).charges.map((charge) => charge.id)).toEqual(['life', 'fee']);
    expect(sent().slice(2).map((call) => /ya estaba registrado|No tengo una solicitud/.test(call.text))).toEqual([false, true, true]);
  });

  it('refuses to add a charge and points to the web', async () => {
    fake = makeNet(chargeAnswers({ op: 'add', chargeRef: 'seguro de desempleo', newValue: 20000 }));
    seedCharged();

    await run(message('agrega un seguro de desempleo al carro'));

    expect(sent()[0].text).toContain('web');
    expect(chargeEvents()).toHaveLength(0);
  });
});

describe('restructure in the Nia entry point', () => {
  const restructureAnswers = (planChange = {}) => [
    { intent: 'debt', action: 'create' },
    { action: 'restructure', debtRef: 'vehiculo', rate: { value: null }, charges: [], planChange: { effectiveOn: null, n: 48, system: null, periodicity: null, firstDueOn: '2026-12-05', waiveLate: false, ...planChange } },
  ];
  const restructures = () => fake.tables.debt_events.filter((event) => event.kind === 'restructure');

  it('tells the classifier and the extractor about the restructure', async () => {
    fake = makeNet(restructureAnswers());
    seed([debtRow('d1', 'Crédito Vehículo')]);

    await run(message('reestructura el carro a 48 cuotas'));

    expect(fake.prompts[0]).toContain('reestructurar');
    expect(fake.prompts[1]).toContain('restructure');
    expect(fake.prompts[1]).toContain('waiveLate');
  });

  it('previews the arrears and the new plan, and a repeated Confirm writes one event', async () => {
    fake = makeNet(restructureAnswers());
    seed([debtRow('d1', 'Crédito Vehículo')]);

    await run(message('reestructura el carro a 48 cuotas, primera cuota 2026-12-05'));
    expect(sent()[0].text).toContain('Reestructuración de Crédito Vehículo');
    expect(sent()[0].text).toContain('Primera cuota: 2026-12-05');
    expect(buttons(sent()[0])).toEqual(['nia:confirm', 'nia:edit', 'nia:cancel']);
    expect(JSON.parse(fake.tables.bot_sessions[0].pendingJson).pending).toMatchObject({ action: 'restructure', awaiting: 'confirm', debtId: 'd1', draft: { n: 48, firstDueOn: '2026-12-05' } });
    expect(restructures()).toHaveLength(0);

    const confirm = press('nia:confirm');
    await run(confirm);
    await run(confirm); // Telegram delivers the same update again
    await run(press('nia:confirm')); // and the user taps once more

    expect(restructures()).toEqual([expect.objectContaining({ effectiveOn: '2026-10-13', dedupeKey: expect.stringMatching(/^debt:/), actorId: 'u7', source: 'telegram' })]);
    expect(JSON.parse(restructures()[0].payloadJson).terms).toMatchObject({ n: 48, firstDueOn: '2026-12-05', principalMinor: 10180876 });
    expect(sent().slice(1).map((call) => /ya estaba registrad/.test(call.text))).toEqual([false, true, true]);
  });
});

describe('late_policy in the Nia entry point', () => {
  const lateAnswers = (late = {}) => [
    { intent: 'debt', action: 'create' },
    { action: 'late_policy', debtRef: 'vehiculo', late: { mode: 'usury', ...late } },
  ];
  const lateEvents = () => fake.tables.debt_events.filter((event) => event.kind === 'late_policy');

  it('tells the classifier and the extractor about the mora', async () => {
    fake = makeNet(lateAnswers());
    seed([debtRow('d1', 'Crédito Vehículo')]);

    await run(message('activa mora a la usura en el carro'));

    expect(fake.prompts[0]).toContain('configurar la mora');
    expect(fake.prompts[1]).toContain('late_policy');
    expect(fake.prompts[1]).toContain('contract_multiple');
  });

  it('previews the mode, the date and the cap, and a repeated Confirm writes one late_policy event', async () => {
    fake = makeNet(lateAnswers());
    seed([debtRow('d1', 'Crédito Vehículo')]);

    await run(message('activa mora a la usura en el carro'));
    expect(sent()[0].text).toContain('Mora de Crédito Vehículo');
    expect(sent()[0].text).toContain('Desde: 2026-10-13');
    expect(sent()[0].text).toContain('Tope de usura vigente: 28.59% E.A.');
    expect(buttons(sent()[0])).toEqual(['nia:confirm', 'nia:edit', 'nia:cancel']);
    expect(JSON.parse(fake.tables.bot_sessions[0].pendingJson).pending).toMatchObject({ action: 'late_policy', awaiting: 'confirm', debtId: 'd1', draft: { effectiveOn: '2026-10-13', late: { mode: 'usury', graceDays: 0 } } });
    expect(lateEvents()).toHaveLength(0);

    const confirm = press('nia:confirm');
    await run(confirm);
    await run(confirm); // Telegram delivers the same update again
    await run(press('nia:confirm')); // and the user taps once more

    expect(lateEvents()).toEqual([expect.objectContaining({ effectiveOn: '2026-10-13', amountMinor: 0, dedupeKey: expect.stringMatching(/^debt:/), actorId: 'u7', source: 'telegram' })]);
    expect(JSON.parse(lateEvents()[0].payloadJson)).toEqual({ late: { mode: 'usury', graceDays: 0 } });
    expect(sent().slice(1).map((call) => /ya estaba registrad/.test(call.text))).toEqual([false, true, true]);
  });
});

describe('explain in the Nia entry point', () => {
  const REVIEW = 'Este tema está en revisión';
  const writes = () => fake.posts.length + fake.patches.length;
  const markerOf = () => {
    const { history } = JSON.parse(fake.tables.bot_sessions[0].pendingJson);
    return history[history.length - 1].explain;
  };

  it('tells the classifier that glossary questions about debts are explain requests', async () => {
    fake = makeNet([{ intent: 'conversation', action: 'none', reply: 'Hola' }]);
    await run(message('hola'));

    expect(fake.prompts[0]).toContain('explain');
  });

  it('moves «qué es la mora», classified as conversation, to the explain flow with the topic mora', async () => {
    fake = makeNet([{ intent: 'conversation', action: 'none', reply: 'La mora es un cargo.' }, { action: 'explain', topic: 'mora' }]);
    seed([debtRow('d1', 'Crédito Vehículo')]);
    const before = writes();

    await run(message('qué es la mora'));

    expect(sent()).toHaveLength(1);
    expect(sent()[0].text).toContain(REVIEW);
    expect(sent()[0].text).not.toContain('La mora es un cargo');
    expect(fake.prompts).toHaveLength(2);
    expect(fake.prompts[1]).toContain('Crédito Vehículo');
    expect(markerOf()).toEqual({ topic: 'mora', debtId: 'd1' });
    expect(fake.tables.debt_events).toHaveLength(1);
    expect(fake.tables.transactions).toHaveLength(0);
    expect(writes() - before).toBe(1); // the session row only
  });

  it('also moves an analysis classification, and falls back to the keyword topic when the extraction gives none', async () => {
    fake = makeNet([{ intent: 'analysis', action: 'none', reply: null }, { action: 'explain', topic: null }]);
    seed([debtRow('d1', 'Crédito Vehículo')]);

    await run(message('explícame la usura'));

    expect(sent()[0].text).toContain(REVIEW);
    expect(markerOf()).toEqual({ topic: 'usury_ibc', debtId: 'd1' });
    expect(fake.prompts).toHaveLength(2);
  });

  it('adds no Gemini call to an under-review topic when NIA_EXPLAIN_PARAPHRASE is on, and keeps the review answer', async () => {
    vi.stubEnv('NIA_EXPLAIN_PARAPHRASE', 'true');
    await boot();
    fake = makeNet([{ intent: 'conversation', action: 'none', reply: 'La mora es un cargo.' }, { action: 'explain', topic: 'mora' }]);
    seed([debtRow('d1', 'Crédito Vehículo')]);

    await run(message('qué es la mora'));

    expect(sent()[0].text).toContain(REVIEW);
    expect(fake.prompts).toHaveLength(2);
  });

  it('keeps «pagué la mora» as a payment when it is classified as debt, and as a conversation when it is not', async () => {
    fake = makeNet([{ intent: 'debt', action: 'pay' }, { action: 'pay', debtRef: 'vehiculo', amountMinor: 380381 }]);
    seed([debtRow('d1', 'Crédito Vehículo')]);
    await run(message('pagué la mora'));
    expect(sent()[0].text).toContain('Abono a Crédito Vehículo');
    expect(buttons(sent()[0])).toContain('nia:confirm');

    fake = makeNet([{ intent: 'conversation', action: 'none', reply: 'Anotado, ¿de cuánto fue?' }]);
    await run(message('pagué la mora'));
    expect(sent()[0].text).toBe('Anotado, ¿de cuánto fue?');
    expect(fake.prompts).toHaveLength(1);
  });

  it('keeps a glossary question with no debt concept in conversation, with a single model call', async () => {
    fake = makeNet([{ intent: 'conversation', action: 'none', reply: 'Una acción es una parte de una empresa.' }]);
    seed([debtRow('d1', 'Crédito Vehículo')]);

    await run(message('qué es una acción en bolsa'));

    expect(sent()).toEqual([expect.objectContaining({ text: 'Una acción es una parte de una empresa.' })]);
    expect(fake.prompts).toHaveLength(1);
    expect(markerOf()).toBeUndefined();
  });

  it('answers a follow-up «¿y con ejemplo?» for the marker topic and debt', async () => {
    fake = makeNet([
      { intent: 'conversation', action: 'none', reply: 'x' }, { action: 'explain', topic: 'mora', debtRef: 'moto' },
      { intent: 'conversation', action: 'none', reply: 'y' }, { action: 'explain', topic: null },
    ]);
    seed([debtRow('d1', 'Carro'), debtRow('d2', 'Moto')]);

    await run(message('qué es la mora de la moto'));
    expect(markerOf()).toEqual({ topic: 'mora', debtId: 'd2' });
    await run(message('¿y con ejemplo?'));

    expect(sent()).toHaveLength(2);
    expect(sent()[1].text).toContain(REVIEW);
    expect(markerOf()).toEqual({ topic: 'mora', debtId: 'd2' });
    expect(fake.prompts).toHaveLength(4);
  });

  it('keeps the pending payment through an explanation, and the later Confirm writes once', async () => {
    fake = makeNet([{ intent: 'debt', action: 'pay' }, { action: 'pay', debtRef: 'vehiculo', amountMinor: 380381 }, { intent: 'conversation', action: 'none', reply: 'x' }, { action: 'explain', topic: 'usury_ibc' }]);
    seed([debtRow('d1', 'Crédito Vehículo')]);

    await run(message('pagué 380 mil al carro'));
    const pending = JSON.parse(fake.tables.bot_sessions[0].pendingJson).pending;
    await run(message('¿qué es la usura?'));

    expect(sent()[1].text).toContain(REVIEW);
    expect(JSON.parse(fake.tables.bot_sessions[0].pendingJson).pending).toEqual(pending);
    expect(fake.tables.bot_sessions[0].status).toBe('awaiting_confirmation');
    expect(payments()).toHaveLength(0);

    await run(press('nia:confirm'));
    expect(payments()).toHaveLength(1);
  });

  it('routes a nia:exp: button before the stage check: it works with no pending and no model call', async () => {
    fake = makeNet([]);
    seed([debtRow('d1', 'Crédito Vehículo')]);

    await run(press('nia:exp:mora:d1'));

    expect(sent()).toHaveLength(1);
    expect(sent()[0].text).toContain(REVIEW);
    expect(fake.prompts).toHaveLength(0);
    expect(markerOf()).toEqual({ topic: 'mora', debtId: 'd1' });
    expect(fake.tables.debt_events).toHaveLength(1);
  });

  it('keeps the pending of a waiting Confirm when an explain button is tapped', async () => {
    fake = makeNet([{ intent: 'debt', action: 'pay' }, { action: 'pay', debtRef: 'vehiculo', amountMinor: 380381 }]);
    seed([debtRow('d1', 'Crédito Vehículo')]);
    await run(message('pagué 380 mil al carro'));

    await run(press('nia:exp:charges:d1'));
    await run(press('nia:confirm'));

    expect(sent()[1].text).toContain(REVIEW);
    expect(payments()).toHaveLength(1);
  });

  it('answers a deleted or foreign-scope debt on an explain button with a short safe reply and no write', async () => {
    fake = makeNet([]);
    seed([debtRow('d2', 'Carro de ella', { ownerScope: 'partner' })]);
    const before = writes();

    await run(press('nia:exp:mora:gone'));
    await run(press('nia:exp:mora:d2'));
    await run(press('nia:exp:tax_returns'));

    expect(sent().map((call) => /ya no está disponible/.test(call.text))).toEqual([true, true, true]);
    expect(writes()).toBe(before);
    expect(fake.tables.bot_sessions).toHaveLength(0);
  });

  it('still ignores a stale stage button with no pending', async () => {
    fake = makeNet([]);
    seed([debtRow('d1', 'Crédito Vehículo')]);
    const before = writes();

    await run(press('nia:mode:keep_term'));
    await run(press('nia:pick:d1'));

    expect(sent().map((call) => call.text)).toEqual(['No tengo una solicitud de deuda pendiente.', 'No tengo una solicitud de deuda pendiente.']);
    expect(writes()).toBe(before);
  });
});

describe('advisor setup in the Nia entry point', () => {
  const MV_TEXT = { value: 2.1, period: 'monthly', compounding: 'effective', timing: 'arrears' };
  const bancolombia = (extra = {}) => ({ action: 'setup', kind: 'card', name: 'Tarjeta Bancolombia', lender: 'Bancolombia', rate: MV_TEXT, setup: { presets: { fee: 45000, iva: true } }, ...extra });
  const answer = (card) => ({ action: 'setup', kind: 'card', setup: { card } });
  const classify = { intent: 'debt', action: 'create' };
  const MIN_BUTTONS = ['nia:min:interest_fees_plus_pct', 'nia:min:installments_due', 'nia:min:pct_balance', 'nia:min:unknown'];
  const writes = () => fake.posts.length + fake.patches.length;
  const sessionPending = () => JSON.parse(fake.tables.bot_sessions[0].pendingJson).pending;
  const OWNER_TEXT = 'tarjeta Bancolombia, extracto 2,1% MV, cuota de manejo 45.000 + IVA';

  it('sends a described card to the advisor: the proposal has the EA echo, the linked IVA and the rule buttons, and nothing is written', async () => {
    fake = makeNet([classify, bancolombia()]);

    await run(message(OWNER_TEXT));

    expect(sent()).toHaveLength(1);
    expect(sent()[0].text).toContain('Nueva tarjeta: Tarjeta Bancolombia');
    expect(sent()[0].text).toContain('2.1% MV ≈ 28.32% EA');
    expect(sent()[0].text).toContain('IVA: $ 8.550');
    expect(buttons(sent()[0])).toEqual(MIN_BUTTONS);
    expect(sessionPending()).toMatchObject({ kind: 'debt', action: 'setup', awaiting: 'minimum', draft: { setup: { name: 'Tarjeta Bancolombia' } } });
    expect(fake.tables.debts).toHaveLength(0);
    expect(fake.tables.debt_events).toHaveLength(0);
    expect(fake.prompts).toHaveLength(2);
    expect(fake.posts.map((post) => post.table)).toEqual(['bot_sessions']);
  });

  it('tells the classifier that a short answer to the questions of a debt in progress is a debt message, and shows it the pending', async () => {
    fake = makeNet([classify, bancolombia(), classify, answer({ statementDay: 15, dueDay: 30 })]);
    await run(message(OWNER_TEXT));
    await run(message('el corte es el 15 y el pago el 30'));

    expect(fake.prompts[0]).toContain('el corte es el 15');
    expect(fake.prompts[2]).toContain('"action":"setup"');
    expect(fake.prompts[3]).toContain('Hay una configuración de deuda en curso');
    expect(fake.prompts[3]).toContain('Tarjeta Bancolombia');
    expect(fake.prompts[1]).not.toContain('configuración de deuda en curso');
    expect(sent()[1].text).not.toContain('¿Qué día del mes es el corte');
    expect(sent()[1].text).toContain('¿Cómo calcula el banco tu pago mínimo?');
    expect(sessionPending()).toMatchObject({ awaiting: 'minimum', draft: { setup: { card: { statementDay: 15, dueDay: 30 } } } });
  });

  it('still reaches the advisor when the classifier calls «el corte es el 15» a conversation, but leaves other chat alone', async () => {
    fake = makeNet([classify, bancolombia(), { intent: 'conversation', action: 'none', reply: 'Anotado' }, answer({ statementDay: 15 }), { intent: 'conversation', action: 'none', reply: 'De nada' }]);
    await run(message(OWNER_TEXT));
    await run(message('el corte es el 15'));

    expect(sent()[1].text).toContain('¿Qué día del mes es la fecha límite');
    expect(sent()[1].text).not.toBe('Anotado');
    expect(sessionPending().draft.setup.card.statementDay).toBe(15);

    await run(message('gracias'));
    expect(sent()[2].text).toBe('De nada');
    expect(fake.prompts).toHaveLength(5); // the thanks used the classifier call only
    expect(sessionPending()).toMatchObject({ action: 'setup' });
  });

  it('answers a glossary question while the setup waits, and keeps the setup pending as it was', async () => {
    fake = makeNet([classify, bancolombia(), { intent: 'conversation', action: 'none', reply: 'x' }, { action: 'explain', topic: 'usury_ibc' }]);
    await run(message(OWNER_TEXT));
    const waiting = sessionPending();
    await run(message('¿qué es la usura? ¿es el 28%?'));

    expect(sent()[1].text).not.toContain('Nueva tarjeta');
    expect(sessionPending()).toEqual(waiting);
  });

  it('routes nia:min: and nia:conv: buttons to the setup, and Confirm creates exactly one card however many times it arrives', async () => {
    fake = makeNet([classify, bancolombia({ rate: { value: 2, period: 'monthly' } }), classify, answer({ statementDay: 15, dueDay: 30 })]);
    await run(message('tarjeta Bancolombia al 2% mensual, cuota de manejo 45.000 + IVA'));
    expect(buttons(sent()[0])).toEqual(['nia:conv:EA', 'nia:conv:NAMV', 'nia:conv:MV', 'nia:conv:NATV', 'nia:conv:NATA']);

    await run(press('nia:conv:MV'));
    expect(sent()[1].text).toContain('2% MV ≈ 26.82% EA');
    expect(buttons(sent()[1])).toEqual(MIN_BUTTONS);
    await run(message('el corte es el 15 y el pago el 30'));
    await run(press('nia:min:interest_fees_plus_pct'));
    expect(buttons(sent()[3])).toContain('nia:confirm');
    expect(fake.tables.debts).toHaveLength(0);

    const confirm = press('nia:confirm');
    await run(confirm);
    await run(confirm); // Telegram delivers the same update again
    await run(press('nia:confirm')); // and the user taps once more

    expect(fake.tables.debts).toEqual([expect.objectContaining({ name: 'Tarjeta Bancolombia', kind: 'card', ownerScope: 'you', actorId: 'u7', principalMinor: 0 })]);
    expect(JSON.parse(fake.tables.debts[0].termsJson).card).toMatchObject({ statementDay: 15, dueDay: 30, minPayment: { rule: 'interest_fees_plus_pct' } });
    expect(fake.tables.debt_events).toHaveLength(0);
    expect(fake.tables.transactions).toHaveLength(0);
    expect(sent().slice(4).map((call) => /ya estaba registrada/.test(call.text))).toEqual([false, true, true]);
    expect(fake.prompts).toHaveLength(4); // two turns, two calls each: the buttons and the Confirms call no model
  });

  it('ignores a stale nia:min: or nia:conv: button: no pending, or a request that moved on', async () => {
    fake = makeNet([]);
    await run(press('nia:min:pct_balance'));
    await run(press('nia:conv:MV'));
    expect(sent().map((call) => call.text)).toEqual(['No tengo una solicitud de deuda pendiente.', 'No tengo una solicitud de deuda pendiente.']);
    expect(writes()).toBe(0);

    fake = makeNet([classify, bancolombia(), classify, answer({ statementDay: 15, dueDay: 30, minRule: 'pct_balance' })]);
    await run(message(OWNER_TEXT));
    await run(message('el corte es el 15, el pago el 30 y el mínimo es el 5% del total'));
    const before = writes();
    const ready = fake.tables.bot_sessions[0].pendingJson;
    await run(press('nia:min:installments_due'));
    await run(press('nia:conv:EA'));

    expect(sent().slice(-2).map((call) => call.text)).toEqual(['Esa opción ya no aplica a la solicitud actual.', 'Esa opción ya no aplica a la solicitud actual.']);
    expect(writes()).toBe(before);
    expect(fake.tables.bot_sessions[0].pendingJson).toBe(ready);
    expect(fake.tables.debts).toHaveLength(0);
  });
});
