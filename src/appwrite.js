import { Account, Client, ID, Permission, Query, Role, Storage, TablesDB } from 'appwrite';

const env = import.meta.env;

export const appwriteConfig = {
  endpoint: String(env.VITE_APPWRITE_ENDPOINT || '').replace(/\/$/, ''),
  projectId: String(env.VITE_APPWRITE_PROJECT_ID || ''),
  databaseId: String(env.VITE_APPWRITE_DATABASE_ID || ''),
  householdId: String(env.VITE_APPWRITE_HOUSEHOLD_ID || ''),
  teamId: String(env.VITE_APPWRITE_HOUSEHOLD_TEAM_ID || ''),
  currency: String(env.VITE_APPWRITE_CURRENCY || 'COP').toUpperCase(),
};

export const missingAppwriteConfig = Object.entries({
  VITE_APPWRITE_ENDPOINT: appwriteConfig.endpoint,
  VITE_APPWRITE_PROJECT_ID: appwriteConfig.projectId,
  VITE_APPWRITE_DATABASE_ID: appwriteConfig.databaseId,
  VITE_APPWRITE_HOUSEHOLD_ID: appwriteConfig.householdId,
  VITE_APPWRITE_HOUSEHOLD_TEAM_ID: appwriteConfig.teamId,
}).filter(([, value]) => !value).map(([key]) => key);

const client = new Client();
if (appwriteConfig.endpoint && appwriteConfig.projectId) {
  client.setEndpoint(appwriteConfig.endpoint).setProject(appwriteConfig.projectId);
}

export const account = new Account(client);
export const tablesDB = new TablesDB(client);
export const storage = new Storage(client);

export const TABLES = {
  households: 'households',
  members: 'household_members',
  categories: 'categories',
  transactions: 'transactions',
  budgets: 'budgets',
  goals: 'goals',
  attachments: 'attachments',
};

const teamRole = Role.team(appwriteConfig.teamId);
const userRole = (userId) => Role.user(userId);

export const permissions = {
  readTeam: Permission.read(teamRole),
  createTeam: Permission.create(teamRole),
  updateTeam: Permission.update(teamRole),
  deleteTeam: Permission.delete(teamRole),
  transactionRow: (userId) => [
    Permission.read(teamRole),
    Permission.update(userRole(userId)),
    Permission.delete(userRole(userId)),
  ],
  attachmentRow: () => [Permission.read(teamRole)],
};

function assertConfig() {
  if (missingAppwriteConfig.length) {
    throw new Error(`Faltan variables públicas de Appwrite: ${missingAppwriteConfig.join(', ')}`);
  }
}

function baseQuery() {
  return [Query.equal('householdId', appwriteConfig.householdId), Query.limit(100)];
}

async function listRows(tableId, extraQueries = []) {
  assertConfig();
  const response = await tablesDB.listRows({
    databaseId: appwriteConfig.databaseId,
    tableId,
    queries: [...baseQuery(), ...extraQueries],
    total: false,
  });
  return response.rows || [];
}

export async function getCurrentUser() {
  assertConfig();
  try {
    return await account.get();
  } catch (error) {
    if (error?.code === 401 || error?.type === 'general_unauthorized_scope') return null;
    throw error;
  }
}

export async function signIn(email, password) {
  assertConfig();
  await account.createEmailPasswordSession({ email, password });
  return account.get();
}

export async function createAccount({ name, email, password }) {
  assertConfig();
  await account.create({ userId: ID.unique(), email, password, name });
  await account.createEmailPasswordSession({ email, password });
  return account.get();
}

export async function signOut() {
  if (!appwriteConfig.endpoint) return;
  await account.deleteSession({ sessionId: 'current' });
}

export async function getWorkspace() {
  assertConfig();
  const [household, members, categories, transactions, budgets, goals] = await Promise.all([
    tablesDB.getRow({ databaseId: appwriteConfig.databaseId, tableId: TABLES.households, rowId: appwriteConfig.householdId }),
    listRows(TABLES.members),
    listRows(TABLES.categories, [Query.orderAsc('name')]),
    listRows(TABLES.transactions, [Query.orderDesc('occurredAt')]),
    listRows(TABLES.budgets, [Query.orderDesc('month')]),
    listRows(TABLES.goals),
  ]);

  let workspaceCategories = categories;
  if (!workspaceCategories.length) workspaceCategories = await createDefaultCategories();
  return { household, members, categories: workspaceCategories, transactions, budgets, goals };
}

async function createDefaultCategories() {
  const defaults = [
    ['Hogar', 'need', '#88b8ff', 'home'],
    ['Alimentación', 'need', '#f5c96b', 'receipt'],
    ['Transporte', 'need', '#8ce6bd', 'transport'],
    ['Ocio', 'want', '#ff9a7a', 'sparkles'],
    ['Servicios', 'need', '#bb9cff', 'file'],
    ['Ahorro', 'saving', '#73d8ff', 'target'],
    ['Ingresos', 'income', '#8ce6bd', 'wallet'],
  ];
  const rows = [];
  for (const [name, kind, color, icon] of defaults) {
    rows.push(await tablesDB.createRow({
      databaseId: appwriteConfig.databaseId,
      tableId: TABLES.categories,
      rowId: ID.unique(),
      data: { householdId: appwriteConfig.householdId, name, kind, color, icon, archived: false },
      permissions: [permissions.readTeam, permissions.updateTeam],
    }));
  }
  return rows;
}

export async function createTransaction(userId, data) {
  assertConfig();
  return tablesDB.createRow({
    databaseId: appwriteConfig.databaseId,
    tableId: TABLES.transactions,
    rowId: ID.unique(),
    data,
    permissions: permissions.transactionRow(userId),
  });
}

export async function updateTransaction(rowId, data) {
  assertConfig();
  return tablesDB.updateRow({
    databaseId: appwriteConfig.databaseId,
    tableId: TABLES.transactions,
    rowId,
    data,
  });
}

export async function deleteTransaction(rowId) {
  assertConfig();
  return tablesDB.deleteRow({ databaseId: appwriteConfig.databaseId, tableId: TABLES.transactions, rowId });
}

export async function createReceipt(file, userId, transactionId) {
  assertConfig();
  const uploaded = await storage.createFile({
    bucketId: String(env.VITE_APPWRITE_RECEIPTS_BUCKET_ID || 'receipts'),
    fileId: ID.unique(),
    file,
    permissions: permissions.transactionRow(userId),
  });
  await tablesDB.createRow({
    databaseId: appwriteConfig.databaseId,
    tableId: TABLES.attachments,
    rowId: ID.unique(),
    data: {
      householdId: appwriteConfig.householdId,
      transactionId,
      fileId: uploaded.$id,
      mimeType: file.type || 'application/octet-stream',
      originalName: file.name,
    },
    permissions: permissions.attachmentRow(),
  });
  return uploaded;
}

export async function upsertBudget(rowId, data) {
  assertConfig();
  return tablesDB.upsertRow({
    databaseId: appwriteConfig.databaseId,
    tableId: TABLES.budgets,
    rowId: rowId || ID.unique(),
    data,
    permissions: rowId ? undefined : [permissions.readTeam, permissions.updateTeam],
  });
}

export async function createGoal(data) {
  assertConfig();
  return tablesDB.createRow({
    databaseId: appwriteConfig.databaseId,
    tableId: TABLES.goals,
    rowId: ID.unique(),
    data,
    permissions: [permissions.readTeam, permissions.updateTeam],
  });
}
