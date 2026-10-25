/**
 * One-off, re-runnable migration: copies the legacy `budgets` rows into `budget_lines` (planner in
 * lib/budget-migration.mjs), seeds the plan from the latest month and patches "Costos financieros" to kind `debt`.
 * `budgets` is never modified; existing line ids are skipped, so re-running is a no-op and an interrupted apply resumes.
 *
 * Usage:
 *   npm run migrate:budgets                       # dry run, writes nothing
 *   npm run migrate:budgets -- --apply [--no-seed] # backup + writes (needs `npm run migrate:appwrite` first)
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { planBudgetMigration } from './lib/budget-migration.mjs';

const TABLE = 'budget_lines';
const MISSING_TABLE_HINT = `La tabla ${TABLE} no existe. Ejecuta npm run migrate:appwrite y vuelve a ejecutar npm run migrate:budgets.`;

const httpError = (message, status) => Object.assign(new Error(message), { status });

// The planner works on plain rows with `id`; the originals are kept for the backup.
const withId = (row) => ({ ...row, id: row.$id });

function createClient({ endpoint, projectId, databaseId, apiKey, fetch }) {
  async function request(path, { method = 'GET', body } = {}) {
    const response = await fetch(`${endpoint}${path}`, {
      method,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Appwrite-Project': projectId, 'X-Appwrite-Key': apiKey },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!response.ok) throw httpError(`${method} ${path} → ${response.status}: ${data.message || data.raw || response.statusText}`, response.status);
    return data;
  }

  const rowsPath = (table) => `/tablesdb/${encodeURIComponent(databaseId)}/tables/${encodeURIComponent(table)}/rows`;
  const rowPath = (table, id) => `${rowsPath(table)}/${encodeURIComponent(id)}`;

  async function listAll(table) {
    const rows = [];
    let cursor = null;
    for (;;) {
      const queries = cursor ? [{ method: 'limit', values: [500] }, { method: 'cursorAfter', values: [cursor] }] : [{ method: 'limit', values: [500] }];
      const search = queries.map((query) => `queries[]=${encodeURIComponent(JSON.stringify(query))}`).join('&');
      const page = await request(`${rowsPath(table)}?${search}`);
      const batch = page.rows || [];
      rows.push(...batch);
      if (batch.length < 500) return rows;
      cursor = batch.at(-1).$id;
    }
  }

  return { listAll, request, rowsPath, rowPath };
}

const lineData = ({ $id, ...data }) => data;

// Returns the exit code. Everything external is injected so the tests never touch the network or the filesystem.
export async function runMigration({ argv, env, fetch, backupDir, log = console.log, error = console.error }) {
  const apply = argv.includes('--apply');
  const seed = !argv.includes('--no-seed');
  const endpoint = (env.VITE_APPWRITE_ENDPOINT || '').replace(/\/$/, '');
  const projectId = env.VITE_APPWRITE_PROJECT_ID;
  const databaseId = env.VITE_APPWRITE_DATABASE_ID || 'finanzas_plus';
  const apiKey = env.APPWRITE_API_KEY;
  const teamId = env.VITE_APPWRITE_HOUSEHOLD_TEAM_ID || env.HOUSEHOLD_TEAM_ID;

  const missing = [
    ['VITE_APPWRITE_ENDPOINT', endpoint],
    ['VITE_APPWRITE_PROJECT_ID', projectId],
    ['APPWRITE_API_KEY', apiKey],
    ...(apply ? [['VITE_APPWRITE_HOUSEHOLD_TEAM_ID (o HOUSEHOLD_TEAM_ID)', teamId]] : []),
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) {
    error(`Faltan variables para la migración: ${missing.join(', ')}`);
    error('Copia .env.example a .env, completa los valores y vuelve a ejecutar npm run migrate:budgets.');
    return 1;
  }

  const client = createClient({ endpoint, projectId, databaseId, apiKey, fetch });

  try {
    log(`Base de datos: ${databaseId} · modo: ${apply ? 'APLICAR' : 'simulación (sin escrituras)'}${seed ? '' : ' · sin plan sembrado'}`);
    const [categoryRows, budgetRows] = await Promise.all([client.listAll('categories'), client.listAll('budgets')]);
    const lineRows = await client.listAll(TABLE).catch((readError) => {
      if (readError.status !== 404) throw readError;
      return null;
    });
    if (lineRows === null) {
      if (apply) {
        error(`\n${MISSING_TABLE_HINT}`);
        return 1;
      }
      log(`\n⚠ ${MISSING_TABLE_HINT} (la simulación continúa sin líneas existentes)`);
    }

    const existingLineIds = (lineRows || []).map((row) => row.$id);
    const plan = planBudgetMigration({ budgets: budgetRows.map(withId), existingLineIds, categories: categoryRows.map(withId), seed });

    log('');
    plan.skipped.forEach(({ id, reason }) => log(`  · omitida ${id}: ${reason}`));
    plan.duplicates.forEach((dup) => log(`  · duplicado en ${dup.month} (${dup.targetId}): se usa ${dup.keptId}, se ignoran ${dup.ignoredIds.join(', ')}`));
    plan.seeds.forEach((line) => log(`  · sembrado ${line.$id}: ${line.targetId} ${line.amountMinor} desde ${line.fromMonth}`));
    plan.costCategoryPatches.forEach((patch) => log(`  · categoría ${patch.id}: ${patch.from} → ${patch.to}`));

    const { summary } = plan;
    log('\nTotales:');
    log(`  Filas leídas:           ${summary.read}`);
    log(`  Líneas a crear:         ${summary.create}`);
    log(`  Ya presentes:           ${summary.present}`);
    log(`  Omitidas:               ${summary.skipped}`);
    log(`  Plan sembrado:          ${summary.seed}`);
    log(`  Duplicados:             ${summary.duplicates}`);
    log(`  Categorías a parchear:  ${summary.patches}`);

    if (!summary.create && !summary.seed && !summary.patches) {
      log('\nNada que hacer: los datos ya están migrados.');
      return 0;
    }
    if (!apply) {
      log('\nSimulación: no se escribió nada. Ejecuta con --apply para aplicar.');
      return 0;
    }

    // Backup before the first write; a failure aborts the run with nothing written.
    const patchIds = new Set(plan.costCategoryPatches.map((patch) => patch.id));
    const backup = {
      createdAt: new Date().toISOString(),
      databaseId,
      budgets: budgetRows,
      costCategories: categoryRows.filter((row) => patchIds.has(row.$id)),
      existingLineIds,
      plan,
    };
    try {
      mkdirSync(backupDir, { recursive: true });
      const backupFile = resolve(backupDir, `budget-migration-${backup.createdAt.replace(/[:.]/g, '-')}.json`);
      writeFileSync(backupFile, `${JSON.stringify(backup, null, 2)}\n`);
      log(`\nRespaldo escrito en ${backupFile}\n`);
    } catch (backupError) {
      error(`\nNo se pudo escribir el respaldo (${backupError.message}). Se aborta sin escribir nada.`);
      return 1;
    }

    const permissions = [`read("team:${teamId}")`, `update("team:${teamId}")`];
    const write = async (label, path, options) => {
      try {
        await client.request(path, options);
        log(`  ✓ ${label}`);
      } catch (writeError) {
        // The id is deterministic: a 409 means another run or client already wrote this line.
        if (options.method !== 'POST' || writeError.status !== 409) {
          error(`  ✗ ${label}`);
          throw writeError;
        }
        log(`  = ${label} (ya existía)`);
      }
    };

    log('Creando líneas…');
    for (const line of [...plan.creates, ...plan.seeds]) {
      await write(`línea ${line.$id}`, client.rowsPath(TABLE), {
        method: 'POST', body: { rowId: line.$id, data: lineData(line), permissions },
      });
    }

    log('Actualizando categorías de costos financieros…');
    for (const patch of plan.costCategoryPatches) {
      await write(`categoría ${patch.id}: ${patch.from} → ${patch.to}`, client.rowPath('categories', patch.id), {
        method: 'PATCH', body: { data: { kind: patch.to } },
      });
    }

    log('\nMigración completada.');
    return 0;
  } catch (failure) {
    error(`\nError: ${failure.message}`);
    return 1;
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  process.exitCode = await runMigration({
    argv: process.argv.slice(2),
    env: process.env,
    fetch: globalThis.fetch,
    backupDir: resolve(process.cwd(), 'backups'),
  });
}
