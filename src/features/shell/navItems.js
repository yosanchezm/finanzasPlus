import { CreditCard, Flag, LayoutDashboard, ReceiptText, SlidersHorizontal, Target } from 'lucide-react';

/** Main views. `label` doubles as the view id used by FinanceShell. */
export const NAV_ITEMS = [
  { label: 'Resumen', icon: LayoutDashboard },
  { label: 'Movimientos', icon: ReceiptText },
  { label: 'Presupuesto', icon: Target },
  { label: 'Metas', icon: Flag },
  { label: 'Deudas', icon: CreditCard },
];

/** Settings live apart from the main views: the sidebar pins them at the bottom and the mobile sheet lists them. */
export const SETTINGS_ITEM = { label: 'Ajustes', icon: SlidersHorizontal };

export const navItem = (label) => NAV_ITEMS.find((item) => item.label === label);
