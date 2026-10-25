// @vitest-environment node
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lineIds } from '../packages/finance-core/index.js';
import { runMigration } from './migrate-budgets.mjs';

const H = 'household-1';
const ENV = {
  VITE_APPWRITE_ENDPOINT: 'https://appwrite.test/v1', VITE_APPWRITE_PROJECT_ID: 'project-test',
  VITE_APPWRITE_DATABASE_ID: 'db-test', APPWRITE_API_KEY: 'key-test', VITE_APPWRITE_HOUSEHOLD_TEAM_ID: 'team-test',
};

const category = (id, name, kind = 'need') => ({ $id: id, householdId: H, name, kind, archived: false });
const budget = (id, categoryId, month, plannedMinor) => ({ $id: id, householdId: H, categoryId, month, plannedMinor, alertAtPercent: null });

// In-memory Appwrite REST: only the rows endpoints the runner uses. A missing table answers 404.
function fakeAppwrite(tables, { failOnPost = () => false } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    const [, table, id] = new URL(url).pathname.match(/\/tables\/([^/]+)\/rows(?:\/([^/]+))?$/);
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, table, id, body });
    const reply = (status, data) => ({ ok: status < 400, status, statusText: String(status), text: async () => JSON.stringify(data) });
    if (!tables[table]) return reply(404, { message: 'Table not found' });
    if (method === 'GET') return reply(200, { rows: tables[table], total: tables[table].length });
    if (method === 'POST') {
      if (failOnPost(body.rowId)) return reply(500, { message: 'boom' });
      if (tables[table].some((row) => row.$id === body.rowId)) return reply(409, { message: 'exists' });
      tables[table].push({ $id: body.rowId, ...body.data });
      return reply(201, {});
    }
    if (method === 'PATCH') {
      Object.assign(tables[table].find((row) => row.$id === id), body.data);
      return reply(200, {});
    }
    return reply(405, {});
  };
  const writes = () => calls.filter((call) => call.method !== 'GET');
  return { fetch, calls, writes };
}

const baseTables = () => ({
  categories: [
    category('c-mercado', 'Mercado'), category('c-renta', 'Renta'),
    category('c-cf', 'Costos financieros', 'need'), category('c-cf2', 'costos financieros', 'want'),
  ],
  budgets: [
    budget('b1', 'c-mercado', '2026-09', 600000), budget('b2', 'c-mercado', '2026-10', 900000),
    budget('b3', 'c-renta', '2026-10', 1500000), budget('b0', 'c-renta', '2026-10', 0),
  ],
  budget_lines: [],
});

describe('migrate-budgets runner', () => {
  let dir;
  const logs = [];
  const run = async (argv, server, { env = ENV, backupDir = dir } = {}) => {
    logs.length = 0;
    const code = await runMigration({
      argv, env, fetch: server.fetch, backupDir, log: (line) => logs.push(line), error: (line) => logs.push(line),
    });
    return { code, out: logs.join('\n') };
  };

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'migrate-budgets-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('is a dry run by default: reports the plan and performs zero writes', async () => {
    const tables = baseTables();
    tables.budgets.push(budget('b9', 'c-mercado', '2026-10', 700000));
    const server = fakeAppwrite(tables);
    const { code, out } = await run([], server);
    expect(code).toBe(0);
    expect(server.writes()).toEqual([]);
    expect(readdirSync(dir)).toEqual([]);
    const counts = [['Filas leídas', 5], ['Líneas a crear', 4], ['Ya presentes', 0], ['Omitidas', 1], ['Plan sembrado', 2], ['Duplicados', 1], ['Categorías a parchear', 2]];
    for (const [label, count] of counts) expect(out).toMatch(new RegExp(`${label}:\\s+${count}\\b`));
  });

  it('aborts --apply without writing when budget_lines is missing (a dry run still reports)', async () => {
    const tables = baseTables();
    delete tables.budget_lines;
    const server = fakeAppwrite(tables);
    const { code, out } = await run(['--apply'], server);
    expect(code).toBe(1);
    expect(out).toContain('Ejecuta npm run migrate:appwrite');
    expect(server.writes()).toEqual([]);
    expect(readdirSync(dir)).toEqual([]);
    const dry = await run([], fakeAppwrite(tables));
    expect(dry.code).toBe(0);
    expect(dry.out).toContain('npm run migrate:appwrite');
  });

  it('writes the backup before the first write, then rows with team permissions, then the kind patches', async () => {
    const tables = baseTables();
    const server = fakeAppwrite(tables);
    const { code } = await run(['--apply'], server);
    expect(code).toBe(0);

    const [file] = readdirSync(dir);
    expect(file).toMatch(/^budget-migration-.*\.json$/);
    const backup = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    expect(backup.budgets.map((row) => row.$id)).toEqual(['b1', 'b2', 'b3', 'b0']);
    expect(backup.costCategories.map((row) => [row.$id, row.kind])).toEqual([['c-cf', 'need'], ['c-cf2', 'want']]);
    expect(backup.existingLineIds).toEqual([]);

    const writes = server.writes();
    expect(writes.map((call) => call.method)).toEqual(['POST', 'POST', 'POST', 'POST', 'POST', 'PATCH', 'PATCH']);
    const posts = writes.filter((call) => call.method === 'POST');
    expect(posts.map((call) => call.body.rowId)).toEqual(expect.arrayContaining(['blb1', 'blb2', 'blb3']));
    expect(posts[0].body.permissions).toEqual(['read("team:team-test")', 'update("team:team-test")']);
    expect(posts[0].body.data).toMatchObject({ householdId: H, rule: 'fixed', source: 'migration' });
    expect(posts[0].body.data.$id).toBeUndefined();
    expect(writes.filter((call) => call.method === 'PATCH').map((call) => [call.id, call.body.data])).toEqual([
      ['c-cf', { kind: 'debt' }], ['c-cf2', { kind: 'debt' }],
    ]);
    const seedId = lineIds.seeded({ targetType: 'category', targetId: 'c-mercado' }, '2026-11');
    expect(tables.budget_lines.some((row) => row.$id === seedId && row.amountMinor === 900000)).toBe(true);
  });

  it('aborts with zero writes when the backup cannot be written', async () => {
    const blocker = join(dir, 'not-a-dir');
    writeFileSync(blocker, 'x');
    const server = fakeAppwrite(baseTables());
    const { code, out } = await run(['--apply'], server, { backupDir: join(blocker, 'backups') });
    expect(code).toBe(1);
    expect(out).toMatch(/respaldo/i);
    expect(server.writes()).toEqual([]);
  });

  it('a second --apply creates zero lines and patches zero categories', async () => {
    const tables = baseTables();
    await run(['--apply'], fakeAppwrite(tables));
    const second = fakeAppwrite(tables);
    const { code, out } = await run(['--apply'], second);
    expect(code).toBe(0);
    expect(second.writes()).toEqual([]);
    expect(out).toContain('Nada que hacer');
  });

  it('resumes an interrupted run: only the missing lines are created', async () => {
    const tables = baseTables();
    const crashing = fakeAppwrite(tables, { failOnPost: (id) => id === 'blb3' });
    expect((await run(['--apply'], crashing)).code).toBe(1);
    const created = tables.budget_lines.length;
    expect(created).toBeGreaterThan(0);
    expect(tables.categories.find((row) => row.$id === 'c-cf').kind).toBe('need');

    const resumed = fakeAppwrite(tables);
    expect((await run(['--apply'], resumed)).code).toBe(0);
    expect(resumed.writes().filter((call) => call.method === 'POST')).toHaveLength(5 - created);
    expect(tables.budget_lines).toHaveLength(5);
  });

  it('counts a 409 on POST as already done', async () => {
    const tables = baseTables();
    const racing = fakeAppwrite(tables);
    const original = racing.fetch;
    // Another client inserts the row after our read but before our write.
    racing.fetch = async (url, init = {}) => {
      if (init.method === 'POST' && !tables.budget_lines.some((row) => row.$id === 'blb1')) tables.budget_lines.push({ $id: 'blb1' });
      return original(url, init);
    };
    expect((await run(['--apply'], racing)).code).toBe(0);
    expect(tables.budget_lines.filter((row) => row.$id === 'blb1')).toHaveLength(1);
  });

  it('--no-seed omits the seeded plan', async () => {
    const tables = baseTables();
    const { out } = await run(['--no-seed'], fakeAppwrite(tables));
    expect(out).toMatch(/Plan sembrado:\s+0/);
    await run(['--apply', '--no-seed'], fakeAppwrite(tables));
    expect(tables.budget_lines.map((row) => row.$id).sort()).toEqual(['blb1', 'blb2', 'blb3']);
  });

  it('fails fast on missing env vars without any request', async () => {
    const server = fakeAppwrite(baseTables());
    const { code, out } = await run([], server, { env: {} });
    expect(code).toBe(1);
    expect(out).toContain('VITE_APPWRITE_ENDPOINT');
    expect(server.calls).toEqual([]);
  });
});
