import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowDownRight,
  ArrowUpRight,
  Bot,
  CalendarDays,
  Camera,
  Check,
  ChevronDown,
  FileText,
  Flag,
  GitCompareArrows,
  Heart,
  Home,
  LayoutDashboard,
  LogOut,
  Menu,
  Pencil,
  Plus,
  Receipt,
  Send,
  Settings,
  Sparkles,
  Target,
  TrendingUp,
  Upload,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import {
  appwriteConfig,
  createAccount,
  createGoal,
  createReceipt,
  createTransaction,
  deleteTransaction,
  getCurrentUser,
  getWorkspace,
  missingAppwriteConfig,
  signIn,
  signOut,
  updateTransaction,
  upsertBudget,
} from './appwrite';
import './styles.css';

const COLORS = { mint: '#8ce6bd', coral: '#ff9a7a', honey: '#f5c96b', blue: '#88b8ff' };

const formatMoney = (value, currency = appwriteConfig.currency) => new Intl.NumberFormat('es-CO', {
  style: 'currency', currency, maximumFractionDigits: 0,
}).format(Number(value) || 0).replace(/\s?COP/g, '').replace(/\u00a0/g, ' ');

const formatShort = (value) => new Intl.NumberFormat('es-CO', {
  notation: 'compact', compactDisplay: 'short', maximumFractionDigits: 1,
}).format(Number(value) || 0).replace(/\u00a0/g, '');

const dateInputValue = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const monthKey = (date = new Date()) => dateInputValue(date).slice(0, 7);

const formatDate = (isoDate) => {
  if (!isoDate) return 'Sin fecha';
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    .format(date).replace('.', '');
};

const formatMonth = (value) => new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric' })
  .format(new Date(`${value}-01T12:00:00`));

const iconForCategory = (category = {}) => {
  const value = `${category.icon || ''} ${category.name || ''}`.toLowerCase();
  if (value.includes('home') || value.includes('hogar')) return Home;
  if (value.includes('transport') || value.includes('transporte')) return GitCompareArrows;
  if (value.includes('spark') || value.includes('ocio')) return Sparkles;
  if (value.includes('file') || value.includes('servicio')) return FileText;
  if (value.includes('target') || value.includes('ahorro')) return Target;
  if (value.includes('wallet') || value.includes('ingreso')) return Wallet;
  return Receipt;
};

const readableError = (error) => {
  if (!error) return 'Ocurrió un error inesperado.';
  if (error.code === 401) return 'La sesión no es válida o Appwrite rechazó el acceso.';
  if (error.code === 403) return 'Tu usuario no tiene acceso a este hogar. Revisa la membresía del Team.';
  if (error.code === 404) return 'No se encontró el hogar configurado en Appwrite.';
  return error.message || 'Ocurrió un error inesperado.';
};

const resetForm = () => ({
  merchant: '', amount: '', categoryId: '', type: 'expense', owner: 'you', date: dateInputValue(), note: '',
});

const toWorkspaceTransaction = (row, categories) => {
  const category = categories.find((item) => item.$id === row.categoryId);
  return { ...row, categoryName: category?.name || 'Sin categoría', icon: row.type === 'income' ? Wallet : iconForCategory(category) };
};

function App() {
  const [authState, setAuthState] = useState('loading');
  const [authError, setAuthError] = useState('');
  const [user, setUser] = useState(null);
  const [workspace, setWorkspace] = useState({ household: null, members: [], categories: [], transactions: [], budgets: [], goals: [] });

  const enterWorkspace = useCallback(async (currentUser) => {
    setUser(currentUser);
    setAuthError('');
    setAuthState('loadingWorkspace');
    try {
      const loaded = await getWorkspace();
      setWorkspace(loaded);
      setAuthState('ready');
    } catch (error) {
      setAuthError(readableError(error));
      setAuthState('accessError');
    }
  }, []);

  useEffect(() => {
    if (missingAppwriteConfig.length) {
      setAuthError(`Completa estas variables en .env: ${missingAppwriteConfig.join(', ')}`);
      setAuthState('configError');
      return undefined;
    }
    let mounted = true;
    getCurrentUser().then((currentUser) => {
      if (mounted) {
        if (currentUser) enterWorkspace(currentUser);
        else setAuthState('signedOut');
      }
    }).catch((error) => {
      if (mounted) { setAuthError(readableError(error)); setAuthState('signedOut'); }
    });
    return () => { mounted = false; };
  }, [enterWorkspace]);

  const handleAuth = async (payload) => {
    setAuthError('');
    setAuthState('authenticating');
    try {
      const currentUser = payload.mode === 'register'
        ? await createAccount(payload)
        : await signIn(payload.email, payload.password);
      await enterWorkspace(currentUser);
    } catch (error) {
      setAuthError(readableError(error));
      setAuthState('signedOut');
    }
  };

  const handleLogout = async () => {
    try { await signOut(); } finally {
      setUser(null);
      setWorkspace({ household: null, members: [], categories: [], transactions: [], budgets: [], goals: [] });
      setAuthState('signedOut');
    }
  };

  if (authState === 'loading' || authState === 'authenticating' || authState === 'loadingWorkspace') return <LoadingScreen message={authState === 'authenticating' ? 'Validando tu cuenta…' : 'Conectando con tu hogar…'} />;
  if (authState === 'configError') return <ConfigScreen message={authError} />;
  if (authState === 'signedOut') return <AuthScreen onSubmit={handleAuth} error={authError} />;
  if (authState === 'accessError') return <AccessScreen user={user} message={authError} onLogout={handleLogout} onRetry={() => enterWorkspace(user)} />;
  return <FinanceShell user={user} workspace={workspace} onLogout={handleLogout} onRefresh={() => enterWorkspace(user)} />;
}

function FinanceShell({ user, workspace, onLogout, onRefresh }) {
  const [activeView, setActiveView] = useState('Resumen');
  const [scope, setScope] = useState('total');
  const [showTransaction, setShowTransaction] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState(null);
  const [showAssistant, setShowAssistant] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [toast, setToast] = useState('');
  const [saving, setSaving] = useState(false);
  const [receiptFile, setReceiptFile] = useState(null);
  const [newTransaction, setNewTransaction] = useState(resetForm);
  const [showGoal, setShowGoal] = useState(false);

  const { household, members, categories, transactions, budgets, goals } = workspace;
  const currentMonth = monthKey();
  const currentOwnerScope = user.$id === household?.ownerId ? 'you' : 'partner';
  const partnerOwnerScope = currentOwnerScope === 'you' ? 'partner' : 'you';
  const householdName = household?.name || 'Mi hogar';
  const currentMember = members.find((member) => member.userId === user.$id);
  const displayName = currentMember?.alias || user.name || user.email?.split('@')[0] || 'Tu cuenta';
  const decoratedTransactions = useMemo(() => transactions.map((row) => toWorkspaceTransaction(row, categories)), [transactions, categories]);

  const toStoredScope = (uiScope) => uiScope === 'total' ? 'total' : uiScope === 'you' ? currentOwnerScope : partnerOwnerScope;
  const visibleTransactions = useMemo(() => {
    const storedScope = toStoredScope(scope);
    return decoratedTransactions.filter((item) => {
      const inScope = storedScope === 'total' || item.ownerScope === storedScope || item.ownerScope === 'shared';
      return inScope && String(item.occurredAt || '').slice(0, 7) === currentMonth;
    });
  }, [decoratedTransactions, scope, currentMonth, currentOwnerScope, partnerOwnerScope]);

  const totals = useMemo(() => ({
    income: visibleTransactions.filter((item) => item.type === 'income').reduce((sum, item) => sum + Number(item.amountMinor || 0), 0),
    expenses: visibleTransactions.filter((item) => item.type === 'expense').reduce((sum, item) => sum + Number(item.amountMinor || 0), 0),
  }), [visibleTransactions]);

  const categoryStats = useMemo(() => categories.filter((category) => category.kind !== 'income').map((category) => {
    const value = visibleTransactions.filter((item) => item.type === 'expense' && item.categoryId === category.$id)
      .reduce((sum, item) => sum + Number(item.amountMinor || 0), 0);
    const budget = budgets.find((item) => item.categoryId === category.$id && item.month === currentMonth);
    return { ...category, value, budget: Number(budget?.plannedMinor || 0) };
  }), [categories, visibleTransactions, budgets, currentMonth]);
  const categoryTotal = categoryStats.reduce((sum, item) => sum + item.value, 0);
  const budgetTotal = categoryStats.reduce((sum, item) => sum + item.budget, 0);
  const budgetUsed = budgetTotal ? Math.round((categoryTotal / budgetTotal) * 100) : 0;
  const today = new Date();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const remainingDays = Math.max(0, daysInMonth - today.getDate());
  const activeGoal = goals.find((goal) => goal.status !== 'completed') || goals[0];
  const periodLabel = formatMonth(currentMonth);

  const notify = (message) => { setToast(message); window.setTimeout(() => setToast(''), 3000); };
  const openCreateTransaction = () => { setEditingTransaction(null); setReceiptFile(null); setNewTransaction({ ...resetForm(), categoryId: categories[0]?.$id || '' }); setShowTransaction(true); };
  const openEditTransaction = (item) => { setEditingTransaction(item); setReceiptFile(null); setNewTransaction({ merchant: item.merchant || '', amount: String(item.amountMinor || ''), categoryId: item.categoryId || '', type: item.type || 'expense', owner: item.ownerScope === 'shared' ? 'shared' : item.ownerScope === currentOwnerScope ? 'you' : 'partner', date: String(item.occurredAt || '').slice(0, 10) || dateInputValue(), note: item.note || '' }); setShowTransaction(true); };

  const saveTransaction = async (event) => {
    event.preventDefault();
    const amount = Math.round(Number(newTransaction.amount));
    if (!newTransaction.merchant.trim() || !amount || !newTransaction.date) { notify('Completa concepto, monto y fecha.'); return; }
    setSaving(true);
    const storedOwnerScope = toStoredScope(newTransaction.owner);
    const editableData = { type: newTransaction.type, amountMinor: amount, currency: appwriteConfig.currency, occurredAt: new Date(`${newTransaction.date}T12:00:00`).toISOString(), merchant: newTransaction.merchant.trim(), ownerScope: storedOwnerScope, note: newTransaction.note.trim() || undefined, categoryId: newTransaction.categoryId || undefined };
    try {
      let saved;
      if (editingTransaction) saved = await updateTransaction(editingTransaction.$id, editableData);
      else {
        const providerRef = `web:${user.$id}:${Date.now()}`;
        saved = await createTransaction(user.$id, { householdId: household.$id, actorId: user.$id, ...editableData, source: 'web', confidence: 1, status: 'confirmed', providerRef, dedupeKey: providerRef });
        if (receiptFile) await createReceipt(receiptFile, user.$id, saved.$id);
      }
      setShowTransaction(false); setEditingTransaction(null); setReceiptFile(null); setNewTransaction(resetForm());
      await onRefresh();
      notify(editingTransaction ? 'Movimiento actualizado en Appwrite.' : 'Movimiento guardado en Appwrite.');
    } catch (error) { notify(readableError(error)); } finally { setSaving(false); }
  };

  const removeTransaction = async (item) => {
    if (!window.confirm(`¿Eliminar “${item.merchant}”? Esta acción no se puede deshacer.`)) return;
    try { await deleteTransaction(item.$id); await onRefresh(); notify('Movimiento eliminado.'); } catch (error) { notify(readableError(error)); }
  };

  const saveBudget = async (categoryId, value, existing) => {
    const plannedMinor = Math.round(Number(value));
    if (plannedMinor < 0 || Number.isNaN(plannedMinor)) { notify('Escribe un presupuesto válido.'); return; }
    try { await upsertBudget(existing?.$id, { householdId: household.$id, month: currentMonth, categoryId, plannedMinor, alertAtPercent: 80 }); await onRefresh(); notify('Presupuesto actualizado.'); } catch (error) { notify(readableError(error)); }
  };

  const saveGoal = async (goal) => {
    if (!goal.name.trim() || !Number(goal.targetMinor)) return;
    try { await createGoal({ householdId: household.$id, name: goal.name.trim(), targetMinor: Math.round(Number(goal.targetMinor)), currentMinor: 0, targetDate: goal.targetDate ? new Date(`${goal.targetDate}T12:00:00`).toISOString() : undefined, priority: 1, ownerScope: toStoredScope(goal.ownerScope), status: 'active' }); setShowGoal(false); await onRefresh(); notify('Meta creada en Appwrite.'); } catch (error) { notify(readableError(error)); }
  };

  const navItems = [{ label: 'Resumen', icon: LayoutDashboard }, { label: 'Movimientos', icon: Receipt }, { label: 'Presupuesto', icon: Target }, { label: 'Metas', icon: Flag }];
  const scopeLabel = scope === 'total' ? 'Casa' : scope === 'you' ? 'Tú' : 'Pareja';

  return <div className="app-shell"><div className="grain" /><aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}><div className="brand-lockup"><div className="brand-mark"><span /></div><div><div className="brand-name">finanzas<span>+</span></div><div className="brand-tagline">claridad compartida</div></div></div><div className="workspace-switcher"><div className="avatar-stack">{members.slice(0, 2).map((member, index) => <div key={member.$id} className={`avatar ${index === 0 ? 'avatar-you' : 'avatar-partner'}`}>{(member.alias || '?').slice(0, 1).toUpperCase()}</div>)}</div><div className="workspace-copy"><span>{householdName}</span><small>{members.length} integrantes · conectado</small></div><ChevronDown size={15} /></div><nav className="main-nav" aria-label="Navegación principal"><div className="nav-section-label">Tu panorama</div>{navItems.map(({ label, icon: Icon }) => <button key={label} className={`nav-item ${activeView === label ? 'active' : ''}`} onClick={() => { setActiveView(label); setMobileNav(false); }}><Icon size={18} strokeWidth={activeView === label ? 2.2 : 1.8} /><span>{label}</span>{label === 'Movimientos' && <span className="nav-count">{transactions.length}</span>}</button>)}<div className="nav-section-label nav-section-label-spaced">Más herramientas</div><button className="nav-item" onClick={() => setShowAssistant(true)}><Bot size={18} /><span>Nia</span></button><button className="nav-item" onClick={() => notify('La configuración de la cuenta se administra en Appwrite.')}><Settings size={18} /><span>Ajustes</span></button></nav><div className="sidebar-bottom"><div className="monthly-note"><Sparkles size={16} /><span><b>Datos en vivo</b><br />Última carga desde Appwrite<br />{new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</span></div><div className="profile-row"><div className="profile-avatar">{displayName.slice(0, 2).toUpperCase()}</div><div className="profile-copy"><b>{displayName}</b><span>{user.email}</span></div><button className="icon-button" aria-label="Cerrar sesión" onClick={onLogout}><LogOut size={17} /></button></div></div></aside>
    <main className="main-content"><header className="topbar"><button className="mobile-menu" onClick={() => setMobileNav(!mobileNav)}><Menu size={20} /></button><div className="breadcrumb"><span>{householdName}</span><span className="breadcrumb-dot">/</span><b>{activeView}</b></div><div className="topbar-actions"><div className="period-picker"><CalendarDays size={16} /><span>{periodLabel}</span></div><button className="icon-button" aria-label="Actualizar datos" onClick={onRefresh}><TrendingUp size={19} /></button><div className="user-chip"><div className="profile-avatar small">{displayName.slice(0, 2).toUpperCase()}</div><span className="user-chip-name">{displayName}</span></div></div></header><div className="page-content"><section className="welcome-row fade-in"><div><p className="eyebrow">{new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())} · Datos sincronizados</p><h1>Tu dinero, <em>más claro.</em></h1><p className="intro">Una vista real de lo que entra, lo que sale y lo que están construyendo juntos.</p></div><div className="welcome-actions"><button className="secondary-button" onClick={() => setShowAssistant(true)}><Bot size={17} /> Pregúntale a Nia</button><button className="primary-button" onClick={openCreateTransaction}><Plus size={18} /> Registrar movimiento</button></div></section><section className="scope-tabs fade-in delay-1"><div className="scope-tab-label">Ver finanzas de</div>{[['total', 'Casa', Heart], ['you', 'Tú', Sparkles], ['partner', 'Pareja', Users]].map(([key, label, Icon]) => <button key={key} className={`scope-tab ${scope === key ? 'selected' : ''}`} onClick={() => setScope(key)}><Icon size={15} /> {label}{key === 'total' && <span className="live-dot" />}</button>)}<div className="scope-caption">{scope === 'total' ? 'Todo lo compartido y personal' : `Movimientos de ${scopeLabel.toLowerCase()}`}</div></section>
      {activeView === 'Resumen' && <><section className="metric-grid fade-in delay-2"><MetricCard label="Disponible este mes" value={formatMoney(totals.income - totals.expenses)} delta={budgetTotal ? `${budgetUsed}%` : '—'} deltaLabel={budgetTotal ? 'del presupuesto usado' : 'sin presupuesto definido'} tone="mint" icon={Wallet} /><MetricCard label="Ingresos" value={formatMoney(totals.income)} delta={`${visibleTransactions.filter((item) => item.type === 'income').length}`} deltaLabel="movimientos este mes" tone="blue" icon={ArrowDownRight} /><MetricCard label="Gastos" value={formatMoney(totals.expenses)} delta={`${visibleTransactions.filter((item) => item.type === 'expense').length}`} deltaLabel="movimientos este mes" tone="coral" icon={ArrowUpRight} positive /></section><section className="insight-strip fade-in delay-3"><div className="insight-spark"><Sparkles size={18} /></div><div className="insight-copy"><b>{budgetTotal ? `Han usado el ${budgetUsed}% del presupuesto.` : 'Define presupuestos para ver el ritmo del hogar.'}</b><span>{budgetTotal ? `Quedan ${formatMoney(Math.max(budgetTotal - categoryTotal, 0))} y ${remainingDays} días del mes.` : 'La información ya está conectada; falta asignar límites por categoría.'}</span></div><button onClick={() => setActiveView('Presupuesto')}>Ver presupuesto <ArrowUpRight size={15} /></button></section><div className="dashboard-grid fade-in delay-3"><section className="panel cashflow-panel"><PanelHeader title="Flujo de dinero" subtitle="Acumulado del mes" action={<div className="legend"><span><i className="legend-dot income" /> Entradas</span><span><i className="legend-dot expense" /> Salidas</span></div>} /><div className="chart-summary"><div><strong>{formatMoney(totals.income - totals.expenses)}</strong><span>balance acumulado</span></div><div className="chart-period"><span className="selected">{periodLabel}</span></div></div><CashflowChart items={visibleTransactions} /><div className="chart-axis"><span>01</span><span>05</span><span>10</span><span>15</span><span>20</span><span>25</span><span>{daysInMonth}</span></div></section><section className="panel category-panel"><PanelHeader title="Dónde se está yendo" subtitle="Gastos por categoría" action={<button className="plain-link" onClick={() => setActiveView('Movimientos')}>Ver detalle <ArrowUpRight size={14} /></button>} /><CategoryBreakdown stats={categoryStats} total={categoryTotal} /></section></div><div className="lower-grid fade-in delay-4"><section className="panel transactions-panel"><PanelHeader title="Últimos movimientos" subtitle="Datos reales del hogar" action={<button className="plain-link" onClick={() => setActiveView('Movimientos')}>Ver todos <ArrowUpRight size={14} /></button>} /><div className="transaction-list">{visibleTransactions.length ? visibleTransactions.slice(0, 5).map((item) => <TransactionRow key={item.$id} item={item} currentOwnerScope={currentOwnerScope} onEdit={() => openEditTransaction(item)} onDelete={() => removeTransaction(item)} />) : <EmptyState compact text="Aún no hay movimientos en este periodo." onAction={openCreateTransaction} />}</div></section><section className="panel goals-panel"><PanelHeader title="En camino a" subtitle="Metas del hogar" action={<button className="circle-add" onClick={() => setShowGoal(true)}><Plus size={16} /></button>} />{activeGoal ? <GoalHighlight goal={activeGoal} currentOwnerScope={currentOwnerScope} /> : <EmptyState compact text="Todavía no han creado metas." onAction={() => setShowGoal(true)} actionLabel="Crear meta" />}</section></div></>}
      {activeView === 'Movimientos' && <TransactionsView transactions={visibleTransactions} currentOwnerScope={currentOwnerScope} onAdd={openCreateTransaction} onEdit={openEditTransaction} onDelete={removeTransaction} />}{activeView === 'Presupuesto' && <BudgetView categories={categoryStats} budgets={budgets} currentMonth={currentMonth} onSave={saveBudget} />}{activeView === 'Metas' && <GoalsView goals={goals} currentOwnerScope={currentOwnerScope} onAdd={() => setShowGoal(true)} />}</div></main>
    <button className="assistant-fab" onClick={() => setShowAssistant(true)}><Bot size={21} /><span>Nia</span><i /></button>{showTransaction && <TransactionModal form={newTransaction} setForm={setNewTransaction} categories={categories} receiptFile={receiptFile} setReceiptFile={setReceiptFile} editing={editingTransaction} saving={saving} onClose={() => setShowTransaction(false)} onSubmit={saveTransaction} />}{showGoal && <GoalModal onClose={() => setShowGoal(false)} onSubmit={saveGoal} />}{showAssistant && <AssistantPanel onClose={() => setShowAssistant(false)} onNavigate={(view) => { setActiveView(view); setShowAssistant(false); }} totals={totals} transactionsCount={transactions.length} />}{toast && <div className="toast"><Check size={16} /> {toast}</div>}</div>;
}

function AuthScreen({ onSubmit, error }) { const [mode, setMode] = useState('login'); const [form, setForm] = useState({ name: '', email: '', password: '' }); const [busy, setBusy] = useState(false); const submit = async (event) => { event.preventDefault(); setBusy(true); await onSubmit({ ...form, mode }); setBusy(false); }; return <div className="auth-shell"><div className="auth-orbit orbit-one" /><div className="auth-orbit orbit-two" /><section className="auth-card"><div className="brand-lockup auth-brand"><div className="brand-mark"><span /></div><div><div className="brand-name">finanzas<span>+</span></div><div className="brand-tagline">claridad compartida</div></div></div><div className="auth-copy"><p className="eyebrow">Tu espacio financiero</p><h1>{mode === 'login' ? 'Vuelvan a tenerlo claro.' : 'Empiecen con claridad.'}</h1><p>Accede al hogar compartido para consultar y registrar sus movimientos.</p></div><form className="auth-form" onSubmit={submit}>{mode === 'register' && <label>Nombre<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Tu nombre" /></label>}<label>Correo electrónico<input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="tu@correo.com" /></label><label>Contraseña<input required minLength="8" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="Mínimo 8 caracteres" /></label>{error && <div className="form-error">{error}</div>}<button className="primary-button full-width" disabled={busy}>{busy ? 'Conectando…' : mode === 'login' ? 'Entrar al hogar' : 'Crear cuenta'}</button></form><button className="auth-switch" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setForm({ name: '', email: form.email, password: '' }); }}>{mode === 'login' ? '¿Aún no tienes cuenta? Crear una' : 'Ya tengo una cuenta · Entrar'}</button>{mode === 'register' && <p className="auth-footnote">La cuenta nueva debe ser agregada al Team de Appwrite para ver este hogar.</p>}</section></div>; }
function LoadingScreen({ message }) { return <div className="loading-screen"><div className="brand-mark"><span /></div><p>{message}</p></div>; }
function ConfigScreen({ message }) { return <div className="loading-screen"><div className="config-panel"><div className="brand-mark"><span /></div><h2>Falta configurar Appwrite</h2><p>{message}</p><code>VITE_APPWRITE_HOUSEHOLD_ID</code></div></div>; }
function AccessScreen({ user, message, onRetry, onLogout }) { return <div className="loading-screen"><div className="config-panel"><div className="brand-mark"><span /></div><p className="eyebrow">Cuenta autenticada</p><h2>Falta acceso al hogar</h2><p>{message}</p><small>{user?.email}</small><div className="placeholder-actions"><button className="primary-button" onClick={onRetry}>Reintentar</button><button className="secondary-button" onClick={onLogout}>Cerrar sesión</button></div></div></div>; }
function MetricCard({ label, value, delta, deltaLabel, tone, icon: Icon, positive }) { return <article className={`metric-card ${tone}`}><div className="metric-top"><span>{label}</span><div className="metric-icon"><Icon size={17} /></div></div><div className="metric-value">{value}</div><div className="metric-delta"><span className={positive || tone === 'mint' ? 'good' : ''}>{delta}</span><span>{deltaLabel}</span></div></article>; }
function PanelHeader({ title, subtitle, action }) { return <div className="panel-header"><div><h2>{title}</h2><span>{subtitle}</span></div>{action}</div>; }
function CategoryBreakdown({ stats, total }) { let stop = 0; const gradient = total ? `conic-gradient(${stats.map((item) => { const start = stop; stop += (item.value / total) * 100; return `${item.color || COLORS.mint} ${start}% ${stop}%`; }).join(', ')})` : 'conic-gradient(rgba(140,230,189,.13) 0 100%)'; return <div className="category-content"><div className="donut-wrap"><div className="donut" style={{ background: gradient }}><div className="donut-center"><strong>{formatShort(total)}</strong><span>gastado</span></div></div></div><div className="category-list">{stats.length ? stats.map((item) => { const Icon = iconForCategory(item); return <div className="category-row" key={item.$id}><div className="category-icon" style={{ background: `${item.color || COLORS.mint}1c`, color: item.color || COLORS.mint }}><Icon size={16} /></div><div className="category-info"><div><b>{item.name}</b><span>{formatMoney(item.value)}</span></div><div className="progress-track"><span style={{ width: `${item.budget ? Math.min((item.value / item.budget) * 100, 100) : 0}%`, background: item.color || COLORS.mint }} /></div></div></div>; }) : <span className="empty-inline">Crea categorías desde Appwrite.</span>}</div></div>; }
function buildChart(items) { const now = new Date(); const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(); const income = Array(days).fill(0); const expenses = Array(days).fill(0); items.forEach((item) => { const day = new Date(item.occurredAt).getDate() - 1; if (day >= 0 && day < days) (item.type === 'income' ? income : expenses)[day] += Number(item.amountMinor || 0); }); let incomeTotal = 0; let expenseTotal = 0; const incomeAccumulated = income.map((value) => { incomeTotal += value; return incomeTotal; }); const expenseAccumulated = expenses.map((value) => { expenseTotal += value; return expenseTotal; }); const max = Math.max(...incomeAccumulated, ...expenseAccumulated, 1); const points = (values) => values.map((value, index) => `${(index / Math.max(days - 1, 1)) * 748},${190 - (value / max) * 145}`).join(' '); return { income: points(incomeAccumulated), expenses: points(expenseAccumulated), hasData: items.length > 0 }; }
function CashflowChart({ items }) { const chart = buildChart(items); return <div className="chart-wrap"><svg viewBox="0 0 748 200" preserveAspectRatio="none" role="img" aria-label="Gráfica real de flujo de dinero del mes"><line className="grid-line" x1="0" y1="40" x2="748" y2="40" /><line className="grid-line" x1="0" y1="90" x2="748" y2="90" /><line className="grid-line" x1="0" y1="140" x2="748" y2="140" /><line className="grid-line" x1="0" y1="190" x2="748" y2="190" />{chart.hasData ? <><polyline className="chart-line income-line" points={chart.income} /><polyline className="chart-line expense-line" points={chart.expenses} /></> : <text x="374" y="108" textAnchor="middle" fill="#60766c" fontSize="12">Sin movimientos este mes</text>}</svg></div>; }
function TransactionRow({ item, currentOwnerScope, onEdit, onDelete }) { const Icon = item.icon || Receipt; const owner = item.ownerScope === 'shared' ? '2' : item.ownerScope === currentOwnerScope ? 'Tú' : 'P'; return <div className="transaction-row"><div className="transaction-icon"><Icon size={17} /></div><div className="transaction-main"><b>{item.merchant}</b><span>{item.categoryName || 'Sin categoría'} · {formatDate(item.occurredAt)}</span></div><div className="transaction-owner"><div className={`avatar micro ${item.ownerScope === 'partner' ? 'avatar-partner' : item.ownerScope === 'shared' ? 'avatar-shared' : 'avatar-you'}`} title={item.ownerScope === 'shared' ? 'Compartido' : item.ownerScope === currentOwnerScope ? 'Tú' : 'Pareja'}>{owner}</div></div><strong className={item.type === 'income' ? 'income-amount' : ''}>{item.type === 'income' ? '+' : '−'} {formatMoney(item.amountMinor, item.currency)}</strong><button className="more-button" onClick={onEdit} aria-label={`Editar ${item.merchant}`}><Pencil size={15} /></button><button className="more-button danger-button" onClick={onDelete} aria-label={`Eliminar ${item.merchant}`}><X size={16} /></button></div>; }
function EmptyState({ text, onAction, actionLabel = 'Registrar movimiento', compact = false }) { return <div className={`empty-state ${compact ? 'empty-compact' : ''}`}><div className="placeholder-icon"><Receipt size={22} /></div><p>{text}</p>{onAction && <button className="secondary-button" onClick={onAction}><Plus size={15} /> {actionLabel}</button>}</div>; }
function TransactionsView({ transactions, currentOwnerScope, onAdd, onEdit, onDelete }) { const [search, setSearch] = useState(''); const filtered = transactions.filter((item) => `${item.merchant} ${item.categoryName || ''}`.toLowerCase().includes(search.toLowerCase())); return <section className="data-view fade-in"><div className="view-heading"><div><p className="eyebrow">Movimientos</p><h2>Todo lo que pasó</h2><p>Consulta y corrige los registros reales de tu hogar.</p></div><button className="primary-button" onClick={onAdd}><Plus size={17} /> Añadir movimiento</button></div><div className="data-toolbar"><div className="search-box"><Receipt size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar concepto o categoría…" /></div><span>{filtered.length} registros del mes</span></div><div className="panel full-panel"><div className="transaction-list">{filtered.length ? filtered.map((item) => <TransactionRow key={item.$id} item={item} currentOwnerScope={currentOwnerScope} onEdit={() => onEdit(item)} onDelete={() => onDelete(item)} />) : <EmptyState text="No hay movimientos que coincidan con tu búsqueda." onAction={onAdd} />}</div></div></section>; }
function BudgetView({ categories, budgets, currentMonth, onSave }) { const [drafts, setDrafts] = useState({}); return <section className="data-view fade-in"><div className="view-heading"><div><p className="eyebrow">Presupuesto</p><h2>Un plan que sí se puede seguir</h2><p>Los límites se guardan por categoría directamente en Appwrite.</p></div><div className="period-pill"><CalendarDays size={15} /> {formatMonth(currentMonth)}</div></div><div className="budget-list panel">{categories.filter((category) => category.kind !== 'income').map((category) => { const existing = budgets.find((item) => item.categoryId === category.$id && item.month === currentMonth); const value = drafts[category.$id] ?? existing?.plannedMinor ?? ''; const spent = category.value; const percent = Number(value) ? Math.min((spent / Number(value)) * 100, 100) : 0; const Icon = iconForCategory(category); return <div className="budget-row" key={category.$id}><div className="category-icon" style={{ background: `${category.color || COLORS.mint}1c`, color: category.color || COLORS.mint }}><Icon size={17} /></div><div className="budget-name"><b>{category.name}</b><span>{formatMoney(spent)} gastado este mes</span><div className="progress-track"><span style={{ width: `${percent}%`, background: category.color || COLORS.mint }} /></div></div><div className="budget-input"><span>$</span><input type="number" min="0" value={value} onChange={(event) => setDrafts({ ...drafts, [category.$id]: event.target.value })} placeholder="Sin límite" /><button className="circle-add" onClick={() => onSave(category.$id, value, existing)} aria-label={`Guardar presupuesto de ${category.name}`}><Check size={15} /></button></div></div>; })}</div></section>; }
function GoalHighlight({ goal, currentOwnerScope }) { const target = Number(goal.targetMinor || 0); const current = Number(goal.currentMinor || 0); const percent = target ? Math.min((current / target) * 100, 100) : 0; return <div className="goal-card"><div className="goal-highlight"><div className="goal-icon"><Target size={21} /></div><div className="goal-heading"><b>{goal.name}</b><span>{goal.targetDate ? `Meta para ${new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric' }).format(new Date(goal.targetDate))}` : 'Sin fecha objetivo'}</span></div><strong>{formatMoney(current)} <small>/ {formatMoney(target)}</small></strong></div><div className="goal-progress"><span style={{ width: `${percent}%` }} /></div><div className="goal-footer"><span>{percent.toFixed(1)}% completado</span><b>Faltan {formatMoney(Math.max(target - current, 0))}</b></div><div className="goal-avatars"><div className={`avatar ${goal.ownerScope === 'partner' ? 'avatar-partner' : 'avatar-you'}`}>{goal.ownerScope === 'shared' ? '2' : goal.ownerScope === currentOwnerScope ? 'Tú' : 'P'}</div><span>{goal.ownerScope === 'shared' ? 'Meta compartida' : 'Meta individual'}</span></div></div>; }
function GoalsView({ goals, currentOwnerScope, onAdd }) { return <section className="data-view fade-in"><div className="view-heading"><div><p className="eyebrow">Metas</p><h2>Lo que están construyendo</h2><p>Guarda objetivos y mira cuánto falta sin perder el contexto.</p></div><button className="primary-button" onClick={onAdd}><Plus size={17} /> Crear meta</button></div>{goals.length ? <div className="goals-grid">{goals.map((goal) => <section className="panel" key={goal.$id}><GoalHighlight goal={goal} currentOwnerScope={currentOwnerScope} /></section>)}</div> : <div className="panel"><EmptyState text="Todavía no hay metas guardadas para este hogar." onAction={onAdd} actionLabel="Crear primera meta" /></div>}</section>; }
function TransactionModal({ form, setForm, categories, receiptFile, setReceiptFile, editing, saving, onClose, onSubmit }) { const availableCategories = categories.filter((category) => form.type === 'income' ? category.kind === 'income' || category.name.toLowerCase().includes('ingreso') : category.kind !== 'income'); return <div className="modal-backdrop" onMouseDown={onClose}><form className="transaction-modal" onSubmit={onSubmit} onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><p className="eyebrow">{editing ? 'Editar registro' : 'Nuevo registro'}</p><h2>¿Qué pasó con tu dinero?</h2></div><button type="button" className="close-button" onClick={onClose}><X size={18} /></button></div><div className="type-toggle"><button type="button" className={form.type === 'expense' ? 'selected' : ''} onClick={() => setForm({ ...form, type: 'expense', categoryId: categories.find((item) => item.kind !== 'income')?.$id || '' })}>Gasto</button><button type="button" className={form.type === 'income' ? 'selected income-toggle' : ''} onClick={() => setForm({ ...form, type: 'income', categoryId: categories.find((item) => item.kind === 'income')?.$id || '' })}>Ingreso</button></div><label>Concepto<input autoFocus required value={form.merchant} onChange={(event) => setForm({ ...form, merchant: event.target.value })} placeholder="Ej. Mercado, nómina, taxi…" /></label><div className="form-row"><label>Monto<div className="money-input"><span>$</span><input required type="number" min="1" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="0" /></div></label><label>Fecha<input required type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></label></div><div className="form-row"><label>Categoría<select value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}>{availableCategories.map((category) => <option key={category.$id} value={category.$id}>{category.name}</option>)}</select></label><label>¿De quién?<select value={form.owner} onChange={(event) => setForm({ ...form, owner: event.target.value })}><option value="you">Tú</option><option value="partner">Pareja</option><option value="shared">Compartido</option></select></label></div><label>Nota <input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="Opcional" /></label>{!editing && <label className="receipt-upload"><Camera size={18} /><span><b>{receiptFile?.name || 'Agregar recibo'}</b><small>{receiptFile ? 'Se subirá al bucket privado' : 'JPG, PNG, WEBP o PDF · máximo 10 MB'}</small></span><Upload size={16} /><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 10 * 1024 * 1024) { window.alert('El recibo no puede superar 10 MB.'); return; } setReceiptFile(file); }} /></label>}<button className="primary-button full-width" disabled={saving} type="submit"><Check size={17} /> {saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Guardar movimiento'}</button></form></div>; }
function GoalModal({ onClose, onSubmit }) { const [form, setForm] = useState({ name: '', targetMinor: '', targetDate: '', ownerScope: 'shared' }); const submit = (event) => { event.preventDefault(); if (!form.name.trim() || !Number(form.targetMinor)) return; onSubmit(form); }; return <div className="modal-backdrop" onMouseDown={onClose}><form className="transaction-modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><p className="eyebrow">Nueva meta</p><h2>¿Qué están construyendo?</h2></div><button type="button" className="close-button" onClick={onClose}><X size={18} /></button></div><label>Nombre<input required autoFocus value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ej. Fondo de emergencia" /></label><div className="form-row"><label>Objetivo<div className="money-input"><span>$</span><input required type="number" min="1" value={form.targetMinor} onChange={(event) => setForm({ ...form, targetMinor: event.target.value })} placeholder="0" /></div></label><label>Fecha objetivo<input type="date" value={form.targetDate} onChange={(event) => setForm({ ...form, targetDate: event.target.value })} /></label></div><label>¿Para quién?<select value={form.ownerScope} onChange={(event) => setForm({ ...form, ownerScope: event.target.value })}><option value="shared">Compartida</option><option value="you">Tú</option><option value="partner">Pareja</option></select></label><button className="primary-button full-width" type="submit"><Target size={17} /> Crear meta</button></form></div>; }
function AssistantPanel({ onClose, onNavigate, totals, transactionsCount }) { return <div className="assistant-backdrop" onMouseDown={onClose}><aside className="assistant-panel" onMouseDown={(event) => event.stopPropagation()}><div className="assistant-header"><div className="nia-avatar"><Bot size={20} /></div><div><b>Nia</b><span>Tu copiloto financiero</span></div><button className="close-button" onClick={onClose}><X size={18} /></button></div><div className="assistant-body"><div className="assistant-welcome"><div className="sparkle-orb"><Sparkles size={20} /></div><h3>Hola. Estoy conectada.</h3><p>Tu dashboard ya está leyendo Appwrite. Para interpretar recibos y frases como “ayer”, usa el bot de Telegram configurado para este hogar.</p></div><div className="assistant-data-card"><div><span>Balance del mes</span><b>{formatMoney(totals.income - totals.expenses)}</b></div><div><span>Movimientos sincronizados</span><b>{transactionsCount}</b></div></div><div className="suggestion-chips"><button onClick={() => onNavigate('Movimientos')}>Revisar movimientos</button><button onClick={() => onNavigate('Presupuesto')}>Ver presupuesto</button><button onClick={() => onNavigate('Metas')}>Revisar metas</button></div><div className="nia-note"><Bot size={16} /><span>La conversación web de Nia se habilitará sobre la misma Function cuando definamos su endpoint autenticado. Telegram ya puede registrar gastos y recibos.</span></div></div><div className="assistant-composer"><input disabled placeholder="Disponible próximamente en web" /><button className="send-button" disabled><Send size={17} /></button></div></aside></div>; }

createRoot(document.getElementById('root')).render(<App />);
