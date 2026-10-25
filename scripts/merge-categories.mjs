/**
 * One-off, re-runnable data migration: merges duplicate categories.
 *
 * Every transaction pointing to a duplicate is repointed to the category that
 * stays, then the duplicate is archived (never deleted). Budgets are NOT
 * touched: the legacy `budgets` table is the rollback source after the
 * flexible-budgets cut-over, and `budget_lines` category targets are not
 * rewritten, so repoint those by hand if a line targets a duplicate.
 *
 * Usage:
 *   npm run merge:categories            # dry run, writes nothing
 *   npm run merge:categories -- --apply # backup + writes
 *
 * Re-running after a successful apply is a no-op.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { planMerge } from './lib/category-merge.mjs';

// Edit this list before running. `from` is archived, `into` stays.
const MERGES = [
  { from: 'Comida', into: 'Alimentación' },
  { from: 'Casa', into: 'Hogar' },
  { from: 'Entretenimiento', into: 'Ocio' },
  { from: 'Nómina', into: 'Ingresos' },
  { from: 'Salud y Bienestar', into: 'Salud y Cuidado Personal' },
  { from: 'Servicios', into: 'Servicios Públicos' },
  { from: 'Inteligencia Artificial', into: 'Tecnología' },
  { from: 'Mercado', into: 'Alimentación' },
];

const apply = process.argv.includes('--apply');

const endpoint = (process.env.VITE_APPWRITE_ENDPOINT || '').replace(/\/$/, '');
const projectId = process.env.VITE_APPWRITE_PROJECT_ID;
const databaseId = process.env.VITE_APPWRITE_DATABASE_ID || 'finanzas_plus';
const apiKey = process.env.APPWRITE_API_KEY;

const missing = [
  ['VITE_APPWRITE_ENDPOINT', endpoint],
  ['VITE_APPWRITE_PROJECT_ID', projectId],
  ['APPWRITE_API_KEY', apiKey],
].filter(([, value]) => !value).map(([name]) => name);
if (missing.length) {
  console.error(`Faltan variables para la migración: ${missing.join(', ')}`);
  console.error('Copia .env.example a .env, completa los valores y vuelve a ejecutar npm run merge:categories.');
  process.exit(1);
}

async function request(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${endpoint}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Appwrite-Project': projectId,
      'X-Appwrite-Key': apiKey,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) {
    const message = data.message || data.raw || response.statusText;
    throw new Error(`${method} ${path} → ${response.status}: ${message}`);
  }
  return data;
}

const rowsPath = (table) => `/tablesdb/${encodeURIComponent(databaseId)}/tables/${encodeURIComponent(table)}/rows`;
const rowPath = (table, id) => `${rowsPath(table)}/${encodeURIComponent(id)}`;

async function listAll(table) {
  const rows = [];
  let cursor = null;
  for (;;) {
    const queries = [{ method: 'limit', values: [500] }];
    if (cursor) queries.push({ method: 'cursorAfter', values: [cursor] });
    const search = queries.map((query) => `queries[]=${encodeURIComponent(JSON.stringify(query))}`).join('&');
    const page = await request(`${rowsPath(table)}?${search}`);
    const batch = page.rows || [];
    rows.push(...batch);
    if (batch.length < 500) return rows;
    cursor = batch.at(-1).$id;
  }
}

// The planner works on plain rows with `id`; the originals are kept for the backup.
const withId = (row) => ({ ...row, id: row.$id });

async function write(label, path, options) {
  try {
    await request(path, options);
    console.log(`  ✓ ${label}`);
  } catch (error) {
    console.error(`  ✗ ${label}`);
    throw error;
  }
}

async function main() {
  console.log(`Base de datos: ${databaseId} · modo: ${apply ? 'APLICAR' : 'simulación (sin escrituras)'}`);
  const [categoryRows, transactionRows, budgetRows] = await Promise.all([
    listAll('categories'), listAll('transactions'), listAll('budgets'),
  ]);
  console.log(`Leídas: ${categoryRows.length} categorías, ${transactionRows.length} movimientos, ${budgetRows.length} presupuestos.\n`);

  const categories = categoryRows.map(withId);
  const plan = planMerge({
    categories, transactions: transactionRows.map(withId), budgets: budgetRows.map(withId), merges: MERGES,
  });

  const byName = new Map(categories.map((row) => [row.name, row]));
  plan.summary.forEach((entry, index) => {
    const from = byName.get(entry.from);
    const into = byName.get(entry.into);
    const state = from?.archived ? ' (ya archivada)' : '';
    console.log(`${index + 1}. "${entry.from}"${state} → "${entry.into}": ${entry.transactions} movimientos`);
    if (from && into && from.kind !== into.kind) {
      console.log(`   ⚠ tipos distintos: "${entry.from}" es ${from.kind}, "${entry.into}" es ${into.kind}`);
    }
  });
  console.log('\n⚠ Los presupuestos (budgets y budget_lines) no se modifican: las líneas de presupuesto que apunten a una categoría duplicada no se reasignan.');

  console.log('\nTotales:');
  console.log(`  Movimientos a reasignar:      ${plan.transactionUpdates.length}`);
  console.log(`  Categorías a archivar:        ${plan.archive.length}`);

  const writes = plan.transactionUpdates.length + plan.archive.length;
  if (!writes) {
    console.log('\nNada que hacer: los datos ya están fusionados.');
    return;
  }
  if (!apply) {
    console.log('\nSimulación: no se escribió nada. Ejecuta con --apply para aplicar.');
    return;
  }

  // Backup every original row this run will touch before the first write.
  const touchedTransactions = new Set(plan.transactionUpdates.map((update) => update.id));
  const touchedCategories = new Set(plan.archive);
  const backup = {
    createdAt: new Date().toISOString(),
    databaseId,
    merges: MERGES,
    plan,
    rows: {
      categories: categoryRows.filter((row) => touchedCategories.has(row.$id)),
      transactions: transactionRows.filter((row) => touchedTransactions.has(row.$id)),
    },
  };
  const backupDir = resolve(process.cwd(), 'backups');
  mkdirSync(backupDir, { recursive: true });
  const backupFile = resolve(backupDir, `category-merge-${backup.createdAt.replace(/[:.]/g, '-')}.json`);
  writeFileSync(backupFile, `${JSON.stringify(backup, null, 2)}\n`);
  console.log(`\nRespaldo escrito en ${backupFile}\n`);

  console.log('Reasignando movimientos…');
  for (const update of plan.transactionUpdates) {
    await write(`movimiento ${update.id}: ${update.from} → ${update.to}`, rowPath('transactions', update.id), {
      method: 'PATCH', body: { data: { categoryId: update.to } },
    });
  }

  console.log('Archivando categorías duplicadas…');
  for (const id of plan.archive) {
    await write(`categoría ${id} archivada`, rowPath('categories', id), {
      method: 'PATCH', body: { data: { archived: true } },
    });
  }

  console.log('\nFusión completada.');
}

main().catch((error) => {
  console.error(`\nError: ${error.message}`);
  process.exit(1);
});
