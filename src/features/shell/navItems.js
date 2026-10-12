import { Flag, LayoutDashboard, ReceiptText, Target } from 'lucide-react';

/** Main views. `label` doubles as the view id used by FinanceShell. */
export const NAV_ITEMS = [
  { label: 'Resumen', icon: LayoutDashboard },
  { label: 'Movimientos', icon: ReceiptText },
  { label: 'Presupuesto', icon: Target },
  { label: 'Metas', icon: Flag },
];

export const navItem = (label) => NAV_ITEMS.find((item) => item.label === label);
