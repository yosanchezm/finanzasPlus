// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serializeTerms } from '../../packages/finance-core/index.js';

// Wiring test: runs the real Function entry point against an in-memory Appwrite, Telegram and Gemini
// (a fake `undici.fetch`). No network is ever touched.
const net = vi.hoisted(() => ({ fetch: null }));
vi.mock('undici', () => ({ default: { FormData: class FormData {}, fetch: (...args) => net.fetch(...args) } }));

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
